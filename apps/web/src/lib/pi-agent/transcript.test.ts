import { describe, expect, it } from 'vitest';
import { applyRecord, caretPosition, emptyTranscript, focusLabel, splitFocus, stripTerminalStyles, transcriptFromMessages, type TranscriptState, withFocus } from './transcript.js';

const apply = (records: unknown[], state: TranscriptState = emptyTranscript) => records.reduce<TranscriptState>(applyRecord, state);

describe('focus prefix', () => {
  it('names the note and caret ahead of the message and splits back off for display', () => {
    const focus = { file: '/home/me/notes/a b.md', line: 12, column: 5 };
    const message = withFocus('Summarize this section', focus);
    expect(message).toBe('<editor-context>\nfile: /home/me/notes/a b.md\ncursor: line 12, column 5\n</editor-context>\n\nSummarize this section');
    expect(splitFocus(message)).toEqual({ text: 'Summarize this section', focus });
    expect(focusLabel(focus)).toBe('a b.md:12:5');
    const pathOnly = withFocus('What is this?', { file: '/home/me/notes/x.compilation.yml' });
    expect(pathOnly).not.toContain('cursor:');
    expect(splitFocus(pathOnly)).toEqual({ text: 'What is this?', focus: { file: '/home/me/notes/x.compilation.yml' } });
    expect(focusLabel({ file: '/home/me/notes/x.compilation.yml' })).toBe('x.compilation.yml');
    expect(splitFocus('plain')).toEqual({ text: 'plain' });
    expect(withFocus('plain', undefined)).toBe('plain');
  });

  it('counts the caret in file lines, past the frontmatter above the body', () => {
    expect(caretPosition('first\nsecond line', 9, 4)).toEqual({ line: 6, column: 4 });
    expect(caretPosition('', 0)).toEqual({ line: 1, column: 1 });
    expect(caretPosition('abc', 99)).toEqual({ line: 1, column: 4 });
  });
});

describe('transcript', () => {
  it('rebuilds history, pairing tool calls with their results', () => {
    const state = transcriptFromMessages([{ role: 'user', content: withFocus('hi', { file: '/n.md', line: 1, column: 1 }), timestamp: 1 }, { role: 'assistant', content: [{ type: 'thinking', thinking: 'plan' }, { type: 'toolCall', id: 't1', name: 'read', arguments: { path: '/n.md' } }], stopReason: 'toolUse' }, { role: 'toolResult', toolCallId: 't1', toolName: 'read', content: [{ type: 'text', text: 'body' }], isError: false }, { role: 'assistant', content: [{ type: 'text', text: 'done' }], stopReason: 'stop' }, { role: 'custom', customType: 'x', content: 'hidden' }]);
    expect(state.entries.map(entry => entry.kind)).toEqual(['user', 'assistant', 'assistant']);
    expect(state.entries[0]).toMatchObject({ text: 'hi', focus: { file: '/n.md' } });
    expect(state.entries[1]).toMatchObject({ blocks: [{ type: 'thinking', text: 'plan' }, { type: 'toolCall', id: 't1', name: 'read', args: { path: '/n.md' } }] });
    expect(state.tools.t1).toEqual({ text: 'body', isError: false, running: false });
  });

  it('streams an assistant message, then replaces it with the final one', () => {
    const streamed = apply([{ type: 'agent_start' }, { type: 'message_start', message: { role: 'assistant', content: [] } }, { type: 'message_update', assistantMessageEvent: { type: 'text_start', contentIndex: 0 } }, { type: 'message_update', assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: 'Hel' } }, { type: 'message_update', assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: 'lo' } }, { type: 'message_update', assistantMessageEvent: { type: 'toolcall_start', contentIndex: 1, id: 't1', toolName: 'bash' } }]);
    expect(streamed.running).toBe(true);
    expect(streamed.streaming).toEqual([{ type: 'text', text: 'Hello' }, { type: 'toolCall', id: 't1', name: 'bash', args: undefined }]);

    const finished = apply([{ type: 'tool_execution_start', toolCallId: 't1', toolName: 'bash', args: { command: 'ls' } }, { type: 'tool_execution_update', toolCallId: 't1', partialResult: { content: [{ type: 'text', text: 'a' }] } }, { type: 'tool_execution_end', toolCallId: 't1', result: { content: [{ type: 'text', text: 'a\nb' }] }, isError: true }, { type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: 'Hello' }], stopReason: 'error', errorMessage: 'overloaded' } }, { type: 'agent_settled' }], streamed);
    expect(finished.streaming).toBeUndefined();
    expect(finished.running).toBe(false);
    expect(finished.tools.t1).toEqual({ text: 'a\nb', isError: true, running: false });
    expect(finished.entries.at(-1)).toMatchObject({ kind: 'assistant', error: 'overloaded' });
  });

  it('holds extension dialogs until answered and keeps statuses and widgets by key', () => {
    const asked = apply([{ type: 'extension_ui_request', id: 'd1', method: 'select', title: 'Pick one', options: ['A', 'B'] }, { type: 'extension_ui_request', id: 'd1', method: 'select', title: 'Pick one', options: ['A', 'B'] }, { type: 'extension_ui_request', id: 'd2', method: 'editor', title: 'Edit', prefill: 'x' }, { type: 'extension_ui_request', id: 'n1', method: 'notify', message: 'blocked', notifyType: 'warning' }, { type: 'extension_ui_request', id: 's1', method: 'setStatus', statusKey: 'ext', statusText: 'Turn 1' }, { type: 'extension_ui_request', id: 'w1', method: 'setWidget', widgetKey: 'ext', widgetLines: ['one'] }]);
    expect(asked.dialogs).toEqual([{ id: 'd1', method: 'select', title: 'Pick one', options: ['A', 'B'] }, { id: 'd2', method: 'editor', title: 'Edit', prefill: 'x' }]);
    expect(asked.entries).toMatchObject([{ kind: 'notice', level: 'warning', text: 'blocked' }]);
    expect(asked.statuses).toEqual({ ext: 'Turn 1' });
    expect(asked.widgets).toEqual({ ext: ['one'] });

    const resolved = apply([{ type: 'bridge_ui_resolved', id: 'd1' }, { type: 'extension_ui_request', id: 's2', method: 'setStatus', statusKey: 'ext' }, { type: 'extension_ui_request', id: 'w2', method: 'setWidget', widgetKey: 'ext' }, { type: 'response', command: 'prompt', success: false, error: 'busy' }], asked);
    expect(resolved.dialogs.map(dialog => dialog.id)).toEqual(['d2']);
    expect(resolved.statuses).toEqual({});
    expect(resolved.widgets).toEqual({});
    expect(resolved.entries.at(-1)).toMatchObject({ kind: 'notice', level: 'error', text: 'prompt: busy' });
  });
});

it('drops terminal colours and hyperlinks that extensions write for the TUI', () => {
  expect(stripTerminalStyles('\u001b[38;5;2mLSP Active: json\u001b[39m')).toBe('LSP Active: json');
  expect(stripTerminalStyles('\u001b]8;;http://localhost:6006/s\u0007phoenix\u001b]8;;\u0007 \u001b[2m◇\u001b[22m')).toBe('phoenix ◇');
  const state = applyRecord(emptyTranscript, { type: 'extension_ui_request', id: 'w', method: 'setWidget', widgetKey: 'k', widgetLines: ['\u001b[1mbold\u001b[22m'] });
  expect(state.widgets).toEqual({ k: ['bold'] });
});
