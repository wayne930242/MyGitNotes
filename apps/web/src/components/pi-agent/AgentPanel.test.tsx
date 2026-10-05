// @vitest-environment jsdom
import { createElement } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AgentPanel } from './AgentPanel.js';
import { createCaretStore } from '../../lib/pi-agent/caret-store.js';
import { type AgentTarget, PiAgentContext, type PiAgentValue } from '../../lib/pi-agent/session.js';
import type { FolderItem, NotebookConfig } from '../../lib/types.js';
import { emptyTranscript, type TranscriptState } from '../../lib/pi-agent/transcript.js';

afterEach(() => {
  cleanup();
  localStorage.clear();
});

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.removeAttribute('open');
  };
});

const notebooks: NotebookConfig[] = [{ id: 'nb', title: 'Notes', root: 'notes' }, { id: 'blog', title: 'Blog', root: 'blog/posts' }];
const folders: FolderItem[] = [{ notebookId: 'blog', path: 'drafts', title: 'Drafts', order: 0 }];

function agent(overrides: Partial<PiAgentValue> = {}): PiAgentValue {
  return { available: true, session: { id: 's1', cwd: '/home/me/workspace', location: { notebookId: 'nb', folder: null, repository: true }, trusted: true, status: 'ready', startedAt: '' }, target: null, notebooks, folders, connected: true, transcript: emptyTranscript, modelState: { models: [], levels: [] }, setModel: vi.fn(), setThinking: vi.fn(), error: '', start: vi.fn(async () => {}), send: vi.fn(), abort: vi.fn(), answer: vi.fn(), newConversation: vi.fn(), end: vi.fn(async () => {}), switchFolder: vi.fn(async () => {}), locate: vi.fn(async (path: string) => `/home/me/workspace/${path}`), ...overrides };
}

function noteTarget(caret = createCaretStore()): AgentTarget {
  return { notebookId: 'nb', path: 'notes/plan.md', caret, content: () => 'one\ntwo three', lineNumberOffset: 3 };
}

function panel(value: PiAgentValue) {
  render(createElement(PiAgentContext.Provider, { value }, createElement(AgentPanel)));
}

const write = (text: string) => fireEvent.change(screen.getByRole('textbox', { name: 'Message to Pi' }), { target: { value: text } });

it('sends a message with the note path from the folder Pi runs in and the live caret line, and names that folder', async () => {
  const target = noteTarget();
  const value = agent({ target });
  panel(value);
  expect(screen.getByText('workspace')).toBeTruthy();
  await waitFor(() => expect(value.locate).toHaveBeenCalledWith('notes/plan.md', 'nb'));
  act(() => target.caret!.set(8));
  await waitFor(() => expect(screen.getByText('plan.md:5:5').getAttribute('title')).toBe('/home/me/workspace/notes/plan.md'));
  write('Explain this');
  fireEvent.keyDown(screen.getByRole('textbox', { name: 'Message to Pi' }), { key: 'Enter' });
  expect(value.send).toHaveBeenCalledWith('Explain this', { file: 'notes/plan.md', line: 5, column: 5 });
});

it('sends the selected lines when text is selected, in either direction', async () => {
  const target = noteTarget();
  const value = agent({ target });
  panel(value);
  // Dragged upwards: the caret ends at the start of the selection.
  act(() => target.caret!.set(13, 2));
  await waitFor(() => expect(screen.getByText('plan.md:4-5')).toBeTruthy());
  write('Rewrite this');
  fireEvent.keyDown(screen.getByRole('textbox', { name: 'Message to Pi' }), { key: 'Enter' });
  expect(value.send).toHaveBeenCalledWith('Rewrite this', { file: 'notes/plan.md', line: 4, column: 3, endLine: 5, endColumn: 10 });
});

it('sends the path only, or nothing, as the chosen context mode says, and remembers the choice', async () => {
  const value = agent({ target: noteTarget() });
  panel(value);
  await waitFor(() => expect(screen.getByText('plan.md:4:1')).toBeTruthy());
  fireEvent.click(screen.getByRole('radio', { name: 'Path only' }));
  expect(screen.getByText('plan.md')).toBeTruthy();
  write('What is this?');
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));
  expect(value.send).toHaveBeenLastCalledWith('What is this?', { file: 'notes/plan.md' });
  fireEvent.click(screen.getByRole('radio', { name: 'None' }));
  write('General question');
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));
  expect(value.send).toHaveBeenLastCalledWith('General question', undefined);
  expect(localStorage.getItem('mygitnotes.piAgent.context')).toBe('none');
});

it('names a compilation by path, since it has no caret, and offers no context on the notebook list', async () => {
  const value = agent({ target: { notebookId: 'nb', path: 'notes/reading.compilation.yml' } });
  panel(value);
  await waitFor(() => expect(screen.getByText('reading.compilation.yml')).toBeTruthy());
  expect((screen.getByRole('radio', { name: 'Line' }) as HTMLButtonElement).disabled).toBe(true);
  write('Summarize');
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));
  expect(value.send).toHaveBeenCalledWith('Summarize', { file: 'notes/reading.compilation.yml' });
  cleanup();

  const list = agent();
  panel(list);
  expect(screen.queryByRole('radiogroup')).toBeNull();
  write('Hello');
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));
  expect(list.send).toHaveBeenCalledWith('Hello', undefined);
});

