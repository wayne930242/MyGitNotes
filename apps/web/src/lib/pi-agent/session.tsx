import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { responseError } from '../api.js';
import { type AgentDialog, type AgentFocus, applyRecord, emptyTranscript, transcriptFromMessages, type TranscriptState, withFocus } from './transcript.js';

/** The bridged Pi process, as `/api/pi/session` reports it. */
export interface PiSessionInfo {
  id: string;
  cwd: string;
  approve: boolean;
  status: 'starting' | 'ready' | 'exited';
  pid?: number;
  startedAt: string;
  exit?: { code: number | null; signal: string | null; stderr: string; };
}

export type DialogAnswer = { value: string; } | { confirmed: boolean; } | { cancelled: true; };

export interface PiAgentValue {
  /** Only a local workspace served from this computer, with Pi installed on it, bridges to Pi. */
  available: boolean;
  session: PiSessionInfo | null;
  defaultCwd: string;
  workspaceRoots: string[];
  connected: boolean;
  transcript: TranscriptState;
  error: string;
  start: () => Promise<void>;
  send: (text: string, focus?: AgentFocus) => void;
  abort: () => void;
  answer: (dialog: AgentDialog, answer: DialogAnswer) => void;
  newConversation: () => void;
  end: () => Promise<void>;
  /** Restarts Pi in another folder; the current conversation ends with the old process. */
  switchCwd: (cwd: string, approve: boolean) => Promise<void>;
  locate: (path: string, notebookId: string) => Promise<string>;
}

const CWD_KEY = 'mygitnotes.piAgent.cwd';
const RECONNECT_MS = 1500;

function savedCwd(): string | undefined {
  try {
    return localStorage.getItem(CWD_KEY) || undefined;
  } catch {
    return undefined;
  }
}

