import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';
import { type RemoteChange, type RemoteEntry, type RemoteSnapshot, RemoteSource } from '../src/remote-source.js';
import { deriveWorkspaceConfig, RemoteManifest } from '../src/remote-manifest.js';

const blob = (path: string): RemoteEntry => ({ path, type: 'blob', mode: '100644', sha: `sha-${path}` });
const tree = (path: string): RemoteEntry => ({ path, type: 'tree', mode: '040000', sha: `sha-${path}` });

/** A repository holding `entries` and no manifest, recording what was published. */
function repositoryWithout(entries: RemoteEntry[]) {
  const published: RemoteChange[][] = [];
  class FakeSource extends RemoteSource {
    get id() {
      return 'github:visitor/field-notes@main';
    }
    protected async loadSnapshot(): Promise<RemoteSnapshot> {
      return { sha: 'a'.repeat(40), treeSha: 'b'.repeat(40), entries, info: { private: true, permissions: { push: true }, default_branch: 'main' } };
    }
    protected async readBlob(): Promise<Buffer> {
      return Buffer.from('# Note\n', 'utf8');
    }
    protected async publishChanges(changes: RemoteChange[]): Promise<string> {
      published.push(changes);
      return 'c'.repeat(40);
    }
  }
  const source = new FakeSource('visitor/field-notes', 'main', 'token', undefined, async () => (await store.load()).config);
  const store = new RemoteManifest(source);
  return { source, store, published };
}

describe('a repository without a manifest', () => {
  it('becomes one notebook per top-level folder holding Markdown, skipping tooling, attachments and hidden folders', () => {
    const config = deriveWorkspaceConfig([tree('Journal'), blob('Journal/2026/today.md'), tree('Work Notes'), blob('Work Notes/plan.md'), tree('assets'), blob('assets/readme.md'), tree('.github'), blob('.github/notes.md'), tree('node_modules'), blob('node_modules/x/README.md'), tree('src'), blob('src/index.ts'), blob('README.md')], 'field-notes');
    expect(config.workspace).toMatchObject({ title: 'field-notes', default_notebook: 'journal' });
    expect(config.notebooks.map(notebook => [notebook.id, notebook.title, notebook.root])).toEqual([['journal', 'Journal', 'Journal'], ['work-notes', 'Work Notes', 'Work Notes']]);
  });

  it('starts with an empty notes notebook when no folder holds Markdown, and keeps ids unique', () => {
    expect(deriveWorkspaceConfig([blob('README.md'), tree('src'), blob('src/a.ts')], 'code').notebooks.map(notebook => notebook.root)).toEqual(['notes']);
    expect(deriveWorkspaceConfig([tree('A b'), blob('A b/x.md'), tree('a-b'), blob('a-b/y.md')], 'twins').notebooks.map(notebook => notebook.id)).toEqual(['a-b', 'a-b-2']);
  });

  it('opens with the derived manifest and creates .mygitnotes.yaml in one commit when saved', async () => {
    const { source, store, published } = repositoryWithout([tree('journal'), blob('journal/today.md')]);
    const loaded = await store.load();
    expect(loaded).toMatchObject({ derived: true, revision: 'a'.repeat(40) });
    expect(loaded.config.workspace.title).toBe('field-notes');
    expect((await source.note('journal/today.md')).notebookId).toBe('journal');
    await store.save(`schema_version: 3\nworkspace:\n  title: Field notes\n  default_notebook: journal\nnotebooks:\n  - id: journal\n    title: Journal\n    root: journal\n`, 'a'.repeat(40));
    expect(published).toHaveLength(1);
    expect(published[0].map(change => change.path)).toEqual(['.mygitnotes.yaml']);
    expect(parseYaml(published[0][0].content!).workspace.title).toBe('Field notes');
  });
});
