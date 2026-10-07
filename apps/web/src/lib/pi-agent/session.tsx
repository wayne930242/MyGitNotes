import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { ApiError, responseError } from '../api.js';
import type { NotebookConfig } from '../types.js';
import type { RepositoryStatus } from '@mygitnotes/core/repository';
import { fetchAgentWorkspaces } from '../api.js';
import type { AgentWorkspace } from '../agent-workspaces.js';
import { FEATURE_IDS, useFeatureGate } from '../web-features.js';
import type { CaretStore } from './caret-store.js';
import { commandsFromResponse, commandWithFocus, parseComposerInput, type PiCommand } from './commands.js';
import { type AgentDialog, type AgentFocus, applyRecord, emptyTranscript, queuedText, startShell, transcriptFromMessages, type TranscriptState, withFocus } from './transcript.js';

/** Where Pi runs: an agent workspace, a folder of one repository (`folder` empty for its root). */
export interface PiLocation {
  repository: string;
  folder: string;
}

export interface PiMcpServer {
  name: string;
  /** connected, cached, not-connected, needs-auth, failed, disabled or blocked. */
  status: string;
  toolCount: number;
  blockedReason?: string;
}

export interface PiSessionInfo {
  id: string;
  cwd: string;
  location: PiLocation;
  /** Pi's own project-trust decision for `cwd`, once it reports it. */
  trusted?: boolean;
  /** The MCP servers pi-mcp-adapter has configured and how each stands, once it reports them. */
  mcpServers?: PiMcpServer[];
  /** The session file Pi records this conversation in, once Pi reports it. */
  sessionFile?: string;
  status: 'starting' | 'ready' | 'exited';
  /** Where to open the WebSocket when the agent runs elsewhere; absent, the panel uses `/api/pi/ws` on the page's host. */
  socket?: { url: string; protocols?: string[]; };
  pid?: number;
  startedAt: string;
  exit?: { code: number | null; signal: string | null; stderr: string; };
}

