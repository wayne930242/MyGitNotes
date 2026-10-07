import { describe, expect, it } from 'vitest';
import { commitMessage, noteChangeFacts, polishedCommit, summarizeCommit, textSize } from './commit-summary.js';
import { en, type TranslationKey, zhTW } from './i18n/index.js';
import type { NoteItem } from './types.js';

const translator = (table: Record<TranslationKey, string>) => (key: TranslationKey, params: Record<string, string | number> = {}) => table[key].replace(/\{(\w+)\}/g, (_, name: string) => String(params[name] ?? `{${name}}`));
const english = translator(en), chinese = translator(zhTW);
const note = (content: string, extra: Partial<NoteItem> = {}): NoteItem => ({ id: 'n', path: 'notes/a/weekly-review.md', notebookId: 'a', title: 'Weekly Review', status: 'working', tags: ['planning'], metadata: {}, content, ...extra });

const before = note('# Weekly Review\n\n## Done\n\n- [ ] Ship the splash\n- [x] Fix sign-in\n\n## Old\n\nNotes.');
const after = note('# Weekly Review\n\n## Done\n\n- [x] Ship the splash\n- [ ] Fix sign-in\n- [ ] Plan phase 4\n\n## In Progress\n\nNotes.', { status: 'done', tags: ['planning', 'review'] });

describe('note change facts', () => {
  it('reads status, tags, sections and tasks from the two versions', () => {
    expect(noteChangeFacts(after, before)).toMatchObject({ added: false, statusFrom: 'working', statusTo: 'done', tagsAdded: ['review'], tagsRemoved: [], sectionsAdded: ['In Progress'], sectionsRemoved: ['Old'], tasksDone: 1, tasksReopened: 1, tasksAdded: 1 });
  });

  it('ignores headings inside code fences', () => {
    const facts = noteChangeFacts(note('```\n# not a heading\n```\nText'), note('Text'));
    expect(facts.sectionsAdded).toEqual([]);
  });

  it('counts each CJK character as a word', () => {
    expect(textSize('完成三項 tasks today')).toBe(6);
  });
});

describe('commit summary', () => {
  it('names one note and its most telling changes in the subject, and lists everything below', () => {
    const summary = summarizeCommit([noteChangeFacts(after, before)], [], english);
    expect(summary.subject).toBe('Weekly Review: status working → done, completed 1 task(s)');
    expect(summary.details).toBe('- Weekly Review: status working → done, completed 1 task(s), reopened 1 task(s), added 1 task(s), added "In Progress", removed "Old", tagged review\n\nNote-Modified: notes/a/weekly-review.md');
  });

  it('speaks the visitor language', () => {
    expect(summarizeCommit([noteChangeFacts(after, before)], [], chinese).subject).toBe('Weekly Review：狀態 working → done、完成 1 項任務');
  });

  it('describes a plain text edit by how much was written', () => {
    const facts = noteChangeFacts(note('one two three four'), note('one two'));
    expect(summarizeCommit([facts], [], english).subject).toBe('Weekly Review: wrote about 2 words');
  });

  it('summarizes several files, new notes and documents with machine-readable trailers', () => {
    const created = noteChangeFacts(note('Hi', { path: 'notes/a/new.md', title: 'New Idea' }), null);
    const summary = summarizeCommit([created, noteChangeFacts(after, before)], ['notes/a/.outline.json'], english);
    expect(summary.subject).toBe('Update 3 files: New Idea, Weekly Review, .outline.json');
    expect(summary.details.split('\n\n')[1]).toBe('Note-Added: notes/a/new.md\nNote-Modified: notes/a/weekly-review.md\nDocument-Modified: notes/a/.outline.json');
    expect(summarizeCommit([created], [], english).subject).toBe('Add note New Idea');
  });

  it('leaves out a body that would only repeat the subject of a single change, and keeps the trailers', () => {
    const twoPhrases = noteChangeFacts(note('x', { status: 'done' }), note('x'));
    expect(summarizeCommit([twoPhrases], [], english).details).toBe('Note-Modified: notes/a/weekly-review.md');
    expect(commitMessage('Weekly Review: status working → done', summarizeCommit([twoPhrases], [], english).details)).toBe('Weekly Review: status working → done\n\nNote-Modified: notes/a/weekly-review.md');
    expect(summarizeCommit([noteChangeFacts(note('Hi', { path: 'notes/a/new.md', title: 'New Idea' }), null)], [], english).details).toBe('Note-Added: notes/a/new.md');
    expect(summarizeCommit([], ['notes/a/.outline.json'], english).details).toBe('Document-Modified: notes/a/.outline.json');
  });

  it('keeps the body of a single change whose subject cut phrases off or is clipped', () => {
    expect(summarizeCommit([noteChangeFacts(after, before)], [], english).details).toContain('- Weekly Review: status');
    const long = noteChangeFacts(note('x', { title: 'A'.repeat(90) }), note('x', { title: 'B' }));
    const summary = summarizeCommit([long], [], english);
    expect(summary.subject.endsWith('…')).toBe(true);
    expect(summary.details).toContain(`- ${'A'.repeat(90)}`);
  });

  it('keeps a body for several changes', () => {
    const created = noteChangeFacts(note('Hi', { path: 'notes/a/new.md', title: 'New Idea' }), null);
    expect(summarizeCommit([created, noteChangeFacts(after, before)], [], english).details).toMatch(/^- New Idea: new note\n- Weekly Review/);
  });

  it('keeps a huge commit within the message limit, cut at a line', () => {
    const notes = Array.from({ length: 200 }, (_, index) => noteChangeFacts(note('x', { path: `notes/a/n${index}.md`, title: `Note ${index}` }), null));
    const message = commitMessage('Add notes', summarizeCommit(notes, [], english).details);
    expect(message.length).toBeLessThanOrEqual(4000);
    expect(message.endsWith('\n…')).toBe(true);
    expect(message.startsWith('Add notes\n\n- Note 0: new note\n')).toBe(true);
  });
});

