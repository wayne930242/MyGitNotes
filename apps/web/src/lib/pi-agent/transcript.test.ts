import { describe, expect, it } from 'vitest';
import { applyRecord, caretPosition, emptyTranscript, focusLabel, queuedText, selectionPosition, splitFocus, startShell, stripTerminalStyles, transcriptFromMessages, type TranscriptState, withFocus } from './transcript.js';

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

  it('names a selection by both ends, labelled by lines or by columns within one line', () => {
    const lines = { file: '/home/me/notes/a.md', line: 3, column: 2, endLine: 7, endColumn: 4 };
    const message = withFocus('Rewrite this', lines);
    expect(message).toContain('selection: line 3, column 2 to line 7, column 4\n');
    expect(splitFocus(message)).toEqual({ text: 'Rewrite this', focus: lines });
    expect(focusLabel(lines)).toBe('a.md:3-7');
    expect(focusLabel({ ...lines, endLine: 3, endColumn: 9 })).toBe('a.md:3:2-9');
  });

  it('places a selection in file lines, and a bare caret without an end', () => {
    expect(selectionPosition('first\nsecond line\nthird', { from: 2, to: 15 }, 4)).toEqual({ line: 5, column: 3, endLine: 6, endColumn: 10 });
    expect(selectionPosition('first\nsecond', { from: 8, to: 8 })).toEqual({ line: 2, column: 3 });
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

it("keeps Pi's whole pending queue from each queue_update, without the editor-context block", () => {
  let state = applyRecord(emptyTranscript, { type: 'queue_update', steering: [withFocus('look here', { file: 'notes/a.md', line: 3 })], followUp: ['then this'] });
  expect(state.queued).toEqual([{ kind: 'steer', text: 'look here' }, { kind: 'followUp', text: 'then this' }]);
  state = applyRecord(state, { type: 'queue_update', steering: [], followUp: [] });
  expect(state.queued).toEqual([]);
});

describe('commands, shell runs and compaction', () => {
  const skill = '<skill name="review" location="/s/SKILL.md">\nReferences are relative to /s.\n\nBody\n</skill>';

  it('shows an expanded skill as its command, in the history and in the queue', () => {
    const state = transcriptFromMessages([{ role: 'user', content: `${skill}\n\nlook here` }, { role: 'user', content: skill }]);
    expect(state.entries).toEqual([{ kind: 'user', key: 0, text: 'look here', skill: 'review' }, { kind: 'user', key: 1, text: '', skill: 'review' }]);
    expect(apply([{ type: 'queue_update', steering: [`${skill}\n\nlater`], followUp: [] }]).queued).toEqual([{ kind: 'steer', text: '/skill:review later' }]);
    expect(queuedText(skill)).toBe('/skill:review');
  });

  it('streams a shell run into its entry and settles it on the answer, even when another tab sent it', () => {
    let state = startShell(emptyTranscript, 'b1', 'ls', false);
    state = apply([{ type: 'bash_execution_update', id: 'b1', delta: 'a\n' }, { type: 'bash_execution_update', id: 'b1', delta: 'b\n' }, { type: 'response', id: 'b1', command: 'bash', success: true, data: { output: 'b\n', exitCode: 2, cancelled: false } }], state);
    expect(state.entries).toEqual([{ kind: 'shell', key: 0, id: 'b1', command: 'ls', output: 'a\nb\n', excluded: false, running: false, exitCode: 2 }]);
    const elsewhere = apply([{ type: 'bash_execution_update', id: 'b2', delta: 'x' }]);
    expect(elsewhere.entries).toEqual([{ kind: 'shell', key: 0, id: 'b2', command: '', output: 'x', excluded: false, running: true }]);
    const failed = apply([{ type: 'response', id: 'b1', command: 'bash', success: false, error: 'no shell' }], startShell(emptyTranscript, 'b1', 'ls', true));
    expect(failed.entries).toEqual([{ kind: 'shell', key: 0, id: 'b1', command: 'ls', output: '', excluded: true, running: false }, { kind: 'notice', key: 1, level: 'error', text: 'bash: no shell' }]);
  });

  it('rebuilds shell runs from the history', () => {
    expect(transcriptFromMessages([{ role: 'bashExecution', command: 'pwd', output: '/w\n', exitCode: 0, cancelled: false, truncated: false, excludeFromContext: true }]).entries).toEqual([{ kind: 'shell', key: 0, command: 'pwd', output: '/w\n', excluded: true, running: false, exitCode: 0 }]);
  });

  it("marks compaction while it runs and notes its end, leaving a failed /compact to its command's answer", () => {
    expect(apply([{ type: 'compaction_start', reason: 'manual' }]).compacting).toBe(true);
    const done = apply([{ type: 'compaction_start', reason: 'threshold' }, { type: 'compaction_end', reason: 'threshold', result: { summary: 's' } }]);
    expect(done.compacting).toBe(false);
    expect(done.entries).toEqual([{ kind: 'notice', key: 0, level: 'info', text: 'compacted' }]);
    expect(apply([{ type: 'compaction_end', reason: 'manual', errorMessage: 'Compaction failed: x' }]).entries).toEqual([]);
    expect(apply([{ type: 'compaction_end', reason: 'overflow', errorMessage: 'Compaction failed: x' }]).entries).toEqual([{ kind: 'notice', key: 0, level: 'error', text: 'Compaction failed: x' }]);
  });

  it("follows the conversation name and an extension's title", () => {
    expect(apply([{ type: 'response', command: 'get_state', success: true, data: { sessionName: 'Plan' } }]).name).toBe('Plan');
    expect(apply([{ type: 'session_info_changed', name: 'Plan' }, { type: 'session_info_changed' }]).name).toBeUndefined();
    expect(apply([{ type: 'extension_ui_request', id: 't', method: 'setTitle', title: '\u001b[1mpi - notes\u001b[0m' }]).title).toBe('pi - notes');
  });
});
