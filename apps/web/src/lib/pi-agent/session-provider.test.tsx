// @vitest-environment jsdom
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { useEffect, useRef } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { NotebookConfig } from '../types.js';
import { type WebFeature, WebFeaturesProvider } from '../web-features.js';
import { agentSocketTarget, PiAgentProvider, type PiAgentValue, type PiSessionInfo, usePiAgent, type WebToolHandler } from './session.js';

/** A socket that never reaches Pi; tests push bridge records into it. */
class FakeSocket {
  static last: FakeSocket | undefined;
  static readonly OPEN = 1;
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string; }) => void) | null = null;
  onclose: (() => void) | null = null;
  constructor(readonly url: string, readonly protocols?: string[]) {
    FakeSocket.last = this;
  }
  sent: { id?: string; type: string; [key: string]: unknown; }[] = [];
  send(text: string) {
    this.sent.push(JSON.parse(text));
  }
  close() {}
  receive(record: unknown) {
    this.onmessage?.({ data: JSON.stringify(record) });
  }
}

const notebooks: NotebookConfig[] = [{ id: 'nb', title: 'Notes', root: 'notes' }];
const home = 'local:home';
const live = (overrides: Partial<PiSessionInfo> = {}): PiSessionInfo => ({ id: 's1', cwd: '/home/me/workspace', location: { repository: home, folder: '' }, status: 'ready', startedAt: '', ...overrides });
let requests: { method: string; body?: unknown; }[] = [];
/** What the next started session carries beyond its defaults, such as a remote agent's `socket`. */
let sessionOverrides: Partial<PiSessionInfo> = {};

