import { afterEach, expect, it, vi } from 'vitest';
import { applyTagEntries, PartialTagChangeError } from './tag-changes.js';
import type { WorkspaceRepository } from './workspace-repositories.js';

const home: WorkspaceRepository = { id: 'github:me/notes@main', type: 'github', branch: 'main', revision: 'a'.repeat(40), write: true, notebooks: ['life'] };
const other: WorkspaceRepository = { id: 'github:me/campaign@main', type: 'github', branch: 'main', revision: 'b'.repeat(40), write: true, notebooks: ['trpg'] };
const entries = [{ path: 'notes/life/a.md', notebookId: 'life', tags: ['x'] }, { path: 'trpg/b.md', notebookId: 'trpg', tags: ['x'] }];

afterEach(() => vi.unstubAllGlobals());

function stubTags(failFor?: string) {
  const bodies: any[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      bodies.push(body);
      if (body.repository === failFor) return new Response(JSON.stringify({ error: 'The repository changed.', staleRepositories: [failFor] }), { status: 409 });
      return new Response(JSON.stringify({ success: true, changedPaths: body.entries.map((entry: any) => entry.path), revision: `${body.repository}-next` }));
    }),
  );
  return bodies;
}

it('commits each repository on its own revision and reports each new revision', async () => {
  const bodies = stubTags();
  const committed = vi.fn();
  await applyTagEntries([home, other], entries, 'rename', committed);
  expect(bodies.map(body => [body.repository, body.revision, body.entries.map((entry: any) => entry.path)])).toEqual([[home.id, home.revision, ['notes/life/a.md']], [other.id, other.revision, ['trpg/b.md']]]);
  expect(committed.mock.calls.map(([repository, revision]) => [repository.id, revision])).toEqual([[home.id, `${home.id}-next`], [other.id, `${other.id}-next`]]);
});

it('stops at the first failing repository and names the repositories already committed', async () => {
  stubTags(other.id);
  const error = await applyTagEntries([home, other], entries, 'rename', () => {}).catch(caught => caught);
  expect(error).toBeInstanceOf(PartialTagChangeError);
  expect(error.committed).toEqual([home.id]);
});

it('passes a failure of the first repository through unchanged', async () => {
  stubTags(home.id);
  const error = await applyTagEntries([home, other], entries, 'rename', () => {}).catch(caught => caught);
  expect(error).not.toBeInstanceOf(PartialTagChangeError);
  expect(error.staleRepositories).toEqual([home.id]);
});
