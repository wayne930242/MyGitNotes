/** The note and caret the agent panel names to Pi with each message. Lines and columns count from 1. */
/** The file a message is about, and the caret in it when the user sends the line too. */
export interface AgentFocus {
  file: string;
  line?: number;
  column?: number;
  /** Where a selection that starts at `line`/`column` ends; absent for a bare caret. */
  endLine?: number;
  endColumn?: number;
}

export type AssistantBlock = { type: 'text'; text: string; } | { type: 'thinking'; text: string; } | { type: 'toolCall'; id: string; name: string; args: unknown; };

export type TranscriptEntry = { kind: 'user'; key: number; text: string; focus?: AgentFocus; } | { kind: 'assistant'; key: number; blocks: AssistantBlock[]; error?: string; } | { kind: 'notice'; key: number; level: 'info' | 'warning' | 'error'; text: string; };

export interface ToolOutcome {
  text: string;
  isError: boolean;
  running: boolean;
}

/** A Pi extension dialog waiting for the user: `select`, `confirm`, `input` or `editor`. */
export interface AgentDialog {
  id: string;
  method: 'select' | 'confirm' | 'input' | 'editor';
  title: string;
  message?: string;
  options?: string[];
  placeholder?: string;
  prefill?: string;
}

export interface TranscriptState {
  entries: TranscriptEntry[];
  /** The assistant message Pi is streaming, until its `message_end` replaces it. */
  streaming?: AssistantBlock[];
  tools: Record<string, ToolOutcome>;
  dialogs: AgentDialog[];
  running: boolean;
  statuses: Record<string, string>;
  widgets: Record<string, string[]>;
  /** Messages Pi holds until the run reaches them: steering after the current tool calls, follow-ups once it ends. */
  queued: QueuedMessage[];
  nextKey: number;
}

export interface QueuedMessage {
  kind: 'steer' | 'followUp';
  text: string;
}

export const emptyTranscript: TranscriptState = { entries: [], tools: {}, dialogs: [], running: false, statuses: {}, widgets: {}, queued: [], nextKey: 0 };

const CONTEXT_OPEN = '<editor-context>';
const CONTEXT_CLOSE = '</editor-context>';
const CONTEXT_PATTERN = /^<editor-context>\nfile: (.+)\n(?:(?:cursor: line (\d+), column (\d+)|selection: line (\d+), column (\d+) to line (\d+), column (\d+))\n)?<\/editor-context>\n\n/;

/** Prefixes a message with the file in focus and, when given, the caret; Pi reads the file itself when it needs it. */
export function withFocus(text: string, focus: AgentFocus | undefined): string {
  if (!focus) return text;
  const start = `line ${focus.line}, column ${focus.column ?? 1}`;
  const place = focus.line === undefined ? '' : focus.endLine === undefined ? `cursor: ${start}\n` : `selection: ${start} to line ${focus.endLine}, column ${focus.endColumn ?? 1}\n`;
  return `${CONTEXT_OPEN}\nfile: ${focus.file}\n${place}${CONTEXT_CLOSE}\n\n${text}`;
}

/**
 * How a focus reads in a chip: `name.md:12:5` for a caret, `name.md:12-15` for lines selected,
 * `name.md:12:5-9` for a selection within one line, or just the file name without a caret.
 */
export function focusLabel(focus: AgentFocus): string {
  const name = focus.file.slice(focus.file.lastIndexOf('/') + 1);
  if (focus.line === undefined) return name;
  if (focus.endLine === undefined) return `${name}:${focus.line}:${focus.column ?? 1}`;
  return focus.endLine === focus.line ? `${name}:${focus.line}:${focus.column ?? 1}-${focus.endColumn ?? 1}` : `${name}:${focus.line}-${focus.endLine}`;
}

/** Splits the focus prefix back off a sent message, for display. */
export function splitFocus(message: string): { text: string; focus?: AgentFocus; } {
  const match = CONTEXT_PATTERN.exec(message);
  if (!match) return { text: message };
  const [, file, line, column, start, startColumn, end, endColumn] = match;
  const text = message.slice(match[0].length);
  if (line !== undefined) return { text, focus: { file, line: Number(line), column: Number(column) } };
  if (start !== undefined) return { text, focus: { file, line: Number(start), column: Number(startColumn), endLine: Number(end), endColumn: Number(endColumn) } };
  return { text, focus: { file } };
}

/** Where a caret or selection sits in file lines: the caret's line and column, plus the selection's end when there is one. */
export function selectionPosition(body: string, selection: { from: number; to: number; }, lineOffset = 0): Pick<AgentFocus, 'line' | 'column' | 'endLine' | 'endColumn'> {
  const start = caretPosition(body, selection.from, lineOffset);
  if (selection.to <= selection.from) return start;
  const end = caretPosition(body, selection.to, lineOffset);
  return { ...start, endLine: end.line, endColumn: end.column };
}

