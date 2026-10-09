import { expect, it } from 'vitest';
import { createWorkspaceRepositories, type RemoteSource, repositoryRef, StaleRevisionError, type WorkspaceConfig } from '@mygitnotes/core';
import { callWorkspaceRemoteTool, decodeWorkspaceRevision, encodeWorkspaceRevision } from '../src/workspace-remote.js';

const sha = (letter: string) => letter.repeat(40);
const home = { type: 'github' as const, repository: 'owner/home', branch: 'main' };
const other = { type: 'github' as const, repository: 'owner/other', branch: 'main' };
const a = repositoryRef(home).id;
const b = repositoryRef(other).id;

function fixture(two = true, otherRoot = 'notes/shared') {
  const manifests: Record<string, WorkspaceConfig> = { [a]: { schema_version: 4, workspace: { title: 'Test', default_notebook: 'home' }, notebooks: [{ id: 'home', title: 'Home', root: 'notes/shared' }] }, [b]: { schema_version: 4, workspace: { title: 'Other', default_notebook: 'other' }, notebooks: [{ id: 'other', title: 'Other', root: otherRoot }] } };
  const members = [{ ref: repositoryRef(home), alias: 'home', default: true, hidden: false }, ...(two ? [{ ref: repositoryRef(other), alias: 'other', default: false, hidden: false }] : [])];
  const heads: Record<string, string> = { [a]: sha('a'), [b]: sha('b') };
  const writes: string[] = [];
  const note = (id: string) => ({ id: id, path: 'notes/shared/note.md', notebookId: id === a ? 'home' : 'other', title: id, metadata: {}, content: id, tags: [], revision: heads[id], size: 10 });
  const reader = (id: string, scope: () => Promise<WorkspaceConfig>) =>
    ({
      config: scope,
      getSnapshot: async () => ({ sha: heads[id], entries: [{ path: 'notes/shared/note.md', type: 'blob', mode: '100644', size: 12 }, { path: 'notes/shared', type: 'tree', mode: '040000' }, { path: 'AGENTS.md', type: 'blob', mode: '100644', size: 4 }] }),
      notePaths: async () => ['notes/shared/note.md'],
      prefetchFiles: async () => {},
      note: async () => note(id),
      notes: async () => [note(id)],
      readFile: async (file: string) => Buffer.from(file === 'AGENTS.md' ? id : id),
      save: async (_path: string, _content: string, _metadata: unknown, revision: string) => {
        if (revision !== heads[id]) throw new StaleRevisionError([id], `Stale repository ${id}`);
        writes.push(id);
        heads[id] = sha('c');
        return { success: true, revision: heads[id], changedPaths: ['notes/shared/note.md'], commit: { commitHash: heads[id], message: 'test' } };
      },
    }) as unknown as RemoteSource;
  const workspace = createWorkspaceRepositories({ members, openRepository: async ({ ref }, scope) => ({ reader: reader(ref.id, scope) }), manifest: ({ ref }) => ({ read: async () => ({ state: 'file' as const, config: manifests[ref.id], revision: heads[ref.id] }), save: async () => ({ revision: heads[ref.id] }) }) });
  return { workspace, heads, writes };
}

it('round trips repository revisions and accepts a bare SHA only for one repository', async () => {
  const set = { [a]: sha('a'), [b]: sha('b') };
  expect(decodeWorkspaceRevision(encodeWorkspaceRevision(set), b, 2)).toBe(sha('b'));
  expect(decodeWorkspaceRevision(sha('a'), a, 1)).toBe(sha('a'));
  expect(() => decodeWorkspaceRevision(sha('b'), b, 2)).toThrow(/single-repository/);
  const single = fixture(false);
  const result = await callWorkspaceRemoteTool(single.workspace, 'save_note', { path: 'notes/shared/note.md', content: 'updated', revision: sha('a') }, true);
  expect(decodeWorkspaceRevision(result.revision as string, a, 1)).toBe(sha('c'));
});

