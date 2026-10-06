// @vitest-environment jsdom
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { NotebookConfig } from '../types.js';
import { PiAgentProvider, type PiAgentValue, type PiSessionInfo, usePiAgent } from './session.js';

/** A socket that never reaches Pi; tests push bridge records into it. */
class FakeSocket {
  static last: FakeSocket | undefined;
  static readonly OPEN = 1;
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string; }) => void) | null = null;
  onclose: (() => void) | null = null;
  constructor() {
    FakeSocket.last = this;
  }
  sent: { id?: string; type: string; }[] = [];
  send(text: string) {
    this.sent.push(JSON.parse(text));
  }
  close() {}
  receive(record: unknown) {
    this.onmessage?.({ data: JSON.stringify(record) });
  }
}

const notebooks: NotebookConfig[] = [{ id: 'nb', title: 'Notes', root: 'notes' }];
const live = (overrides: Partial<PiSessionInfo> = {}): PiSessionInfo => ({ id: 's1', cwd: '/home/me/workspace', location: { notebookId: 'nb', folder: null, repository: true }, status: 'ready', startedAt: '', ...overrides });
let requests: { method: string; body?: unknown; }[] = [];

beforeEach(() => {
  requests = [];
  FakeSocket.last = undefined;
  vi.stubGlobal('WebSocket', FakeSocket);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      requests.push({ method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      const session = method === 'DELETE' ? null : method === 'GET' ? null : live({ id: method === 'PUT' ? 's2' : 's1' });
      return new Response(JSON.stringify({ session, piAvailable: true }), { status: 200 });
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

/** Reports the provider's value after each render, so a test acts on the latest one. */
function Probe({ onValue }: { onValue: (value: PiAgentValue) => void; }) {
  const value = usePiAgent();
  useEffect(() => onValue(value));
  return null;
}

function mount() {
  const seen: { current?: PiAgentValue; } = {};
  render(
    <PiAgentProvider enabled notebookId='nb' notebooks={notebooks} folders={[]}>
      <Probe
        onValue={value => {
          seen.current = value;
        }}
      />
    </PiAgentProvider>,
  );
  return seen;
}

it("starts at the root of the notebook's repository by default, resuming no conversation yet", async () => {
  mount();
  await waitFor(() => expect(requests.find(request => request.method === 'POST')?.body).toEqual({ notebookId: 'nb', folder: null, repository: true }));
});

it('remembers the live conversation and resumes it, with the remembered folder, on the next start', async () => {
  localStorage.setItem('mygitnotes.piAgent.location', JSON.stringify({ notebookId: 'nb', folder: 'drafts' }));
  localStorage.setItem('mygitnotes.piAgent.sessionFile', '/home/me/.pi/agent/sessions/old.jsonl');
  mount();
  await waitFor(() => expect(requests.find(request => request.method === 'POST')?.body).toEqual({ notebookId: 'nb', folder: 'drafts', sessionFile: '/home/me/.pi/agent/sessions/old.jsonl' }));
  await waitFor(() => expect(FakeSocket.last).toBeDefined());
  act(() => FakeSocket.last!.receive({ type: 'bridge_status', session: live({ sessionFile: '/home/me/.pi/agent/sessions/new.jsonl' }) }));
  expect(localStorage.getItem('mygitnotes.piAgent.sessionFile')).toBe('/home/me/.pi/agent/sessions/new.jsonl');
  // An ended session's file is not the one to resume.
  act(() => FakeSocket.last!.receive({ type: 'bridge_status', session: live({ sessionFile: '/home/me/.pi/agent/sessions/ended.jsonl', status: 'exited' }) }));
  expect(localStorage.getItem('mygitnotes.piAgent.sessionFile')).toBe('/home/me/.pi/agent/sessions/new.jsonl');
});

it('forgets the conversation when the session is ended or the folder is switched, and remembers the folder', async () => {
  localStorage.setItem('mygitnotes.piAgent.sessionFile', '/home/me/.pi/agent/sessions/old.jsonl');
  const agent = mount();
  await waitFor(() => expect(agent.current?.session?.id).toBe('s1'));
  await act(() => agent.current!.end());
  expect(localStorage.getItem('mygitnotes.piAgent.sessionFile')).toBeNull();

  localStorage.setItem('mygitnotes.piAgent.sessionFile', '/home/me/.pi/agent/sessions/old.jsonl');
  await act(() => agent.current!.switchFolder({ notebookId: 'nb', folder: 'drafts' }));
  expect(requests.at(-1)).toEqual({ method: 'PUT', body: { notebookId: 'nb', folder: 'drafts' } });
  expect(localStorage.getItem('mygitnotes.piAgent.sessionFile')).toBeNull();
  expect(JSON.parse(localStorage.getItem('mygitnotes.piAgent.location')!)).toEqual({ notebookId: 'nb', folder: 'drafts' });
});

it('keeps the status lines and widgets replayed on attach when the conversation history arrives after them', async () => {
  const agent = mount();
  await waitFor(() => expect(FakeSocket.last).toBeDefined());
  const socket = FakeSocket.last!;
  act(() => {
    socket.readyState = FakeSocket.OPEN;
    socket.onopen?.();
  });
  await waitFor(() => expect(socket.sent.some(command => command.type === 'get_messages')).toBe(true));
  act(() => {
    socket.receive({ type: 'extension_ui_request', id: 'u1', method: 'setStatus', statusKey: 'usage-status', statusText: 'usage 12%' });
    socket.receive({ type: 'extension_ui_request', id: 'u2', method: 'setWidget', widgetKey: 'lsp', widgetLines: ['ts: ready'] });
    socket.receive({ type: 'response', id: socket.sent.find(command => command.type === 'get_messages')!.id, command: 'get_messages', success: true, data: { messages: [] } });
  });
  expect(agent.current?.transcript.statuses).toEqual({ 'usage-status': 'usage 12%' });
  expect(agent.current?.transcript.widgets).toEqual({ lsp: ['ts: ready'] });
});

it('takes queued messages back before stopping the run, and resolves with their text', async () => {
  const agent = mount();
  await waitFor(() => expect(FakeSocket.last).toBeDefined());
  const socket = FakeSocket.last!;
  act(() => {
    socket.readyState = FakeSocket.OPEN;
    socket.onopen?.();
  });
  let restored: Promise<string> | undefined;
  act(() => {
    restored = agent.current!.abort();
  });
  const clear = socket.sent.find(command => command.type === 'clear_queue')!;
  expect(socket.sent.indexOf(clear)).toBeLessThan(socket.sent.findIndex(command => command.type === 'abort'));
  act(() => socket.receive({ type: 'response', id: clear.id, command: 'clear_queue', success: true, data: { steering: ['<editor-context>\nfile: notes/a.md\n</editor-context>\n\nlook here'], followUp: ['then this'] } }));
  await expect(restored).resolves.toBe('look here\n\nthen this');
});

async function opened() {
  const agent = mount();
  await waitFor(() => expect(FakeSocket.last).toBeDefined());
  const socket = FakeSocket.last!;
  act(() => {
    socket.readyState = FakeSocket.OPEN;
    socket.onopen?.();
  });
  return { agent, socket };
}

it('routes ! to a shell run, the built-ins to their RPC commands, and a skill with the focus in its arguments', async () => {
  const { agent, socket } = await opened();
  const sent = () => socket.sent.at(-1) as Record<string, unknown>;
  act(() => void agent.current!.send('!!git status'));
  expect(sent()).toMatchObject({ type: 'bash', command: 'git status', excludeFromContext: true });
  expect(agent.current!.transcript.entries).toEqual([{ kind: 'shell', key: 0, id: sent().id, command: 'git status', output: '', excluded: true, running: true }]);
  act(() => void agent.current!.send('/compact keep decisions'));
  expect(sent()).toMatchObject({ type: 'compact', customInstructions: 'keep decisions' });
  act(() => void agent.current!.send('/name Plan'));
  expect(sent()).toMatchObject({ type: 'set_session_name', name: 'Plan' });
  const before = socket.sent.length;
  let accepted = true;
  act(() => {
    accepted = agent.current!.send('/name');
  });
  expect(accepted).toBe(false);
  expect(socket.sent.length).toBe(before);
  act(() => void agent.current!.send('/new'));
  expect(sent()).toMatchObject({ type: 'new_session' });
  act(() => void agent.current!.send('/skill:review tighten', { file: 'notes/a.md' }));
  expect(sent()).toMatchObject({ type: 'prompt', message: '/skill:review <editor-context>\nfile: notes/a.md\n</editor-context>\n\ntighten' });
  act(() => void agent.current!.send('/reload', { file: 'notes/a.md' }));
  expect(sent()).toMatchObject({ type: 'prompt', message: '/reload' });
});

it('reads the command list, the context usage after a run, and text an extension puts in the message box', async () => {
  const { agent, socket } = await opened();
  expect(socket.sent.some(command => command.type === 'get_session_stats')).toBe(true);
  act(() => agent.current!.loadCommands());
  expect(socket.sent.at(-1)).toMatchObject({ type: 'get_commands' });
  act(() => {
    socket.receive({ type: 'response', command: 'get_commands', success: true, data: { commands: [{ name: 'reload', source: 'extension', description: 'Reload' }] } });
    socket.receive({ type: 'response', command: 'get_session_stats', success: true, data: { contextUsage: { tokens: 50_000, contextWindow: 200_000, percent: 25 } } });
    socket.receive({ type: 'extension_ui_request', id: 'e1', method: 'set_editor_text', text: '! pnpm test' });
  });
  expect(agent.current!.commands).toEqual([{ name: 'reload', source: 'extension', description: 'Reload' }]);
  expect(agent.current!.contextUsage).toEqual({ tokens: 50_000, contextWindow: 200_000, percent: 25 });
  expect(agent.current!.editorText).toEqual({ text: '! pnpm test', serial: 1 });
  act(() => agent.current!.takeEditorText(agent.current!.editorText!));
  expect(agent.current!.editorText).toBeNull();
  const stats = socket.sent.filter(command => command.type === 'get_session_stats').length;
  act(() => socket.receive({ type: 'agent_settled' }));
  expect(socket.sent.filter(command => command.type === 'get_session_stats').length).toBe(stats + 1);
});
