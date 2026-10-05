// @vitest-environment jsdom
import { createElement } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { AgentPanel } from './AgentPanel.js';
import { createCaretStore } from '../../lib/pi-agent/caret-store.js';
import { PiAgentContext, type PiAgentValue } from '../../lib/pi-agent/session.js';
import { emptyTranscript, type TranscriptState } from '../../lib/pi-agent/transcript.js';

afterEach(cleanup);

function agent(overrides: Partial<PiAgentValue> = {}): PiAgentValue {
  return { available: true, session: { id: 's1', cwd: '/home/me/workspace', approve: false, status: 'ready', startedAt: '' }, defaultCwd: '/home/me/workspace', workspaceRoots: ['/home/me/workspace', '/home/me/other'], connected: true, transcript: emptyTranscript, error: '', start: vi.fn(async () => {}), send: vi.fn(), abort: vi.fn(), answer: vi.fn(), newConversation: vi.fn(), end: vi.fn(async () => {}), switchCwd: vi.fn(async () => {}), locate: vi.fn(async (path: string) => `/home/me/workspace/${path}`), ...overrides };
}

function panel(value: PiAgentValue, caret = createCaretStore()) {
  render(createElement(PiAgentContext.Provider, { value }, createElement(AgentPanel, { notebookId: 'nb', notePath: 'notes/plan.md', content: 'one\ntwo three', lineNumberOffset: 3, caret })));
  return caret;
}

it('sends a message with the note path and the live caret position', async () => {
  const value = agent();
  const caret = panel(value);
  await waitFor(() => expect(value.locate).toHaveBeenCalledWith('notes/plan.md', 'nb'));
  act(() => caret.set(8));
  expect(screen.getByText('plan.md:5:5')).toBeTruthy();
  const box = screen.getByRole('textbox', { name: 'Message to Pi' });
  fireEvent.change(box, { target: { value: 'Explain this' } });
  await waitFor(() => expect(screen.getByText('plan.md:5:5').closest('label')?.getAttribute('title')).toBe('/home/me/workspace/notes/plan.md'));
  fireEvent.keyDown(box, { key: 'Enter' });
  expect(value.send).toHaveBeenCalledWith('Explain this', { file: '/home/me/workspace/notes/plan.md', line: 5, column: 5 });
});

it('omits the note when its checkbox is cleared', async () => {
  const value = agent();
  panel(value);
  await waitFor(() => expect(value.locate).toHaveBeenCalled());
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.change(screen.getByRole('textbox', { name: 'Message to Pi' }), { target: { value: 'General question' } });
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));
  expect(value.send).toHaveBeenCalledWith('General question', undefined);
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

it('switches the working folder only through the confirming form, with trust off by default', async () => {
  const value = agent();
  panel(value);
  fireEvent.click(screen.getByRole('button', { name: 'Change working folder' }));
  expect(screen.getByText(/ends the current Pi session and clears this conversation/)).toBeTruthy();
  fireEvent.change(screen.getByRole('combobox'), { target: { value: '/home/me/other' } });
  fireEvent.click(screen.getByRole('button', { name: 'End session and switch' }));
  await waitFor(() => expect(value.switchCwd).toHaveBeenCalledWith('/home/me/other', false));
});

it('offers a manual start when no session runs, showing why the last one ended', () => {
  const value = agent({ session: { id: 's1', cwd: '/w', approve: false, status: 'exited', startedAt: '', exit: { code: 1, signal: null, stderr: 'No API key' } }, connected: false });
  panel(value);
  expect(screen.getByText('No API key')).toBeTruthy();
  expect((screen.getByRole('textbox', { name: 'Message to Pi' }) as HTMLTextAreaElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Start session' }));
  expect(value.start).toHaveBeenCalled();
});
