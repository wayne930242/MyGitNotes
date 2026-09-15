import { describe, expect, it } from 'vitest';
import type { NoteItem } from './types.js';
import { extractTodoTasks, groupTodoTasks } from './todo-list.js';

function note(path: string, content: string): NoteItem {
  return { id: path, path, notebookId: 'nb', title: path, tags: [], metadata: {}, content };
}

describe('extractTodoTasks', () => {
  it('pulls every task line out of the notes, ignoring non-task lines', () => {
    const notes = [
      note('a.md', '# Title\n\n- [ ] First 📅 2026-09-20\nNot a task\n- [x] Second ✅ 2026-09-10\n'),
      note('b.md', '- [ ] Third\n'),
    ];
    const tasks = extractTodoTasks(notes);
    expect(tasks).toHaveLength(3);
    expect(tasks[0]).toMatchObject({ notePath: 'a.md', lineIndex: 2, checked: false, due: '2026-09-20' });
    expect(tasks[1]).toMatchObject({ notePath: 'a.md', lineIndex: 4, checked: true, due: undefined });
    expect(tasks[2]).toMatchObject({ notePath: 'b.md', lineIndex: 0, checked: false, due: undefined });
  });
});

describe('groupTodoTasks', () => {
  const today = '2026-09-15';

  it('sets completed tasks aside regardless of due date', () => {
    const notes = [note('a.md', '- [x] Done, was overdue 📅 2026-09-01\n- [ ] Open, overdue 📅 2026-09-01\n')];
    const groups = groupTodoTasks(extractTodoTasks(notes), today);
    expect(groups.completed).toHaveLength(1);
    expect(groups.overdue).toHaveLength(1);
  });

  it('groups open tasks by overdue/today/upcoming/no date', () => {
    const notes = [note('a.md', [
      '- [ ] Overdue 📅 2026-09-10',
      '- [ ] Due today 📅 2026-09-15',
      '- [ ] Upcoming 📅 2026-09-20',
      '- [ ] No date',
    ].join('\n'))];
    const groups = groupTodoTasks(extractTodoTasks(notes), today);
    expect(groups.overdue.map(t => t.lineText)).toEqual(['- [ ] Overdue 📅 2026-09-10']);
    expect(groups.today.map(t => t.lineText)).toEqual(['- [ ] Due today 📅 2026-09-15']);
    expect(groups.upcoming.map(t => t.lineText)).toEqual(['- [ ] Upcoming 📅 2026-09-20']);
    expect(groups.noDate.map(t => t.lineText)).toEqual(['- [ ] No date']);
  });
});