async function sessionRequest(method: 'GET' | 'POST' | 'PUT' | 'DELETE', body?: unknown): Promise<{ session: PiSessionInfo | null; piAvailable?: boolean; defaultCwd?: string; workspaceRoots?: string[]; }> {
  const init: RequestInit = body === undefined ? { method } : { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
  const res = await fetch('/api/pi/session', init);
  if (!res.ok) throw await responseError(res, 'The Pi session request failed');
  return res.json();
}

export const PiAgentContext = createContext<PiAgentValue | null>(null);

export function usePiAgent(): PiAgentValue {
  const value = useContext(PiAgentContext);
  if (!value) throw new Error('usePiAgent must be used within a PiAgentProvider');
  return value;
}

/** Whether the agent panel can be offered; false outside a PiAgentProvider, as in isolated component tests. */
export function usePiAgentAvailable(): boolean {
  return useContext(PiAgentContext)?.available ?? false;
}

/**
 * Starts the workspace's Pi process in the background as soon as a local workspace loads, so the panel
 * opens onto a warm session, and keeps it across panel and page changes until the user ends it.
 */
export function PiAgentProvider({ enabled, children }: { enabled: boolean; children: ReactNode; }) {
  const [session, setSession] = useState<PiSessionInfo | null>(null);
  const [piAvailable, setPiAvailable] = useState(false);
  const [defaultCwd, setDefaultCwd] = useState('');
  const [workspaceRoots, setWorkspaceRoots] = useState<string[]>([]);
  const [connected, setConnected] = useState(false);
  const [transcript, setTranscript] = useState<TranscriptState>(emptyTranscript);
  const [error, setError] = useState('');
  const socket = useRef<WebSocket | null>(null);
  const sessionId = useRef<string | null>(null);
  const pending = useRef(new Map<string, 'messages' | 'state'>());

  const disconnect = useCallback(() => {
    const current = socket.current;
    socket.current = null;
    current?.close();
    setConnected(false);
  }, []);

  const connect = useCallback(function connect() {
    if (socket.current) return;
    const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/pi/ws`);
    socket.current = ws;
    const loadId = crypto.randomUUID(), stateId = crypto.randomUUID();
    pending.current.set(loadId, 'messages');
    pending.current.set(stateId, 'state');
    ws.onopen = () => {
      if (socket.current !== ws) return;
      setConnected(true);
      ws.send(JSON.stringify({ id: loadId, type: 'get_messages' }));
      ws.send(JSON.stringify({ id: stateId, type: 'get_state' }));
    };
    ws.onmessage = event => {
      if (socket.current !== ws || typeof event.data !== 'string') return;
      const record = JSON.parse(event.data) as Record<string, unknown>;
      if (record.type === 'bridge_status') {
        const info = record.session as PiSessionInfo;
        sessionId.current = info.id;
        setSession(info);
        return;
      }
      const request = typeof record.id === 'string' && record.type === 'response' ? pending.current.get(record.id) : undefined;
      if (request) {
        pending.current.delete(record.id as string);
        const data = (record.data ?? {}) as { messages?: unknown[]; isStreaming?: boolean; };
        // Dialogs replayed on attach arrive before the history, so a rebuilt transcript keeps them.
        if (request === 'messages' && Array.isArray(data.messages)) setTranscript(current => ({ ...transcriptFromMessages(data.messages!), dialogs: current.dialogs, running: current.running }));
        if (request === 'state') setTranscript(current => ({ ...current, running: data.isStreaming === true }));
        return;
      }
      if (record.type === 'response' && record.command === 'new_session' && record.success === true && !(record.data as { cancelled?: boolean; } | undefined)?.cancelled) {
        setTranscript(emptyTranscript);
        return;
      }
      setTranscript(current => applyRecord(current, record));
    };
    ws.onclose = () => {
      if (socket.current !== ws) return;
      socket.current = null;
      setConnected(false);
      // The process may still run (a dev-server restart dropped the socket); reattach while it does.
      setTimeout(() => {
        sessionRequest('GET').then(({ session: info }) => {
          setSession(info);
          if (info && info.status !== 'exited' && info.id === sessionId.current) connect();
        }).catch((reason: Error) => setError(reason.message));
      }, RECONNECT_MS);
    };
  }, []);

  const attach = useCallback((info: PiSessionInfo | null) => {
    if (info?.id !== sessionId.current) {
      disconnect();
      setTranscript(emptyTranscript);
    }
    sessionId.current = info?.id ?? null;
    setSession(info);
    setError('');
    if (info && info.status !== 'exited') connect();
  }, [connect, disconnect]);

  const start = useCallback(async () => {
    try {
      attach((await sessionRequest('POST', { cwd: savedCwd() })).session);
    } catch (reason) {
      setError((reason as Error).message);
    }
  }, [attach]);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    sessionRequest('GET').then(({ piAvailable: installed, defaultCwd: cwd, workspaceRoots: roots }) => {
      if (cancelled) return;
      // Without Pi on this computer the agent tab stays hidden and nothing starts.
      setPiAvailable(installed === true);
      if (!installed) return;
      setDefaultCwd(cwd ?? '');
      setWorkspaceRoots(roots ?? []);
      return start();
    }).catch(() => !cancelled && setPiAvailable(false));
    return () => {
      cancelled = true;
      disconnect();
    };
  }, [enabled, start, disconnect]);

  const command = useCallback((record: Record<string, unknown>) => {
    if (socket.current?.readyState === WebSocket.OPEN) socket.current.send(JSON.stringify({ id: crypto.randomUUID(), ...record }));
    else setError('Pi is not connected.');
  }, []);

  const value = useMemo<PiAgentValue>(() => ({
    available: enabled && piAvailable,
    session,
    defaultCwd,
    workspaceRoots,
    connected,
    transcript,
    error,
    start,
    // A message sent while Pi works steers the current run, as Enter does in Pi's terminal.
    send: (text, focus) => command({ type: 'prompt', message: withFocus(text, focus), ...(transcript.running ? { streamingBehavior: 'steer' } : {}) }),
    abort: () => command({ type: 'abort' }),
    answer: (dialog, answer) => {
      command({ type: 'extension_ui_response', ...answer, id: dialog.id });
      setTranscript(current => ({ ...current, dialogs: current.dialogs.filter(open => open.id !== dialog.id) }));
    },
    newConversation: () => command({ type: 'new_session' }),
    end: async () => {
      try {
        attach((await sessionRequest('DELETE')).session);
      } catch (reason) {
        setError((reason as Error).message);
      }
    },
    switchCwd: async (cwd, approve) => {
      try {
        const { session: info } = await sessionRequest('PUT', { cwd, approve });
        try {
          localStorage.setItem(CWD_KEY, cwd);
        } catch { /* The folder still applies to this session. */ }
        attach(info);
      } catch (reason) {
        setError((reason as Error).message);
        throw reason;
      }
    },
    locate: async (path, notebookId) => {
      const res = await fetch(`/api/pi/locate?${new URLSearchParams({ path, notebookId })}`);
      if (!res.ok) throw await responseError(res, 'The note could not be located');
      return ((await res.json()) as { file: string; }).file;
    },
  }), [enabled, piAvailable, session, defaultCwd, workspaceRoots, connected, transcript, error, start, command, attach]);

  return <PiAgentContext.Provider value={value}>{children}</PiAgentContext.Provider>;
}
