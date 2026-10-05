import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { responseError } from '../api.js';
import type { FolderItem, NotebookConfig } from '../types.js';
import type { CaretStore } from './caret-store.js';
import { type AgentDialog, type AgentFocus, applyRecord, emptyTranscript, transcriptFromMessages, type TranscriptState, withFocus } from './transcript.js';

/** The bridged Pi process, as `/api/pi/session` reports it. */
/** A notebook folder Pi runs in: `folder` is relative to the notebook root, null for the root itself. */
export interface PiLocation {
  notebookId: string;
  folder: string | null;
}

export interface PiSessionInfo {
  id: string;
  cwd: string;
  location: PiLocation;
  /** Pi's own project-trust decision for `cwd`, once it reports it. */
  trusted?: boolean;
  status: 'starting' | 'ready' | 'exited';
  pid?: number;
  startedAt: string;
  exit?: { code: number | null; signal: string | null; stderr: string; };
}

/**
 * The file the agent panel can name to Pi: the note in the zoomed editor or the active Focus pane, or a
 * compilation pane's file. Only a note editor has a caret, so only it can send a line.
 */
export interface AgentTarget {
  notebookId: string;
  /** Repository-relative; the panel resolves it to the absolute path Pi reads. */
  path: string;
  caret?: CaretStore;
  /** The editor body the caret offset counts in, read when the caret moves. */
  content?: () => string;
  /** Frontmatter lines above the body, so the line Pi is told matches the file. */
  lineNumberOffset?: number;
}

/** A model Pi has credentials for; `value` is `provider/id`, the key the panel selects it by. */
export interface PiModelOption {
  value: string;
  label: string;
}

/** The session's model and thinking level, and what Pi offers to switch them to. */
export interface PiModelState {
  model?: string;
  thinking?: string;
  models: PiModelOption[];
  /** The thinking levels the current model supports. */
  levels: string[];
}

const emptyModelState: PiModelState = { models: [], levels: [] };

type PiModel = { provider: string; id: string; name?: string; };
const modelKey = (model: PiModel) => `${model.provider}/${model.id}`;

/**
 * Folds Pi's answers to the model commands into the model state. Answers reach every client attached to the
 * session, whichever asked, so a switch made in one tab shows in all of them.
 */
export function applyModelResponse(state: PiModelState, record: Record<string, unknown>): PiModelState {
  if (record.type !== 'response' || record.success !== true) return state;
  const data = (record.data ?? {}) as { model?: PiModel; thinkingLevel?: string; models?: PiModel[]; levels?: string[]; };
  switch (record.command) {
    case 'get_state':
      return { ...state, model: data.model ? modelKey(data.model) : undefined, thinking: data.thinkingLevel };
    case 'get_available_models':
      return { ...state, models: (data.models ?? []).map(model => ({ value: modelKey(model), label: `${model.name || model.id} (${model.provider})` })) };
    case 'get_available_thinking_levels':
      return { ...state, levels: data.levels ?? [] };
    case 'set_model': {
      // Unlike get_state, set_model answers with the model object itself.
      const model = record.data as PiModel | undefined;
      return model?.provider && model.id ? { ...state, model: modelKey(model) } : state;
    }
    default:
      return state;
  }
}

export type DialogAnswer = { value: string; } | { confirmed: boolean; } | { cancelled: true; };

export interface PiAgentValue {
  /** Only a local workspace served from this computer, with Pi installed on it, bridges to Pi. */
  available: boolean;
  session: PiSessionInfo | null;
  /** What the panel can name to Pi right now; null on the notebook list or an empty pane. */
  target: AgentTarget | null;
  notebooks: NotebookConfig[];
  folders: FolderItem[];
  connected: boolean;
  transcript: TranscriptState;
  error: string;
  start: () => Promise<void>;
  send: (text: string, focus?: AgentFocus) => void;
  abort: () => void;
  answer: (dialog: AgentDialog, answer: DialogAnswer) => void;
  newConversation: () => void;
  end: () => Promise<void>;
  modelState: PiModelState;
  /** Switches this session's model (`provider/id`); the thinking level follows what the model supports. */
  setModel: (value: string) => void;
  setThinking: (level: string) => void;
  /** Restarts Pi in another notebook folder; the current conversation ends with the old process. */
  switchFolder: (location: PiLocation) => Promise<void>;
  locate: (path: string, notebookId: string) => Promise<string>;
}

const LOCATION_KEY = 'mygitnotes.piAgent.location';
/** Responses that only feed the model state; get_state also carries whether Pi is mid-run. */
const MODEL_COMMANDS = new Set(['get_state', 'get_available_models', 'get_available_thinking_levels', 'set_model', 'set_thinking_level']);
const RECONNECT_MS = 1500;

/** The folder the user last switched to, while its notebook still exists. */
function savedLocation(notebooks: NotebookConfig[]): PiLocation | undefined {
  try {
    const saved = JSON.parse(localStorage.getItem(LOCATION_KEY) || 'null') as PiLocation | null;
    return saved && notebooks.some(notebook => notebook.id === saved.notebookId) ? { notebookId: saved.notebookId, folder: typeof saved.folder === 'string' ? saved.folder : null } : undefined;
  } catch {
    return undefined;
  }
}

