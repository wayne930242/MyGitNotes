// @vitest-environment jsdom
import { createElement } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AgentPanel } from './AgentPanel.js';
import { createCaretStore } from '../../lib/pi-agent/caret-store.js';
import { type AgentTarget, PiAgentContext, type PiAgentValue } from '../../lib/pi-agent/session.js';
import type { NotebookConfig } from '../../lib/types.js';
import { emptyTranscript, type TranscriptState } from '../../lib/pi-agent/transcript.js';
import { type WebFeature, WebFeaturesProvider } from '../../lib/web-features.js';

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
const home = 'local:home';
const repositories = [{ id: home, notebooks: ['nb', 'blog'] }];
const workspaces = [{ repository: home, folder: '', hasInstructions: true, parents: [] }, { repository: home, folder: 'blog', hasInstructions: true, parents: [''] }];

function agent(overrides: Partial<PiAgentValue> = {}): PiAgentValue {
  return { available: true, session: { id: 's1', cwd: '/home/me/workspace', location: { repository: home, folder: '' }, trusted: true, status: 'ready', startedAt: '' }, target: null, notebooks, repositories, homeRepository: home, workspaceTitle: 'Knowledge Base', workspaces, loadWorkspaces: vi.fn(async () => {}), connected: true, transcript: emptyTranscript, modelState: { models: [], levels: [] }, checkModels: vi.fn(), setModel: vi.fn(), setThinking: vi.fn(), error: '', start: vi.fn(async () => {}), send: vi.fn(() => true), commands: [], loadCommands: vi.fn(), editorText: null, takeEditorText: vi.fn(), abort: vi.fn(async () => ''), answer: vi.fn(), newConversation: vi.fn(), end: vi.fn(async () => {}), switchWorkspace: vi.fn(async () => {}), locate: vi.fn(async (path: string) => `/home/me/workspace/${path}`), ...overrides };
}

function noteTarget(caret = createCaretStore()): AgentTarget {
  return { notebookId: 'nb', path: 'notes/plan.md', caret, content: () => 'one\ntwo three', lineNumberOffset: 3 };
}

function panel(value: PiAgentValue) {
  render(createElement(PiAgentContext.Provider, { value }, createElement(AgentPanel)));
}

const write = (text: string) => fireEvent.change(screen.getByRole('textbox', { name: 'Message to Pi' }), { target: { value: text } });

