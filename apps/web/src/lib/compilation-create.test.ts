import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseCompilation } from '@mygitnotes/core/compilation';
import type { CompilationRow } from '@mygitnotes/core/compilation';

const lookup = vi.fn();
vi.mock('./notes-api.js', () => ({ lookupNotes: (refs: unknown) => lookup(refs) }));
const { planNewCompilation } = await import('./compilation-create.js');

const notebook = { id: 'life', title: 'Life', root: 'notes/life' };
const row: CompilationRow = { id: 'c1', path: '', notebookId: 'life', name: 'Reading list', view: 'small', kind: 'custom', items: [] };

afterEach(() => lookup.mockReset());

describe('planNewCompilation', () => {
  it('writes <slug>.compilation.yml in the selected folder with the title and tags the listings show', async () => {
    lookup.mockResolvedValue({ notes: [] });
    const plan = await planNewCompilation({ ...row, tags: ['read'] }, notebook, 'projects');
    expect(plan.path).toBe('notes/life/projects/reading-list.compilation.yml');
    expect(plan.metadata).toMatchObject({ title: 'Reading list', tags: ['read'] });
    expect(parseCompilation(plan.content, notebook.root)).toMatchObject({ id: 'c1', title: 'Reading list' });
  });

  it('skips names that exist and gives up when every candidate is taken', async () => {
    lookup.mockImplementationOnce(async (refs: { path: string; }[]) => ({ notes: refs.slice(0, 1).map(ref => ({ path: ref.path })) }));
    expect((await planNewCompilation(row, notebook, '')).path).toBe('notes/life/reading-list-2.compilation.yml');
    lookup.mockImplementationOnce(async (refs: { path: string; }[]) => ({ notes: refs.map(ref => ({ path: ref.path })) }));
    await expect(planNewCompilation(row, notebook, '')).rejects.toThrow('Too many');
  });
});