/** The 1-based line and column of `offset` in a note body whose first line is file line `lineOffset + 1`. */
export function caretPosition(body: string, offset: number, lineOffset = 0): { line: number; column: number; } {
  const before = body.slice(0, Math.max(0, Math.min(offset, body.length)));
  const lineStart = before.lastIndexOf('\n') + 1;
  return { line: before.split('\n').length + lineOffset, column: before.length - lineStart + 1 };
}

// Terminal styling an extension writes for the TUI: CSI sequences such as colours, and OSC sequences such as hyperlinks.
// eslint-disable-next-line no-control-regex -- The escape character is what these sequences start with.
const TERMINAL_ESCAPES = /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g;

/** Plain text of a status, widget or notice that an extension styled for a terminal. */
export const stripTerminalStyles = (text: string) => text.replace(TERMINAL_ESCAPES, '');

type PiRecord = Record<string, unknown>;
const isRecord = (value: unknown): value is PiRecord => typeof value === 'object' && value !== null && !Array.isArray(value);

function contentText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.filter(isRecord).map(block => block.type === 'text' && typeof block.text === 'string' ? block.text : block.type === 'image' ? '[image]' : '').filter(Boolean).join('\n');
}

function assistantBlocks(content: unknown): AssistantBlock[] {
  if (!Array.isArray(content)) return [];
  return content.filter(isRecord).flatMap((block): AssistantBlock[] => {
    if (block.type === 'text' && typeof block.text === 'string') return [{ type: 'text', text: block.text }];
    if (block.type === 'thinking' && typeof block.thinking === 'string' && block.thinking) return [{ type: 'thinking', text: block.thinking }];
    if (block.type === 'toolCall' && typeof block.id === 'string') return [{ type: 'toolCall', id: block.id, name: String(block.name ?? ''), args: block.arguments }];
    return [];
  });
}

type NewEntry = TranscriptEntry extends infer Entry ? Entry extends TranscriptEntry ? Omit<Entry, 'key'> : never : never;

function append(state: TranscriptState, entry: NewEntry): TranscriptState {
  return { ...state, entries: [...state.entries, { ...entry, key: state.nextKey }], nextKey: state.nextKey + 1 };
}

/** Adds one finished message; returns the state unchanged for roles the panel does not show. */
function addMessage(state: TranscriptState, message: unknown): TranscriptState {
  if (!isRecord(message)) return state;
  if (message.role === 'user') return append(state, { kind: 'user', ...splitFocus(contentText(message.content)) });
  if (message.role === 'assistant') {
    const error = message.stopReason === 'error' || message.stopReason === 'aborted' ? String(message.errorMessage || message.stopReason) : undefined;
    return append(state, { kind: 'assistant', blocks: assistantBlocks(message.content), ...(error ? { error } : {}) });
  }
  if (message.role === 'toolResult' && typeof message.toolCallId === 'string') {
    return { ...state, tools: { ...state.tools, [message.toolCallId]: { text: contentText(message.content), isError: message.isError === true, running: false } } };
  }
  if (message.role === 'compactionSummary') return append(state, { kind: 'notice', level: 'info', text: 'compacted' });
  return state;
}

/** Rebuilds the transcript from `get_messages`, as a client that attaches to a running session does. */
export function transcriptFromMessages(messages: unknown[]): TranscriptState {
  return messages.reduce<TranscriptState>(addMessage, emptyTranscript);
}

function applyDelta(blocks: AssistantBlock[], event: PiRecord): AssistantBlock[] {
  const index = typeof event.contentIndex === 'number' ? event.contentIndex : -1;
  if (index < 0) return blocks;
  const next = [...blocks];
  const current = next[index];
  switch (event.type) {
    case 'text_start':
      next[index] = { type: 'text', text: '' };
      break;
    case 'text_delta':
      next[index] = { type: 'text', text: (current?.type === 'text' ? current.text : '') + String(event.delta ?? '') };
      break;
    case 'text_end':
      if (typeof event.content === 'string') next[index] = { type: 'text', text: event.content };
      break;
    case 'thinking_start':
      next[index] = { type: 'thinking', text: '' };
      break;
    case 'thinking_delta':
      next[index] = { type: 'thinking', text: (current?.type === 'thinking' ? current.text : '') + String(event.delta ?? '') };
      break;
    case 'thinking_end':
      if (typeof event.content === 'string') next[index] = { type: 'thinking', text: event.content };
      break;
    case 'toolcall_start':
      next[index] = { type: 'toolCall', id: String(event.id ?? ''), name: String(event.toolName ?? ''), args: undefined };
      break;
    case 'toolcall_end':
      if (isRecord(event.toolCall)) next[index] = { type: 'toolCall', id: String(event.toolCall.id ?? ''), name: String(event.toolCall.name ?? ''), args: event.toolCall.arguments };
      break;
    default:
      return blocks;
  }
  return next;
}