async function sessionRequest(method: 'GET' | 'POST' | 'PUT' | 'DELETE', body?: unknown): Promise<{ session: PiSessionInfo | null; piAvailable?: boolean; }> {
  const init: RequestInit = body === undefined ? { method } : { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
  const res = await fetch('/api/pi/session', init);
  if (!res.ok) throw await responseError(res, 'The Pi session request failed');
  return res.json();
}

export const PiAgentContext = createContext<PiAgentValue | null>(null);
/** Kept apart from the session value so publishing a target never re-renders on every transcript change. */
const PiAgentTargetContext = createContext<((target: AgentTarget) => () => void) | null>(null);

/**
 * Names `target` to the agent panel while `active`. The most recently activated editor or pane wins; when it
 * leaves, the one it covered (a Focus pane under a zoomed note) is named again.
 */
export function usePublishAgentTarget(target: AgentTarget | null, active: boolean) {
  const register = useContext(PiAgentTargetContext);
  useEffect(() => (register && active && target ? register(target) : undefined), [register, target, active]);
}

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
 * opens onto a warm session, and keeps it across panel and page changes until the user ends it. It starts
 * in the folder the user last switched to, else at the root of the notebook selected when it starts.
 */
export function PiAgentProvider({ enabled, notebookId, notebooks, folders, children }: { enabled: boolean; notebookId: string; notebooks: NotebookConfig[]; folders: FolderItem[]; children: ReactNode; }) {
  const [session, setSession] = useState<PiSessionInfo | null>(null);
  const [piAvailable, setPiAvailable] = useState(false);
  const [target, setTarget] = useState<AgentTarget | null>(null);
  const targets = useRef<AgentTarget[]>([]);
  const registerTarget = useCallback((next: AgentTarget) => {
    targets.current = [...targets.current, next];
    setTarget(next);
    return () => {
      targets.current = targets.current.filter(candidate => candidate !== next);
      setTarget(targets.current.at(-1) ?? null);
    };
  }, []);
  const [connected, setConnected] = useState(false);
  const [transcript, setTranscript] = useState<TranscriptState>(emptyTranscript);
  const [error, setError] = useState('');
  const [modelState, setModelState] = useState<PiModelState>(emptyModelState);
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
      ws.send(JSON.stringify({ id: crypto.randomUUID(), type: 'get_available_models' }));
      ws.send(JSON.stringify({ id: crypto.randomUUID(), type: 'get_available_thinking_levels' }));
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
      if (record.type === 'response' && MODEL_COMMANDS.has(String(record.command))) {
        if (record.success !== true) setError(String(record.error ?? `Pi rejected ${String(record.command)}.`));
        setModelState(current => applyModelResponse(current, record));
        // A new model can clamp the thinking level and change the levels on offer, so both are read again.
        if (record.success === true && (record.command === 'set_model' || record.command === 'set_thinking_level')) {
          ws.send(JSON.stringify({ id: crypto.randomUUID(), type: 'get_state' }));
          ws.send(JSON.stringify({ id: crypto.randomUUID(), type: 'get_available_thinking_levels' }));
        }
        if (record.command !== 'get_state') return;
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
      setModelState(emptyModelState);
    }
    sessionId.current = info?.id ?? null;
    setSession(info);
    setError('');
    if (info && info.status !== 'exited') connect();
  }, [connect, disconnect]);

  const start = useCallback(async () => {
    try {
      if (!notebookId) throw new Error('No notebook is selected.');
      // A running session is kept whatever folder is asked for; the server only uses it to start one.
      attach((await sessionRequest('POST', savedLocation(notebooks) ?? { notebookId, folder: null })).session);
    } catch (reason) {
      setError((reason as Error).message);
    }
  }, [attach, notebookId, notebooks]);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    sessionRequest('GET').then(({ piAvailable: installed }) => {
      // Without Pi on this computer the agent tab stays hidden and nothing starts.
      if (!cancelled) setPiAvailable(installed === true);
    }).catch(() => !cancelled && setPiAvailable(false));
    return () => {
      cancelled = true;
      disconnect();
    };
  }, [enabled, disconnect]);

  // Starts once, as soon as Pi is known to be installed and a notebook is selected.
  const started = useRef(false);
  const ready = enabled && piAvailable && Boolean(notebookId);
  useEffect(() => {
    if (!ready || started.current) return;
    started.current = true;
    void start();
  }, [ready, start]);

  const command = useCallback((record: Record<string, unknown>) => {
    if (socket.current?.readyState === WebSocket.OPEN) socket.current.send(JSON.stringify({ id: crypto.randomUUID(), ...record }));
    else setError('Pi is not connected.');
  }, []);

  const value = useMemo<PiAgentValue>(() => ({
    available: enabled && piAvailable,
    session,
    target,
    notebooks,
    folders,
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
    modelState,
    setModel: value => {
      const slash = value.indexOf('/');
      command({ type: 'set_model', provider: value.slice(0, slash), modelId: value.slice(slash + 1) });
    },
    setThinking: level => command({ type: 'set_thinking_level', level }),
    end: async () => {
      try {
        attach((await sessionRequest('DELETE')).session);
      } catch (reason) {
        setError((reason as Error).message);
      }
    },
    switchFolder: async location => {
      try {
        const { session: info } = await sessionRequest('PUT', location);
        try {
          localStorage.setItem(LOCATION_KEY, JSON.stringify(location));
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
  }), [enabled, piAvailable, session, target, notebooks, folders, connected, transcript, error, modelState, start, command, attach]);

  return (
    <PiAgentTargetContext.Provider value={registerTarget}>
      <PiAgentContext.Provider value={value}>{children}</PiAgentContext.Provider>
    </PiAgentTargetContext.Provider>
  );
}
