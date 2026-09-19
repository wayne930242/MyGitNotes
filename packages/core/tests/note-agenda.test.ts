import { describe, expect, it } from 'vitest';
import { type AgendaSourceNote, extractTodoTasks } from '../src/note-agenda.js';

function note(path: string, content: string): AgendaSourceNote {
  return { path, notebookId: 'nb', title: path, content };
}

describe('extractTodoTasks — start date', () => {
  it('extracts a start date alongside a due date', () => {
    const tasks = extractTodoTasks([note('a.md', '- [ ] Ship it 🛫 2026-09-20 📅 2026-09-25\n')]);
    expect(tasks[0]).toMatchObject({ start: '2026-09-20', due: '2026-09-25' });
  });

  it('leaves start undefined when the line has no start token', () => {
    const tasks = extractTodoTasks([note('a.md', '- [ ] Ship it 📅 2026-09-25\n')]);
    expect(tasks[0].start).toBeUndefined();
    expect(tasks[0].due).toBe('2026-09-25');
  });

  it('extracts a start date with no due date', () => {
    const tasks = extractTodoTasks([note('a.md', '- [ ] Kick off 🛫 2026-09-18\n')]);
    expect(tasks[0]).toMatchObject({ start: '2026-09-18', due: undefined });
  });
});
