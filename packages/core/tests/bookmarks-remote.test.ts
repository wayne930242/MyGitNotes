import { describe, expect, it } from 'vitest';
import { githubFixture } from './fixtures/github.js';
import { gitlabFixture } from './fixtures/gitlab.js';
import { openRemoteRepository } from '../src/remote-factory.js';
import { BOOKMARKS_DOCUMENT, BOOKMARKS_FILE } from '../src/bookmarks.js';
import { readWorkspaceDocument, serializeWorkspaceDocument } from '../src/workspace-documents.js';
const page = { version: 1, notebooks: [{ notebookId: 'ex', groups: [], bookmarks: [{ id: 'a', label: 'Alpha', groupId: null, target: { kind: 'note', path: 'a.md' } }] }] };
const yaml = serializeWorkspaceDocument(page);
for (const provider of ['github', 'gitlab'] as const) {
  describe(`${provider} retained legacy bookmarks`, () => {
    const fixture = (raw = yaml) => {
      if (provider === 'github') {
        const f = githubFixture({ [BOOKMARKS_FILE]: raw });
        return { reader: f.reader, head: f.head, text: f.text, writes: () => f.calls.filter(call => call.method === 'POST' || call.method === 'PATCH').length };
      }
      const f = gitlabFixture(undefined, { [BOOKMARKS_FILE]: raw });
      return { reader: () => openRemoteRepository({ type: 'gitlab', url: 'https://gitlab.example.test/gitlab', repository: 'group/subgroup/project', branch: 'main' }, 'token', f.request).reader, head: () => f.head, text: (file: string) => f.files.get(file), writes: () => f.writes };
    };
    it('preserves read compatibility and rejects document saves and normal Changes', async () => {
      const f = fixture(), head = f.head(), writes = f.writes();
      expect(readWorkspaceDocument(BOOKMARKS_DOCUMENT, f.text(BOOKMARKS_FILE)!)).toEqual(page);
      await expect(f.reader().saveWorkspaceDocument(BOOKMARKS_DOCUMENT, yaml, head)).rejects.toMatchObject({ status: 410 });
      await expect(f.reader().commitNotes([], head, 'docs: retired', [{ path: BOOKMARKS_FILE, page, base: page }])).rejects.toMatchObject({ status: 410 });
      for (const scope of ['notes', 'files', 'folders', 'config'] as const) await expect(f.reader().commitChanges([{ path: BOOKMARKS_FILE, content: yaml }], head, 'update', scope)).rejects.toMatchObject({ status: 410 });
      expect(f.head()).toBe(head);
      expect(f.writes()).toBe(writes);
      expect(f.text(BOOKMARKS_FILE)).toBe(yaml);
    });
    it('refuses replacement of unsupported existing data without a provider write', async () => {
      const raw = 'version: 8\nnotebooks: []\n', f = fixture(raw), writes = f.writes();
      await expect(f.reader().saveWorkspaceDocument(BOOKMARKS_DOCUMENT, yaml, f.head())).rejects.toMatchObject({ status: 410 });
      expect(f.text(BOOKMARKS_FILE)).toBe(raw);
      expect(f.writes()).toBe(writes);
    });
  });
}
it('GitLab read-only credentials cannot revive legacy authoring', async () => {
  const f = gitlabFixture();
  f.readOnly();
  const reader = openRemoteRepository({ type: 'gitlab', url: 'https://gitlab.example.test/gitlab', repository: 'group/subgroup/project', branch: 'main' }, 'token', f.request).reader;
  await expect(reader.saveWorkspaceDocument(BOOKMARKS_DOCUMENT, yaml, f.head)).rejects.toMatchObject({ status: 410 });
  expect(f.writes).toBe(0);
});
