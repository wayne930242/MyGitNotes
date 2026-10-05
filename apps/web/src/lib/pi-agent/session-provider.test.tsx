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
  send() {}
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
