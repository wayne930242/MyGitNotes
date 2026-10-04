import { describe, expect, it } from 'vitest';
import { githubFixture } from './fixtures/github.js';
import { gitlabFixture } from './fixtures/gitlab.js';
import { openRemoteHome } from '../src/remote-factory.js';
import { BOOKMARKS_DOCUMENT, BOOKMARKS_FILE } from '../src/bookmarks.js';
import { readWorkspaceDocument, serializeWorkspaceDocument } from '../src/workspace-documents.js';
const page = { version: 1, notebooks: [{ notebookId: 'ex', groups: [], bookmarks: [{ id: 'a', label: 'Alpha', groupId: null, target: { kind: 'note', path: 'a.md' } }] }] };
const yaml = serializeWorkspaceDocument(page);
for (const provider of ['github', 'gitlab'] as const) {
  describe(`${provider} bookmarks`, () => {
    const fixture = () => {
      if (provider === 'github') {
        const f = githubFixture();
        return { reader: f.reader, head: f.head, text: f.text };
      }
      const f = gitlabFixture();
      return { reader: () => openRemoteHome({ type: 'gitlab', url: 'https://gitlab.example.test/gitlab', repository: 'group/subgroup/project', branch: 'main' }, 'token', f.request).reader, head: () => f.head, text: (file: string) => f.files.get(file) };
    };
    it('persists a document atomically and rejects stale writers and arbitrary-note document scope', async () => {
      const f = fixture(), reader = f.reader();
      const before = await reader.getSnapshot();
      const saved = await reader.saveWorkspaceDocument(BOOKMARKS_DOCUMENT, yaml, before.sha);
      expect(saved.revision).toBe(f.head());
      expect(readWorkspaceDocument(BOOKMARKS_DOCUMENT, f.text(BOOKMARKS_FILE)!)).toEqual(page);
      await expect(f.reader().saveWorkspaceDocument(BOOKMARKS_DOCUMENT, yaml, before.sha)).rejects.toMatchObject({ status: 409 });
      await expect(f.reader().commitChanges([{ path: 'notes/ex/a.md', content: 'overwrite' }], f.head(), 'save', 'bookmarks')).rejects.toMatchObject({ status: 403 });
    });
    it('joins Changes with a paired base and rejects mismatched drafts', async () => {
      const f = fixture();
      await f.reader().commitNotes([], f.head(), 'docs: bookmarks', [{ path: BOOKMARKS_FILE, page, base: BOOKMARKS_DOCUMENT.empty() }]);
      await expect(f.reader().commitNotes([], f.head(), 'docs: stale', [{ path: BOOKMARKS_FILE, page: BOOKMARKS_DOCUMENT.empty(), base: BOOKMARKS_DOCUMENT.empty() }])).rejects.toMatchObject({ status: 409 });
      expect(readWorkspaceDocument(BOOKMARKS_DOCUMENT, f.text(BOOKMARKS_FILE)!)).toEqual(page);
    });
  });
}
it('refuses unsupported existing data instead of replacing it', async () => {
  const f = githubFixture({ [BOOKMARKS_FILE]: 'version: 8\nnotebooks: []\n' });
  await expect(f.reader().saveWorkspaceDocument(BOOKMARKS_DOCUMENT, yaml, f.head())).rejects.toMatchObject({ status: 422 });
  expect(f.text(BOOKMARKS_FILE)).toContain('version: 8');
});
it('GitLab read-only credentials cannot write bookmarks', async () => {
  const f = gitlabFixture();
  f.readOnly();
  const reader = openRemoteHome({ type: 'gitlab', url: 'https://gitlab.example.test/gitlab', repository: 'group/subgroup/project', branch: 'main' }, 'token', f.request).reader;
  await expect(reader.saveWorkspaceDocument(BOOKMARKS_DOCUMENT, yaml, f.head)).rejects.toMatchObject({ status: 403 });
  expect(f.writes).toBe(0);
});