it('sends a message with the note path from the folder Pi runs in and the live caret line, and names its workspace', async () => {
  const target = noteTarget();
  const value = agent({ target });
  panel(value);
  expect(screen.getByText('Knowledge Base')).toBeTruthy();
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

it("shows Pi's own project-trust decision in a drawer between the message box and the send row, and remembers it open", () => {
  panel(agent());
  // The toggle sits in the send row; the drawer opens above that row, below the message box.
  const toggle = screen.getByRole('button', { name: 'Trusted' });
  expect(toggle.closest('.pi-agent-dialog-actions')).toBeTruthy();
  fireEvent.click(toggle);
  const drawer = screen.getByRole('region', { name: 'Project trust' });
  // The message box sits in its wrapper with the command menu that floats above it.
  expect(drawer.previousElementSibling?.querySelector('textarea')).toBe(screen.getByRole('textbox', { name: 'Message to Pi' }));
  expect(drawer.textContent).toContain('/trust');
  expect(localStorage.getItem('mygitnotes.piAgent.infoSection')).toBe('trust');
  cleanup();
  panel(agent({ session: { id: 's2', cwd: '/w', location: { repository: home, folder: '' }, trusted: false, status: 'ready', startedAt: '' } }));
  // Still open after a reload; the open toggle closes it.
  expect(screen.getByRole('region', { name: 'Project trust' }).textContent).toContain('Not trusted');
  fireEvent.click(screen.getByRole('button', { name: 'Not trusted' }));
  expect(screen.queryByRole('region', { name: 'Project trust' })).toBeNull();
  expect(localStorage.getItem('mygitnotes.piAgent.infoSection')).toBeNull();
});

it("lists Pi's MCP servers in the drawer, enabled ones and disabled ones apart, each with a status badge", () => {
  const session = { id: 's1', cwd: '/w', location: { repository: home, folder: '' }, status: 'ready' as const, startedAt: '' };
  panel(agent({ session: { ...session, mcpServers: [{ name: 'linear', status: 'connected', toolCount: 12 }, { name: 'figma', status: 'cached', toolCount: 1 }, { name: 'trello', status: 'disabled', toolCount: 0 }, { name: 'local', status: 'blocked', toolCount: 0, blockedReason: 'untrusted' }] } }));
  fireEvent.click(screen.getByRole('button', { name: 'MCP servers: 2 of 4 enabled' }));
  const rows = [...screen.getByRole('region', { name: 'MCP servers' }).querySelectorAll('h4, li')].map(row => row.textContent);
  expect(rows).toEqual(['Enabled (2)', 'linearconnected12 tools', 'figmanot started yet1 tool', 'Disabled (2)', 'trello', 'localblocked']);
  expect(screen.getByText('connected').getAttribute('data-tone')).toBe('ok');
  expect(screen.getByText('blocked').getAttribute('title')).toBe('untrusted');
  cleanup();
  // Without pi-mcp-adapter's report there is no toggle.
  panel(agent({ session }));
  expect(screen.queryByRole('button', { name: /MCP servers/ })).toBeNull();
});

it('labels each extension report with its key and clamps a long one until clicked', () => {
  panel(agent({ transcript: { ...emptyTranscript, statuses: { 'usage-status': 'usage unavailable' }, widgets: { lsp: ['ts: ready'] } } }));
  fireEvent.click(screen.getByRole('button', { name: 'Extension status' }));
  const drawer = screen.getByRole('region', { name: 'Extension status' });
  expect([...drawer.querySelectorAll('.pi-agent-badge')].map(badge => badge.textContent)).toEqual(['usage-status', 'lsp']);
  const report = screen.getByRole('button', { name: 'usage unavailable' });
  fireEvent.click(report);
  expect(report.getAttribute('aria-expanded')).toBe('true');
  expect(drawer.querySelector('pre')?.textContent).toBe('ts: ready');
});

it('switches to another agent workspace picked in the header dialog, after warning that the conversation ends', async () => {
  const value = agent();
  panel(value);
  // The workspace name in the header is the way into the workspace picker.
  fireEvent.click(screen.getByRole('button', { name: 'Knowledge Base' }));
  expect(value.loadWorkspaces).toHaveBeenCalled();
  expect(screen.getByText(/ends the current conversation with Pi/)).toBeTruthy();
  expect(screen.getAllByRole('button', { name: 'Knowledge Base' }).some(button => button.getAttribute('aria-pressed') === 'true')).toBe(true);
  expect((screen.getByRole('button', { name: 'End conversation and switch' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: /^blog/ }));
  fireEvent.click(screen.getByRole('button', { name: 'End conversation and switch' }));
  expect(screen.queryByRole('checkbox')).toBeNull();
  await waitFor(() => expect(value.switchWorkspace).toHaveBeenCalledWith({ repository: home, folder: 'blog' }));

  cleanup();
  panel(agent({ session: { ...value.session!, cwd: '/home/me/workspace/blog', location: { repository: home, folder: 'blog' } } }));
  expect(screen.getByRole('button', { name: 'blog' })).toBeTruthy();
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
  const value = agent({ session: { id: 's1', cwd: '/w', location: { repository: home, folder: '' }, status: 'exited', startedAt: '', exit: { code: 1, signal: null, stderr: 'No API key' } }, connected: false });
  panel(value);
  expect(screen.getByText('No API key')).toBeTruthy();
  expect((screen.getByRole('textbox', { name: 'Message to Pi' }) as HTMLTextAreaElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Start session' }));
  expect(value.start).toHaveBeenCalled();
});

it('shows messages Pi has queued while it works, and puts them back in the message box when the run is stopped', async () => {
  const value = agent({ transcript: { ...emptyTranscript, running: true, queued: [{ kind: 'steer', text: 'also check the intro' }, { kind: 'followUp', text: 'then summarize' }] }, abort: vi.fn(async () => 'also check the intro\n\nthen summarize') });
  panel(value);
  const queue = screen.getByRole('list', { name: 'Queued messages' });
  expect([...queue.querySelectorAll('li')].map(item => item.textContent)).toEqual(['Queuedalso check the intro', 'Afterthen summarize']);
  fireEvent.change(screen.getByRole('textbox', { name: 'Message to Pi' }), { target: { value: 'draft in progress' } });
  fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
  await waitFor(() => expect((screen.getByRole('textbox', { name: 'Message to Pi' }) as HTMLTextAreaElement).value).toBe('also check the intro\n\nthen summarize\n\ndraft in progress'));
});

it('offers the matching slash commands while the name is typed, completing one with Enter and sending it with the next', () => {
  const value = agent({ commands: [{ name: 'reload', source: 'extension', description: 'Reload extensions' }, { name: 'skill:review', source: 'skill', description: 'Review code' }, { name: 'compact', source: 'extension' }] });
  panel(value);
  write('/re');
  expect(value.loadCommands).toHaveBeenCalled();
  const options = screen.getAllByRole('option').map(option => option.textContent);
  // Prefix matches first; a Pi command named like a built-in is left out, since the panel runs the built-in.
  expect(options).toEqual(['/reloadReload extensionsextension', '/skill:reviewReview codeskill']);
  const box = screen.getByRole('textbox', { name: 'Message to Pi' });
  fireEvent.keyDown(box, { key: 'Enter' });
  expect((box as HTMLTextAreaElement).value).toBe('/reload ');
  expect(screen.queryByRole('listbox')).toBeNull();
  fireEvent.keyDown(box, { key: 'Enter' });
  expect(value.send).toHaveBeenCalledWith('/reload', undefined);
});

it('lists the built-ins, moves through the menu with the arrows, and closes it with Esc', () => {
  const value = agent();
  panel(value);
  write('/');
  expect(screen.getAllByRole('option').map(option => option.querySelector('.pi-agent-command-name')?.textContent)).toEqual(['/compact [focus]', '/name <name>', '/new']);
  const box = screen.getByRole('textbox', { name: 'Message to Pi' });
  fireEvent.keyDown(box, { key: 'ArrowDown' });
  expect(screen.getAllByRole('option')[1].getAttribute('aria-selected')).toBe('true');
  fireEvent.keyDown(box, { key: 'Tab' });
  expect((box as HTMLTextAreaElement).value).toBe('/name ');
  write('/n');
  fireEvent.keyDown(box, { key: 'Escape' });
  expect(screen.queryByRole('listbox')).toBeNull();
  expect(value.send).not.toHaveBeenCalled();
});

it('keeps /name waiting for its argument when the provider cannot send it yet', () => {
  const value = agent({ send: vi.fn(() => false) });
  panel(value);
  write('/name');
  const box = screen.getByRole('textbox', { name: 'Message to Pi' });
  // The typed-out name sends rather than completing.
  fireEvent.keyDown(box, { key: 'Enter' });
  expect(value.send).toHaveBeenCalledWith('/name', undefined);
  expect((box as HTMLTextAreaElement).value).toBe('/name ');
});

it('labels a shell command Run, fills the message box when an extension sets its text, and shows how full the context is', () => {
  const value = agent({ contextUsage: { tokens: 164_000, contextWindow: 200_000, percent: 82 } });
  panel(value);
  write('!ls -la');
  expect(screen.getByRole('button', { name: 'Run' })).toBeTruthy();
  const usage = screen.getByLabelText('Context: 164k of 200k tokens');
  expect(usage.textContent).toBe('82%');
  expect(usage.getAttribute('data-tone')).toBe('warning');
  cleanup();
  const editorText = { text: '! pnpm test', serial: 1 };
  const filled = agent({ editorText });
  panel(filled);
  expect((screen.getByRole('textbox', { name: 'Message to Pi' }) as HTMLTextAreaElement).value).toBe('! pnpm test');
  expect(filled.takeEditorText).toHaveBeenCalledWith(editorText);
});

it("shows an edition gate's reason in place of the panel, and the panel again once it allows", () => {
  const gated = (allowed: boolean): WebFeature => ({ id: 'plans', gate: id => id === 'agent' ? { allowed, reason: 'The agent is part of Pro.' } : { allowed: true } });
  const view = render(createElement(WebFeaturesProvider, { features: [gated(false)] }, createElement(PiAgentContext.Provider, { value: agent() }, createElement(AgentPanel))));
  expect(screen.getByRole('status').textContent).toBe('The agent is part of Pro.');
  expect(screen.queryByRole('textbox', { name: 'Message to Pi' })).toBeNull();
  view.rerender(createElement(WebFeaturesProvider, { features: [gated(true)] }, createElement(PiAgentContext.Provider, { value: agent() }, createElement(AgentPanel))));
  expect(screen.getByRole('textbox', { name: 'Message to Pi' })).toBeTruthy();
  expect(screen.queryByText('The agent is part of Pro.')).toBeNull();
});

it('gives a denied agent panel a plain reason when the gate names none', () => {
  render(createElement(WebFeaturesProvider, { features: [{ id: 'plans', gate: () => ({ allowed: false }) }] }, createElement(PiAgentContext.Provider, { value: agent() }, createElement(AgentPanel))));
  expect(screen.getByRole('status').textContent).toBe('This feature is not available to you.');
});

it("puts Pi's setup in place of the message box when Pi answered with no model, and asks again on request", () => {
  const value = agent({ modelState: { models: [], levels: [], loaded: true } });
  panel(value);
  expect(screen.queryByRole('textbox', { name: 'Message to Pi' })).toBeNull();
  expect(screen.getByText('Pi has no model it can use yet.')).toBeTruthy();
  expect(screen.getByRole('link', { name: 'How to set up a provider' }).getAttribute('href')).toContain('providers.md');
  fireEvent.click(screen.getByRole('button', { name: 'Check again' }));
  expect(value.checkModels).toHaveBeenCalled();
});

it('keeps the message box while the model list has not arrived, and once it has models', () => {
  panel(agent());
  expect(screen.getByRole('textbox', { name: 'Message to Pi' })).toBeTruthy();
  cleanup();
  panel(agent({ modelState: { models: [{ value: 'openai/gpt', label: 'GPT (openai)' }], levels: [], loaded: true } }));
  expect(screen.getByRole('textbox', { name: 'Message to Pi' })).toBeTruthy();
  expect(screen.queryByText('Pi has no model it can use yet.')).toBeNull();
});

it("shows an edition's model setup instead of Pi's own, with the check-again button", () => {
  const value = agent({ modelState: { models: [], levels: [], loaded: true } });
  const feature: WebFeature = { id: 'pro', agentModelSetup: createElement('p', null, 'Add a key in Settings') };
  render(createElement(WebFeaturesProvider, { features: [feature] }, createElement(PiAgentContext.Provider, { value }, createElement(AgentPanel))));
  expect(screen.getByText('Add a key in Settings')).toBeTruthy();
  expect(screen.queryByText('Pi has no model it can use yet.')).toBeNull();
  expect(screen.getByRole('button', { name: 'Check again' })).toBeTruthy();
});