it('answers ask_user dialogs, which Pi sends as select and input requests', () => {
  const transcript: TranscriptState = { ...emptyTranscript, dialogs: [{ id: 'd1', method: 'select', title: 'Which layout?', options: ['Grid', 'List'] }, { id: 'd2', method: 'input', title: 'Name it' }] };
  const value = agent({ transcript });
  panel(value);
  fireEvent.click(screen.getByRole('button', { name: 'List' }));
  expect(value.answer).toHaveBeenCalledWith(transcript.dialogs[0], { value: 'List' });
  fireEvent.change(screen.getByRole('textbox', { name: 'Name it' }), { target: { value: 'Draft' } });
  fireEvent.click(screen.getAllByRole('button', { name: 'Submit' })[0]);
  expect(value.answer).toHaveBeenCalledWith(transcript.dialogs[1], { value: 'Draft' });
  fireEvent.click(screen.getAllByRole('button', { name: 'Cancel' })[0]);
  expect(value.answer).toHaveBeenCalledWith(transcript.dialogs[0], { cancelled: true });
});

it("shows Pi's own project-trust decision, which the panel does not override", () => {
  panel(agent());
  // It sits in the send row beside the extension info, not in the header.
  const trusted = screen.getByRole('img', { name: 'Trusted' });
  expect(trusted.getAttribute('title')).toContain('/trust');
  expect(trusted.closest('.pi-agent-dialog-actions')).toBeTruthy();
  cleanup();
  panel(agent({ session: { id: 's2', cwd: '/w', location: { notebookId: 'nb', folder: null }, trusted: false, status: 'ready', startedAt: '' } }));
  expect(screen.getByRole('img', { name: 'Not trusted' })).toBeTruthy();
});

it("lists Pi's enabled and disabled MCP servers in the tooltip of an icon beside the trust label", () => {
  const session = { id: 's1', cwd: '/w', location: { notebookId: 'nb', folder: null }, status: 'ready' as const, startedAt: '' };
  panel(agent({ session: { ...session, mcpServers: [{ name: 'linear', status: 'connected', toolCount: 12 }, { name: 'figma', status: 'cached', toolCount: 1 }, { name: 'trello', status: 'disabled', toolCount: 0 }, { name: 'local', status: 'blocked', toolCount: 0, blockedReason: 'untrusted' }] } }));
  const mcp = screen.getByRole('img', { name: 'MCP servers: 2 of 4 enabled' });
  expect(mcp.getAttribute('title')).toBe('MCP servers: 2 of 4 enabled\nEnabled (2)\n  linear · connected · 12 tools\n  figma · not started yet · 1 tool\nDisabled (2)\n  trello\n  local · blocked (untrusted)');
  expect(mcp.closest('.pi-agent-dialog-actions')).toBeTruthy();
  cleanup();
  // Without pi-mcp-adapter's report there is no icon.
  panel(agent({ session }));
  expect(screen.queryByRole('img', { name: /MCP servers/ })).toBeNull();
});

it('switches to a notebook folder picked in the folder dialog, without a trust override', async () => {
  const value = agent();
  panel(value);
  // The folder name in the header is the way into the folder picker.
  fireEvent.click(screen.getByRole('button', { name: 'workspace' }));
  expect(screen.getByText(/ends the current Pi session and clears this conversation/)).toBeTruthy();
  expect(screen.getByRole('combobox', { name: 'Notebook' })).toBeTruthy();
  // The session runs at the whole project; the tree's root is the notebook's own root.
  fireEvent.click(screen.getByRole('button', { name: 'All folders' }));
  expect(screen.getByRole('button', { name: 'Whole project (repository root)' }).getAttribute('aria-pressed')).toBe('false');
  fireEvent.click(screen.getByRole('button', { name: 'End session and switch' }));
  expect(screen.queryByRole('checkbox')).toBeNull();
  await waitFor(() => expect(value.switchFolder).toHaveBeenCalledWith({ notebookId: 'nb', folder: null }));
});

it("switches to the whole project, the root of the notebook's repository, and names it by its folder", async () => {
  const value = agent();
  panel(value);
  fireEvent.click(screen.getByRole('button', { name: 'workspace' }));
  const project = screen.getByRole('button', { name: 'Whole project (repository root)' });
  fireEvent.click(project);
  expect(project.getAttribute('aria-pressed')).toBe('true');
  fireEvent.click(screen.getByRole('button', { name: 'End session and switch' }));
  await waitFor(() => expect(value.switchFolder).toHaveBeenCalledWith({ notebookId: 'nb', folder: null, repository: true }));

  cleanup();
  panel(agent({ session: { ...value.session!, cwd: '/home/me/workspace', location: { notebookId: 'nb', folder: null, repository: true } } }));
  expect(screen.getByRole('button', { name: 'workspace' })).toBeTruthy();
});

it('shows the session model and thinking level, offering only levels the model supports', () => {
  panel(agent({ modelState: { model: 'anthropic/claude-opus', thinking: 'high', models: [{ value: 'anthropic/claude-opus', label: 'Claude Opus (anthropic)' }], levels: ['low', 'high'] } }));
  expect(screen.getByRole('combobox', { name: 'Model' }).textContent).toContain('Claude Opus (anthropic)');
  expect(screen.getByRole('combobox', { name: 'Thinking level' }).textContent).toContain('high');
  cleanup();
  panel(agent({ modelState: { model: 'anthropic/claude-opus', models: [{ value: 'anthropic/claude-opus', label: 'Claude Opus (anthropic)' }], levels: ['off'] } }));
  expect(screen.queryByRole('combobox', { name: 'Thinking level' })).toBeNull();
});

it('offers a manual start when no session runs, showing why the last one ended', () => {
  const value = agent({ session: { id: 's1', cwd: '/w', location: { notebookId: 'nb', folder: null }, status: 'exited', startedAt: '', exit: { code: 1, signal: null, stderr: 'No API key' } }, connected: false });
  panel(value);
  expect(screen.getByText('No API key')).toBeTruthy();
  expect((screen.getByRole('textbox', { name: 'Message to Pi' }) as HTMLTextAreaElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Start session' }));
  expect(value.start).toHaveBeenCalled();
});