it('writes B despite stale A, rejects stale B and retains other revision entries on receipts', async () => {
  const { workspace, writes } = fixture();
  const token = encodeWorkspaceRevision({ [a]: sha('0'), [b]: sha('b') });
  const receipt = await callWorkspaceRemoteTool(workspace, 'save_note', { notebookId: 'other', path: 'notes/shared/note.md', content: 'updated', revision: token }, true);
  expect(writes).toEqual([b]);
  expect(decodeWorkspaceRevision(receipt.revision as string, b, 2)).toBe(sha('c'));
  expect(decodeWorkspaceRevision(receipt.revision as string, a, 2)).toBe(sha('0'));
  await expect(callWorkspaceRemoteTool(workspace, 'save_note', { notebookId: 'other', path: 'notes/shared/note.md', content: 'again', revision: token }, true)).rejects.toThrow(b);
});

it('distinguishes same paths by notebook, merges listing and forbids cross-repository moves', async () => {
  const { workspace } = fixture();
  const left = await callWorkspaceRemoteTool(workspace, 'read_note', { path: 'notes/shared/note.md', notebookId: 'home' }, false);
  const right = await callWorkspaceRemoteTool(workspace, 'read_note', { path: 'notes/shared/note.md', notebookId: 'other' }, false);
  expect((left.note as { content: string; }).content).toBe(a);
  expect((right.note as { content: string; }).content).toBe(b);
  await expect(callWorkspaceRemoteTool(workspace, 'read_note', { path: 'notes/shared/note.md' }, false)).rejects.toThrow(/more than one repository/);
  expect((await callWorkspaceRemoteTool(workspace, 'glob', {}, false)).paths).toEqual(['notes/shared/note.md', 'notes/shared/note.md']);
  expect((await callWorkspaceRemoteTool(workspace, 'list_notes', {}, false)).total).toBe(2);
  const firstFind = await callWorkspaceRemoteTool(workspace, 'find', { query: 'github:', maxFiles: 1 }, false);
  expect(firstFind.matches).toHaveLength(1);
  expect(firstFind.nextFileOffset).toBe(1);
  const nextFind = await callWorkspaceRemoteTool(workspace, 'find', { query: 'github:', maxFiles: 1, fileOffset: 1 }, false);
  expect(nextFind.matches).toHaveLength(1);
  expect(nextFind.nextFileOffset).toBeNull();
  const split = fixture(true, 'notes/other');
  await expect(callWorkspaceRemoteTool(split.workspace, 'mv', { source: 'notes/shared/note.md', destination: 'notes/other/note.md', revision: encodeWorkspaceRevision({ [a]: sha('a'), [b]: sha('b') }) }, true)).rejects.toThrow(/cannot cross repositories/);
  const prompt = await callWorkspaceRemoteTool(workspace, 'get_system_prompt', { notebookId: 'other' }, false);
  expect(prompt.files).toEqual([{ path: 'AGENTS.md', content: b }]);
});

it('names notebooks by key in results, takes a key or a bare id and refuses an unknown key', async () => {
  const { workspace } = fixture();
  const byKey = await callWorkspaceRemoteTool(workspace, 'read_note', { path: 'notes/shared/note.md', notebookId: 'other~other' }, false);
  expect(byKey.note).toMatchObject({ notebookId: 'other~other', content: b });
  const byBareId = await callWorkspaceRemoteTool(workspace, 'read_note', { path: 'notes/shared/note.md', notebookId: 'other' }, false);
  expect(byBareId.note).toMatchObject({ notebookId: 'other~other', content: b });
  await expect(callWorkspaceRemoteTool(workspace, 'read_note', { path: 'notes/shared/note.md', notebookId: 'nope~other' }, false)).rejects.toThrow('Notebook is not configured.');

  const listed = await callWorkspaceRemoteTool(workspace, 'list_notes', {}, false);
  expect((listed.notes as { notebookId: string; }[]).map(note => note.notebookId).sort()).toEqual(['home~home', 'other~other']);
  const narrowed = await callWorkspaceRemoteTool(workspace, 'list_notes', { notebookId: 'home' }, false);
  expect((narrowed.notes as { notebookId: string; }[]).map(note => note.notebookId)).toEqual(['home~home']);
  const found = await callWorkspaceRemoteTool(workspace, 'search_notes', { query: 'github' }, false);
  expect((found.matches as { notebookId: string; }[]).map(match => match.notebookId).sort()).toEqual(['home~home', 'other~other']);
});