describe('polished commit', () => {
  const created = noteChangeFacts(note('Hi', { path: 'notes/a/new.md', title: 'New Idea' }), null);
  const modified = noteChangeFacts(after, before);
  const trailers = 'Note-Added: notes/a/new.md\nNote-Modified: notes/a/weekly-review.md\nDocument-Modified: notes/a/.outline.json';

  it('takes the polished subject and body and writes every trailer again from the facts', () => {
    const polished = polishedCommit('Plan the next phase\n\nReworded body.', [created, modified], ['notes/a/.outline.json']);
    expect(polished.subject).toBe('Plan the next phase');
    expect(polished.details).toBe(`Reworded body.\n\n${trailers}`);
  });

  it('restores trailers the polish dropped', () => {
    expect(polishedCommit('Subject only', [created, modified], ['notes/a/.outline.json']).details).toBe(trailers);
  });

  it('drops trailers the polish kept in another form or invented', () => {
    const polished = polishedCommit('Subject\n\nBody\n\nnote-modified: notes/a/wrong.md\nNote-Added: notes/a/invented.md\nDocument-Modified: elsewhere.json', [created, modified], []);
    expect(polished.details).toBe('Body\n\nNote-Added: notes/a/new.md\nNote-Modified: notes/a/weekly-review.md');
    expect(polished.details).not.toContain('invented');
    expect(polished.details).not.toContain('wrong');
  });

  it('keeps the original trailers when the polish repeats them and tolerates CRLF', () => {
    const polished = polishedCommit(`Subject\r\n\r\nBody\r\n\r\n${trailers}`, [created, modified], ['notes/a/.outline.json']);
    expect(polished.details).toBe(`Body\n\n${trailers}`);
  });

  it('keeps every trailer when a long polish passes the message limit, cutting only the body', () => {
    const body = Array.from({ length: 300 }, (_, line) => `Reworded line ${line} that explains the change in some detail.`).join('\n');
    expect(body.length).toBeGreaterThan(6000);
    const polished = polishedCommit(`Plan the next phase\n\n${body}`, [created, modified], ['notes/a/.outline.json']);
    const message = commitMessage(polished.subject, polished.details);
    expect(message.length).toBeLessThanOrEqual(4000);
    expect(message.startsWith('Plan the next phase\n\nReworded line 0 that')).toBe(true);
    expect(message.endsWith(`\n…\n\n${trailers}`)).toBe(true);
    // The body stops at a whole line.
    expect(message.split('\n').filter(line => line.startsWith('Reworded line')).every(line => line.endsWith('detail.'))).toBe(true);
  });

  it('keeps the trailers when the visitor lengthens the subject after a long polish', () => {
    const polished = polishedCommit(`Subject\n\n${'A line of the polished body.\n'.repeat(400)}`, [created, modified], []);
    const message = commitMessage(`${'A long subject '.repeat(20)}`, polished.details);
    expect(message.length).toBeLessThanOrEqual(4000);
    expect(message.endsWith('Note-Added: notes/a/new.md\nNote-Modified: notes/a/weekly-review.md')).toBe(true);
  });

  it('cuts a single-line body that is longer than the limit rather than dropping it', () => {
    const message = commitMessage('Subject', polishedCommit(`Subject\n\n${'x'.repeat(6000)}`, [created], []).details);
    expect(message.length).toBeLessThanOrEqual(4000);
    expect(message).toContain('xxxx');
    expect(message.endsWith('\n…\n\nNote-Added: notes/a/new.md')).toBe(true);
  });

  it('refuses a polish that has no subject', () => {
    expect(() => polishedCommit('\n\nNote-Added: notes/a/new.md', [created], [])).toThrow(/empty/);
  });
});