/** The WebSocket the panel opens for a session: the agent's own socket when it names one, else the page's host. */
export function agentSocketTarget(info: Pick<PiSessionInfo, 'socket'> | null | undefined, page: Pick<Location, 'protocol' | 'host'> = location): { url: string; protocols?: string[]; } {
  return info?.socket ?? { url: `${page.protocol === 'https:' ? 'wss' : 'ws'}://${page.host}/api/pi/ws` };
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

/** How full the model's context window is, as `get_session_stats` reports it; `tokens` and `percent` are unknown right after compaction. */
export interface PiContextUsage {
  tokens: number | null;
  contextWindow: number;
  percent: number | null;
}

/** Text an extension placed in the message box (`set_editor_text`); `serial` tells a repeat of the same text apart. */
export interface PiEditorText {
  text: string;
  serial: number;
}

function contextUsageOf(data: unknown): PiContextUsage | undefined {
  const usage = typeof data === 'object' && data !== null ? (data as { contextUsage?: Record<string, unknown>; }).contextUsage : undefined;
  if (!usage || typeof usage.contextWindow !== 'number') return undefined;
  return { contextWindow: usage.contextWindow, tokens: typeof usage.tokens === 'number' ? usage.tokens : null, percent: typeof usage.percent === 'number' ? usage.percent : null };
}

export interface PiAgentValue {
  /** Only a local workspace served from this computer, with Pi installed on it, bridges to Pi. */
  available: boolean;
  session: PiSessionInfo | null;
  /** What the panel can name to Pi right now; null on the notebook list or an empty pane. */
  target: AgentTarget | null;
  notebooks: NotebookConfig[];
  repositories: Pick<RepositoryStatus, 'id' | 'repository' | 'notebooks'>[];
  /** The home repository, whose root workspace Pi starts in by default and which the workspace title names. */
  homeRepository: string;
  workspaceTitle: string;
  /** The agent workspaces Pi may run in, once `loadWorkspaces` has listed them. */
  workspaces: AgentWorkspace[];
  loadWorkspaces: () => Promise<void>;
  connected: boolean;
  transcript: TranscriptState;
  error: string;
  start: () => Promise<void>;
  /**
   * Sends what the message box holds, read as Pi's terminal editor reads it (see parseComposerInput); returns false
   * when it is not complete enough to send, such as /name without a name.
   */
  send: (text: string, focus?: AgentFocus) => boolean;
  /** The slash commands Pi offers, as of the last `loadCommands`; the built-ins are the panel's to add. */
  commands: PiCommand[];
  /** Asks Pi for its commands again, as a /reload may have changed them. */
  loadCommands: () => void;
  contextUsage?: PiContextUsage;
  /** Text an extension placed in the message box, until the panel takes it. */
  editorText: PiEditorText | null;
  /** Marks `text` as placed in the message box, so a panel opened later does not place it again. */
  takeEditorText: (text: PiEditorText) => void;
  /** Stops the run after taking back the messages still queued, as Esc does in Pi's terminal; resolves with their text. */
  abort: () => Promise<string>;
  answer: (dialog: AgentDialog, answer: DialogAnswer) => void;
  newConversation: () => void;
  end: () => Promise<void>;
  modelState: PiModelState;
  /** Switches this session's model (`provider/id`); the thinking level follows what the model supports. */
  setModel: (value: string) => void;
  setThinking: (level: string) => void;
  /** Restarts Pi in another agent workspace; the current conversation ends with the old process. */
  switchWorkspace: (location: PiLocation) => Promise<void>;
  locate: (path: string, notebookId: string) => Promise<string>;
}

const LOCATION_KEY = 'mygitnotes.piAgent.location';
/** The conversation to resume when Pi next starts, as the server restarting otherwise loses it; per browser, not per page. */
const SESSION_FILE_KEY = 'mygitnotes.piAgent.sessionFile';
/** Responses that only feed the model state; get_state also carries whether Pi is mid-run. */
const MODEL_COMMANDS = new Set(['get_state', 'get_available_models', 'get_available_thinking_levels', 'set_model', 'set_thinking_level']);
const RECONNECT_MS = 1500;

/** The workspace the user last switched to; the server refuses it once it is no longer a workspace. */
function savedLocation(): PiLocation | undefined {
  try {
    const saved = JSON.parse(localStorage.getItem(LOCATION_KEY) || 'null') as Partial<PiLocation> | null;
    return typeof saved?.repository === 'string' && typeof saved.folder === 'string' ? { repository: saved.repository, folder: saved.folder } : undefined;
  } catch {
    return undefined;
  }
}

function remember(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch { /* Not remembering only costs the next start its default. */ }
}

function savedSessionFile(): string | undefined {
  try {
    return localStorage.getItem(SESSION_FILE_KEY) ?? undefined;
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
 * in the agent workspace the user last switched to, else at the root of the home repository, and resumes the
 * conversation it last had while that is still valid there.
 */
export function PiAgentProvider({ enabled, homeRepository, workspaceTitle, notebooks, repositories, children }: { enabled: boolean; homeRepository: string; workspaceTitle: string; notebooks: NotebookConfig[]; repositories: Pick<RepositoryStatus, 'id' | 'repository' | 'notebooks'>[]; children: ReactNode; }) {
  const agentGate = useFeatureGate(FEATURE_IDS.agent);
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
  const [commands, setCommands] = useState<PiCommand[]>([]);
  const [contextUsage, setContextUsage] = useState<PiContextUsage>();
  const [workspaces, setWorkspaces] = useState<AgentWorkspace[]>([]);
  const loadWorkspaces = useCallback(async () => {
    try {
      setWorkspaces(await fetchAgentWorkspaces());
    } catch (reason) {
      setError((reason as Error).message);
    }
  }, []);
  const [editorText, setEditorText] = useState<PiEditorText | null>(null);
  const socket = useRef<WebSocket | null>(null);
  /** The socket the live session named, kept here because `connect` also runs from timers that have only the ref. */
  const socketInfo = useRef<PiSessionInfo['socket']>(undefined);
  const sessionId = useRef<string | null>(null);
  const pending = useRef(new Map<string, 'messages' | 'state'>());
  /** `clear_queue` requests waiting for the queued text they take back. */
  const takenBack = useRef(new Map<string, (text: string) => void>());

  const disconnect = useCallback(() => {
    const current = socket.current;
    socket.current = null;
    current?.close();
    setConnected(false);
  }, []);

  const connect = useCallback(function connect() {
    if (socket.current) return;
    const target = agentSocketTarget({ socket: socketInfo.current });
    const ws = new WebSocket(target.url, target.protocols);
    socket.current = ws;
    const loadId = crypto.randomUUID(), stateId = crypto.randomUUID();
    const requestStats = () => ws.send(JSON.stringify({ id: crypto.randomUUID(), type: 'get_session_stats' }));
    pending.current.set(loadId, 'messages');
    pending.current.set(stateId, 'state');
    ws.onopen = () => {
      if (socket.current !== ws) return;
      setConnected(true);
      ws.send(JSON.stringify({ id: loadId, type: 'get_messages' }));
      ws.send(JSON.stringify({ id: stateId, type: 'get_state' }));
      ws.send(JSON.stringify({ id: crypto.randomUUID(), type: 'get_available_models' }));
      ws.send(JSON.stringify({ id: crypto.randomUUID(), type: 'get_available_thinking_levels' }));
      requestStats();
    };
    ws.onmessage = event => {
      if (socket.current !== ws || typeof event.data !== 'string') return;
      const record = JSON.parse(event.data) as Record<string, unknown>;
      if (record.type === 'bridge_status') {
        // A bridge on another host does not know the address it was reached at, so the session keeps the one that opened it.
        const info = { ...record.session as PiSessionInfo, ...(socketInfo.current ? { socket: socketInfo.current } : {}) };
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
        // Another model has another context window.
        if (record.success === true && record.command === 'set_model') requestStats();
        if (record.command !== 'get_state') return;
      }
      if (record.type === 'response' && record.success === true && record.command === 'get_commands') {
        setCommands(commandsFromResponse(record.data));
        return;
      }
      if (record.type === 'response' && record.success === true && record.command === 'get_session_stats') {
        setContextUsage(contextUsageOf(record.data));
        return;
      }
      if (record.type === 'extension_ui_request' && record.method === 'set_editor_text') {
        setEditorText(current => ({ text: String(record.text ?? ''), serial: (current?.serial ?? 0) + 1 }));
        return;
      }
      // A finished run or compaction changes how full the context is.
      if (record.type === 'agent_settled' || record.type === 'compaction_end') requestStats();
      const restore = typeof record.id === 'string' && record.type === 'response' ? takenBack.current.get(record.id) : undefined;
      if (restore) {
        takenBack.current.delete(record.id as string);
        const data = (record.data ?? {}) as { steering?: unknown[]; followUp?: unknown[]; };
        restore([...data.steering ?? [], ...data.followUp ?? []].map(text => queuedText(String(text))).join('\n\n'));
        return;
      }
      const request = typeof record.id === 'string' && record.type === 'response' ? pending.current.get(record.id) : undefined;
      if (request) {
        pending.current.delete(record.id as string);
        const data = (record.data ?? {}) as { messages?: unknown[]; isStreaming?: boolean; };
        // Dialogs, status lines, widgets and the queue replayed on attach arrive before the history, so a rebuilt transcript keeps them.
        if (request === 'messages' && Array.isArray(data.messages)) setTranscript(current => ({ ...transcriptFromMessages(data.messages!), dialogs: current.dialogs, running: current.running, statuses: current.statuses, widgets: current.widgets, queued: current.queued }));
        if (request === 'state') setTranscript(current => ({ ...applyRecord(current, record), running: data.isStreaming === true }));
        return;
      }
      if (record.type === 'response' && record.command === 'new_session' && record.success === true && !(record.data as { cancelled?: boolean; } | undefined)?.cancelled) {
        setTranscript(emptyTranscript);
        requestStats();
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
          // The session's address may carry a ticket that is valid once, so a reattach takes the fresh one.
          if (info) socketInfo.current = info.socket;
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
      setCommands([]);
      setContextUsage(undefined);
      setEditorText(null);
    }
    sessionId.current = info?.id ?? null;
    socketInfo.current = info?.socket;
    setSession(info);
    setError('');
    if (info && info.status !== 'exited') connect();
  }, [connect, disconnect]);

  const start = useCallback(async () => {
    try {
      // A running session is kept whatever is asked for; the server only uses the workspace and the conversation
      // to start one, by default the home repository's root, resuming the last conversation while it is still valid there.
      const home = { repository: homeRepository, folder: '' };
      const saved = savedLocation();
      try {
        attach((await sessionRequest('POST', { ...saved ?? home, sessionFile: savedSessionFile() })).session);
      } catch (reason) {
        // Only a refused workspace is forgotten (its folder lost its core instructions, or its repository left the
        // workspace); any other failure keeps the user's choice for the next try.
        if (!saved || !(reason instanceof ApiError && (reason.status === 403 || reason.status === 404))) throw reason;
        remember(LOCATION_KEY, null);
        attach((await sessionRequest('POST', home)).session);
      }
    } catch (reason) {
      setError((reason as Error).message);
    }
  }, [attach, homeRepository]);

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

  // Starts once, as soon as Pi is known to be installed and the workspace is known.
  const started = useRef(false);
  // A gated-off agent is not started behind the panel's back: its reason is shown instead of a request the server would refuse.
  const ready = enabled && piAvailable && agentGate.allowed && Boolean(homeRepository);
  useEffect(() => {
    if (!ready || started.current) return;
    started.current = true;
    void start();
  }, [ready, start]);

  // The live conversation's file is the one to resume; an ended session's is not.
  useEffect(() => {
    if (session?.sessionFile && session.status !== 'exited') remember(SESSION_FILE_KEY, session.sessionFile);
  }, [session]);

  const takeEditorText = useCallback((text: PiEditorText) => setEditorText(current => current === text ? null : current), []);

  const command = useCallback((record: Record<string, unknown>) => {
    if (socket.current?.readyState === WebSocket.OPEN) socket.current.send(JSON.stringify({ id: crypto.randomUUID(), ...record }));
    else setError('Pi is not connected.');
  }, []);
  // Stable, since the panel asks again each time its menu opens rather than on every transcript change.
  const loadCommands = useCallback(() => command({ type: 'get_commands' }), [command]);

  const value = useMemo<PiAgentValue>(() => ({
    available: enabled && piAvailable,
    session,
    target,
    notebooks,
    repositories,
    homeRepository,
    workspaceTitle,
    workspaces,
    loadWorkspaces,
    connected,
    transcript,
    error,
    start,
    send: (text, focus) => {
      const input = parseComposerInput(text);
      // A message sent while Pi works steers the current run, as Enter does in Pi's terminal.
      const steer = transcript.running ? { streamingBehavior: 'steer' } : {};
      switch (input.kind) {
        case 'shell': {
          if (socket.current?.readyState !== WebSocket.OPEN) {
            setError('Pi is not connected.');
            return false;
          }
          const id = crypto.randomUUID();
          setTranscript(current => startShell(current, id, input.command, input.excludeFromContext));
          command({ id, type: 'bash', command: input.command, ...(input.excludeFromContext ? { excludeFromContext: true } : {}) });
          return true;
        }
        case 'builtin':
          if (input.name === 'new') command({ type: 'new_session' });
          else if (input.name === 'compact') command({ type: 'compact', ...(input.args ? { customInstructions: input.args } : {}) });
          else if (input.args) command({ type: 'set_session_name', name: input.args });
          else return false;
          return true;
        case 'command':
          command({ type: 'prompt', message: commandWithFocus(input.text, focus), ...steer });
          return true;
        case 'message':
          command({ type: 'prompt', message: withFocus(input.text, focus), ...steer });
          return true;
      }
    },
    commands,
    loadCommands,
    contextUsage,
    editorText,
    takeEditorText,
    abort: () => {
      const ws = socket.current;
      if (ws?.readyState !== WebSocket.OPEN) {
        command({ type: 'abort' });
        return Promise.resolve('');
      }
      // Queued messages would otherwise run on their own once the run stops; they go back to the message box instead.
      const id = crypto.randomUUID();
      const taken = new Promise<string>(resolve => takenBack.current.set(id, resolve));
      ws.send(JSON.stringify({ id, type: 'clear_queue' }));
      command({ type: 'abort' });
      return taken;
    },
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
        // Ending the session is the manual clear: the next start begins a new conversation.
        remember(SESSION_FILE_KEY, null);
      } catch (reason) {
        setError((reason as Error).message);
      }
    },
    switchWorkspace: async location => {
      try {
        remember(SESSION_FILE_KEY, null);
        const { session: info } = await sessionRequest('PUT', location);
        remember(LOCATION_KEY, JSON.stringify(location));
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
  }), [enabled, piAvailable, session, target, notebooks, repositories, homeRepository, workspaceTitle, workspaces, loadWorkspaces, connected, transcript, error, modelState, commands, contextUsage, editorText, takeEditorText, loadCommands, start, command, attach]);

  return (
    <PiAgentTargetContext.Provider value={registerTarget}>
      <PiAgentContext.Provider value={value}>{children}</PiAgentContext.Provider>
    </PiAgentTargetContext.Provider>
  );
}
