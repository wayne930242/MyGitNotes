import { expect, it, vi } from 'vitest';
import { useQuickNoteCommit } from './useQuickNoteCommit.js';
import { en, type TranslationKey } from '../lib/i18n/index.js';
import type { NoteItem } from '../lib/types.js';

vi.mock('../lib/api.js', () => ({ commitStagedChanges: vi.fn(), fetchFileChanges: vi.fn() }));

const t = (key: TranslationKey, params: Record<string, string | number> = {}) => en[key].replace(/\{(\w+)\}/g, (_, name: string) => String(params[name]));
const note = (status: string, content: string): NoteItem => ({ id: 'n', path: 'notes/a/plan.md', notebookId: 'a', title: 'Plan', status, tags: [], metadata: {}, content });

it('commits a remote draft from the editor footer with a message naming what it changed', async () => {
  const commitWorkingNotes = vi.fn().mockResolvedValue(undefined);
  const { commitNoteFile } = useQuickNoteCommit({ remote: true, repositoryFor: () => ({ id: 'repo' }) as ReturnType<Parameters<typeof useQuickNoteCommit>[0]['repositoryFor']>, refreshWorkspace: vi.fn().mockResolvedValue(undefined), commitWorkingNotes, activeWorkingNotes: { 'a:notes/a/plan.md': { note: note('done', '- [x] Ship'), base: note('working', '- [ ] Ship') } }, t });
  await commitNoteFile('notes/a/plan.md', 'a');
  expect(commitWorkingNotes).toHaveBeenCalledWith([{ path: 'notes/a/plan.md', repository: 'repo' }], 'Plan: status working → done, completed 1 task(s)\n\nNote-Modified: notes/a/plan.md');
});