beforeEach(() => {
  requests = [];
  sessionOverrides = {};
  FakeSocket.last = undefined;
  vi.stubGlobal('WebSocket', FakeSocket);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      requests.push({ method, body });
      // A remembered workspace that lost its core instructions is refused.
      if (body?.folder === 'gone') return new Response(JSON.stringify({ error: 'That folder is not an agent workspace yet.' }), { status: 404 });
      if (body?.folder === 'flaky') return new Response(JSON.stringify({ error: 'Pi could not start.' }), { status: 500 });
      const session = method === 'DELETE' ? null : method === 'GET' ? null : live({ id: method === 'PUT' ? 's2' : 's1', ...sessionOverrides });
      return new Response(JSON.stringify({ session, piAvailable: true }), { status: 200 });
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

/** Reports the provider's value after each render, so a test acts on the latest one; unless told not to, it reaches for the agent once Pi is known to be there, as focusing the message box does. */
function Probe({ onValue, opened }: { onValue: (value: PiAgentValue) => void; opened: boolean; }) {
  const value = usePiAgent();
  useEffect(() => onValue(value));
  const woken = useRef(false);
  useEffect(() => {
    if (!opened || woken.current || !value.available) return;
    woken.current = true;
    value.wake();
  });
  return null;
}

function mount(features: WebFeature[] = [], webTools?: WebToolHandler, opened = true) {
  const seen: { current?: PiAgentValue; } = {};
  render(
    <WebFeaturesProvider features={features}>
      <PiAgentProvider enabled homeRepository={home} workspaceTitle='Knowledge Base' notebooks={notebooks} repositories={[{ id: home, notebooks: ['nb'] }]} webTools={webTools}>
        <Probe
          opened={opened}
          onValue={value => {
            seen.current = value;
          }}
        />
      </PiAgentProvider>
    </WebFeaturesProvider>,
  );
  return seen;
}

it('starts nothing until woken, then once however often it is woken while starting or running', async () => {
  const agent = mount([], undefined, false);
  await waitFor(() => expect(agent.current?.available).toBe(true));
  await new Promise(resolve => setTimeout(resolve, 50));
  expect(requests.map(request => request.method)).toEqual(['GET']);
  expect(agent.current?.starting).toBe(false);
  act(() => {
    agent.current!.wake();
    agent.current!.wake();
  });
  await waitFor(() => expect(agent.current?.session?.id).toBe('s1'));
  act(() => agent.current!.wake());
  expect(requests.filter(request => request.method === 'POST')).toHaveLength(1);
});

it('holds a message sent before Pi is ready, starting Pi, and sends it once the socket opens', async () => {
  const agent = mount([], undefined, false);
  await waitFor(() => expect(agent.current?.available).toBe(true));
  let accepted = false;
  act(() => {
    accepted = agent.current!.send('summarize this folder');
    accepted = agent.current!.send('and list its links') && accepted;
  });
  expect(accepted).toBe(true);
  expect(agent.current?.held).toBe('summarize this folder\n\nand list its links');
  await waitFor(() => expect(FakeSocket.last).toBeDefined());
  expect(requests.filter(request => request.method === 'POST')).toHaveLength(1);
  const socket = FakeSocket.last!;
  act(() => {
    socket.readyState = FakeSocket.OPEN;
    socket.onopen?.();
  });
  expect(socket.sent.at(-1)).toMatchObject({ type: 'prompt', message: 'summarize this folder\n\nand list its links' });
  expect(agent.current?.held).toBeNull();
});

it('puts a held message back in the message box when Pi fails to start', async () => {
  localStorage.setItem('mygitnotes.piAgent.location', JSON.stringify({ repository: home, folder: 'flaky' }));
  const agent = mount([], undefined, false);
  await waitFor(() => expect(agent.current?.available).toBe(true));
  act(() => void agent.current!.send('summarize this folder'));
  await waitFor(() => expect(agent.current?.error).toBe('Pi could not start.'));
  expect(agent.current?.held).toBeNull();
  expect(agent.current?.editorText?.text).toBe('summarize this folder');
});

it('wakes again after a hosted sandbox stopped for idling, resuming the conversation, but not after Pi exited on its own', async () => {
  const agent = mount();
  await waitFor(() => expect(agent.current?.session?.id).toBe('s1'));
  act(() => FakeSocket.last!.receive({ type: 'bridge_status', session: live({ sessionFile: '/s/kept.jsonl' }) }));
  // The sandbox stopped: the socket closes and the session reads back as none.
  act(() => FakeSocket.last!.onclose!());
  await waitFor(() => expect(agent.current?.session).toBeNull(), { timeout: 3000 });
  expect(requests.filter(request => request.method === 'POST')).toHaveLength(1);
  act(() => agent.current!.wake());
  await waitFor(() => expect(requests.filter(request => request.method === 'POST')).toHaveLength(2));
  expect(requests.at(-1)?.body).toEqual({ repository: home, folder: '', sessionFile: '/s/kept.jsonl' });
  await waitFor(() => expect(agent.current?.session?.id).toBe('s1'));
  act(() => FakeSocket.last!.receive({ type: 'bridge_status', session: live({ status: 'exited' }) }));
  act(() => agent.current!.wake());
  await new Promise(resolve => setTimeout(resolve, 50));
  expect(requests.filter(request => request.method === 'POST')).toHaveLength(2);
});

it("starts at the home repository's root workspace by default, resuming no conversation yet", async () => {
  mount();
  await waitFor(() => expect(requests.find(request => request.method === 'POST')?.body).toEqual({ repository: home, folder: '' }));
});

it('counts as starting while a start is on its way, and no longer once it answers or fails', async () => {
  const answered = vi.mocked(fetch).getMockImplementation()!;
  let release!: () => void;
  let posted = false;
  const held = new Promise<void>(resolve => (release = resolve));
  vi.mocked(fetch).mockImplementation(async (url, init) => {
    if (init?.method === 'POST') {
      posted = true;
      await held;
    }
    return answered(url, init);
  });
  const agent = mount();
  await waitFor(() => expect(posted).toBe(true));
  expect(agent.current?.starting).toBe(true);
  expect(agent.current?.session).toBeNull();
  release();
  await waitFor(() => expect(agent.current?.session?.id).toBe('s1'));
  expect(agent.current?.starting).toBe(false);
  cleanup();
  localStorage.setItem('mygitnotes.piAgent.location', JSON.stringify({ repository: home, folder: 'flaky' }));
  const failed = mount();
  await waitFor(() => expect(failed.current?.error).toBe('Pi could not start.'));
  expect(failed.current?.starting).toBe(false);
});

it('falls back to the home root when the remembered workspace is gone, and forgets it', async () => {
  localStorage.setItem('mygitnotes.piAgent.location', JSON.stringify({ repository: home, folder: 'gone' }));
  const agent = mount();
  await waitFor(() => expect(agent.current?.session?.id).toBe('s1'));
  expect(requests.filter(request => request.method === 'POST').map(request => request.body)).toEqual([{ repository: home, folder: 'gone' }, { repository: home, folder: '' }]);
  expect(localStorage.getItem('mygitnotes.piAgent.location')).toBeNull();
});

it('keeps the remembered workspace when starting fails for another reason', async () => {
  const remembered = JSON.stringify({ repository: home, folder: 'flaky' });
  localStorage.setItem('mygitnotes.piAgent.location', remembered);
  const agent = mount();
  await waitFor(() => expect(agent.current?.error).toBe('Pi could not start.'));
  expect(requests.filter(request => request.method === 'POST').map(request => request.body)).toEqual([{ repository: home, folder: 'flaky' }]);
  expect(localStorage.getItem('mygitnotes.piAgent.location')).toBe(remembered);
});

it('remembers the live conversation and resumes it, with the remembered folder, on the next start', async () => {
  localStorage.setItem('mygitnotes.piAgent.location', JSON.stringify({ repository: home, folder: 'blog' }));
  localStorage.setItem('mygitnotes.piAgent.sessionFile', '/home/me/.pi/agent/sessions/old.jsonl');
  mount();
  await waitFor(() => expect(requests.find(request => request.method === 'POST')?.body).toEqual({ repository: home, folder: 'blog', sessionFile: '/home/me/.pi/agent/sessions/old.jsonl' }));
  await waitFor(() => expect(FakeSocket.last).toBeDefined());
  act(() => FakeSocket.last!.receive({ type: 'bridge_status', session: live({ sessionFile: '/home/me/.pi/agent/sessions/new.jsonl' }) }));
  expect(localStorage.getItem('mygitnotes.piAgent.sessionFile')).toBe('/home/me/.pi/agent/sessions/new.jsonl');
  // An ended session's file is not the one to resume.
  act(() => FakeSocket.last!.receive({ type: 'bridge_status', session: live({ sessionFile: '/home/me/.pi/agent/sessions/ended.jsonl', status: 'exited' }) }));
  expect(localStorage.getItem('mygitnotes.piAgent.sessionFile')).toBe('/home/me/.pi/agent/sessions/new.jsonl');
});

it('forgets the conversation when the session is ended or the workspace is switched, and remembers the workspace', async () => {
  localStorage.setItem('mygitnotes.piAgent.sessionFile', '/home/me/.pi/agent/sessions/old.jsonl');
  const agent = mount();
  await waitFor(() => expect(agent.current?.session?.id).toBe('s1'));
  await act(() => agent.current!.end());
  expect(localStorage.getItem('mygitnotes.piAgent.sessionFile')).toBeNull();

  localStorage.setItem('mygitnotes.piAgent.sessionFile', '/home/me/.pi/agent/sessions/old.jsonl');
  await act(() => agent.current!.switchWorkspace({ repository: home, folder: 'blog' }));
  expect(requests.at(-1)).toEqual({ method: 'PUT', body: { repository: home, folder: 'blog' } });
  expect(localStorage.getItem('mygitnotes.piAgent.sessionFile')).toBeNull();
  expect(JSON.parse(localStorage.getItem('mygitnotes.piAgent.location')!)).toEqual({ repository: home, folder: 'blog' });
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

it("connects to the session's own socket when the agent names one, and keeps it through bridge status records", async () => {
  sessionOverrides = { socket: { url: 'wss://sandbox.example/rpc?ticket=abc', protocols: ['pi.v1'] } };
  const agent = mount();
  await waitFor(() => expect(FakeSocket.last).toBeDefined());
  expect(FakeSocket.last).toMatchObject({ url: 'wss://sandbox.example/rpc?ticket=abc', protocols: ['pi.v1'] });
  // The remote bridge does not know the address it was reached at.
  act(() => FakeSocket.last!.receive({ type: 'bridge_status', session: live() }));
  expect(agent.current?.session?.socket).toEqual({ url: 'wss://sandbox.example/rpc?ticket=abc', protocols: ['pi.v1'] });
});

it("opens the page's own /api/pi/ws when the session names no socket", async () => {
  mount();
  await waitFor(() => expect(FakeSocket.last).toBeDefined());
  expect(FakeSocket.last!.url).toBe(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/pi/ws`);
  expect(FakeSocket.last!.protocols).toBeUndefined();
});

it('picks the socket from the session, falling back to the page host over TLS or not', () => {
  expect(agentSocketTarget({ socket: { url: 'wss://a.example/x' } }, { protocol: 'http:', host: 'localhost:4321' })).toEqual({ url: 'wss://a.example/x' });
  expect(agentSocketTarget(null, { protocol: 'http:', host: 'localhost:4321' })).toEqual({ url: 'ws://localhost:4321/api/pi/ws' });
  expect(agentSocketTarget({}, { protocol: 'https:', host: 'notes.example' })).toEqual({ url: 'wss://notes.example/api/pi/ws' });
});

it('starts no session while an edition gates the agent off, and still offers the panel to show its reason', async () => {
  const agent = mount([{ id: 'plans', gate: id => ({ allowed: id !== 'agent', reason: 'Upgrade to Pro.' }) }]);
  await waitFor(() => expect(requests.some(request => request.method === 'GET')).toBe(true));
  await waitFor(() => expect(agent.current?.available).toBe(true));
  expect(requests.some(request => request.method === 'POST')).toBe(false);
  expect(FakeSocket.last).toBeUndefined();
});

it("answers the agent's note tools with the page's handler, its errors included, and without one says the page cannot", async () => {
  const handler = vi.fn(async (tool: string, args: Record<string, unknown>) => {
    if (tool === 'delete_note') throw new Error('The person is editing notes/a.md; ask them to finish first.');
    return { tool, args };
  });
  mount([], handler);
  await waitFor(() => expect(FakeSocket.last).toBeDefined());
  const socket = FakeSocket.last!;
  act(() => {
    socket.readyState = FakeSocket.OPEN;
    socket.onopen?.();
    socket.receive({ type: 'web_tool_request', id: 'w1', tool: 'read_note', arguments: { path: 'notes/a.md' } });
    socket.receive({ type: 'web_tool_request', id: 'w2', tool: 'delete_note', arguments: { path: 'notes/a.md' } });
  });
  await waitFor(() => expect(socket.sent.filter(record => record.type === 'web_tool_response')).toHaveLength(2));
  expect(socket.sent).toContainEqual({ type: 'web_tool_response', id: 'w1', result: { tool: 'read_note', args: { path: 'notes/a.md' } } });
  expect(socket.sent).toContainEqual({ type: 'web_tool_response', id: 'w2', error: 'The person is editing notes/a.md; ask them to finish first.' });
  cleanup();
  mount();
  await waitFor(() => expect(FakeSocket.last).not.toBe(socket));
  const bare = FakeSocket.last!;
  act(() => {
    bare.readyState = FakeSocket.OPEN;
    bare.receive({ type: 'web_tool_request', id: 'w3', tool: 'read_note', arguments: {} });
  });
  expect(bare.sent).toContainEqual({ type: 'web_tool_response', id: 'w3', error: 'This page cannot edit notes for the agent.' });
});

it('checks the models again by ending the session and starting a fresh one, since Pi reads keys only at start', async () => {
  const agent = mount();
  await waitFor(() => expect(agent.current?.session?.id).toBe('s1'));
  requests = [];
  act(() => agent.current!.checkModels());
  await waitFor(() => expect(requests.map(request => request.method)).toEqual(['DELETE', 'POST']));
  expect(requests[1].body).toEqual({ repository: home, folder: '' });
});