const DIALOG_METHODS = ['select', 'confirm', 'input', 'editor'];

function applyUiRequest(state: TranscriptState, record: PiRecord): TranscriptState {
  const method = String(record.method);
  if (DIALOG_METHODS.includes(method) && typeof record.id === 'string') {
    if (state.dialogs.some(dialog => dialog.id === record.id)) return state;
    const dialog: AgentDialog = { id: record.id, method: method as AgentDialog['method'], title: String(record.title ?? ''), ...(typeof record.message === 'string' ? { message: record.message } : {}), ...(Array.isArray(record.options) ? { options: record.options.map(String) } : {}), ...(typeof record.placeholder === 'string' ? { placeholder: record.placeholder } : {}), ...(typeof record.prefill === 'string' ? { prefill: record.prefill } : {}) };
    return { ...state, dialogs: [...state.dialogs, dialog] };
  }
  if (method === 'notify') {
    const level = record.notifyType === 'error' || record.notifyType === 'warning' ? record.notifyType : 'info';
    return append(state, { kind: 'notice', level, text: stripTerminalStyles(String(record.message ?? '')) });
  }
  if (method === 'setStatus' && typeof record.statusKey === 'string') {
    const { [record.statusKey]: _, ...statuses } = state.statuses;
    return { ...state, statuses: typeof record.statusText === 'string' && record.statusText ? { ...statuses, [record.statusKey]: stripTerminalStyles(record.statusText) } : statuses };
  }
  if (method === 'setWidget' && typeof record.widgetKey === 'string') {
    const { [record.widgetKey]: _, ...widgets } = state.widgets;
    return { ...state, widgets: Array.isArray(record.widgetLines) ? { ...widgets, [record.widgetKey]: record.widgetLines.map(line => stripTerminalStyles(String(line))) } : widgets };
  }
  return state;
}

/** Applies one record from the bridge: a Pi session event, extension UI request, command failure or bridge notice. */
export function applyRecord(state: TranscriptState, record: unknown): TranscriptState {
  if (!isRecord(record)) return state;
  switch (record.type) {
    case 'agent_start':
      return { ...state, running: true };
    case 'agent_settled':
      return { ...state, running: false, streaming: undefined };
    case 'message_start':
      return isRecord(record.message) && record.message.role === 'assistant' ? { ...state, streaming: [] } : state;
    case 'message_update':
      return isRecord(record.assistantMessageEvent) ? { ...state, streaming: applyDelta(state.streaming ?? [], record.assistantMessageEvent) } : state;
    case 'message_end': {
      const ended = addMessage(state, record.message);
      return isRecord(record.message) && record.message.role === 'assistant' ? { ...ended, streaming: undefined } : ended;
    }
    case 'tool_execution_start':
      return typeof record.toolCallId === 'string' ? { ...state, tools: { ...state.tools, [record.toolCallId]: { text: '', isError: false, running: true } } } : state;
    case 'tool_execution_update':
      return typeof record.toolCallId === 'string' && isRecord(record.partialResult) ? { ...state, tools: { ...state.tools, [record.toolCallId]: { text: contentText(record.partialResult.content), isError: false, running: true } } } : state;
    case 'tool_execution_end':
      return typeof record.toolCallId === 'string' && isRecord(record.result) ? { ...state, tools: { ...state.tools, [record.toolCallId]: { text: contentText(record.result.content), isError: record.isError === true, running: false } } } : state;
    case 'extension_ui_request':
      return applyUiRequest(state, record);
    case 'bridge_ui_resolved':
      return { ...state, dialogs: state.dialogs.filter(dialog => dialog.id !== record.id) };
    case 'response':
      return record.success === false ? append(state, { kind: 'notice', level: 'error', text: `${String(record.command ?? '')}: ${String(record.error ?? '')}` }) : state;
    case 'bridge_error':
    case 'extension_error':
      return append(state, { kind: 'notice', level: 'error', text: String(record.error ?? '') });
    case 'queue_update': {
      const texts = (value: unknown) => Array.isArray(value) ? value.map(text => splitFocus(String(text)).text) : [];
      return { ...state, queued: [...texts(record.steering).map(text => ({ kind: 'steer' as const, text })), ...texts(record.followUp).map(text => ({ kind: 'followUp' as const, text }))] };
    }
    case 'auto_retry_start':
      return append(state, { kind: 'notice', level: 'warning', text: String(record.errorMessage ?? 'retrying') });
    default:
      return state;
  }
}
