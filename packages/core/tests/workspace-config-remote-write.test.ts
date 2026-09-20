import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';
import { type RemoteChange, type RemoteSnapshot, RemoteSource } from '../src/remote-source.js';

const manifest = (root: string) => `schema_version: 1\nworkspace:\n  title: Test\n  default_notebook: ex\nnotebooks:\n  - id: ex\n    title: Example\n    root: ${root}\n`;

/** Serves one manifest at `location` plus the notebook tree it points at, and records what was published. */
function sourceWith(location: string, root: string) {
  const files: Record<string, string> = { [location]: manifest(root) };
  const entries = [...Object.keys(files).map(path => ({ path, type: 'blob', mode: '100644', sha: `sha-${path}` })), { path: location.startsWith('notes/') ? `notes/${root}` : root, type: 'tree', mode: '040000', sha: 'sha-tree' }];
  const published: RemoteChange[][] = [];
  class FakeSource extends RemoteSource {
    protected async loadSnapshot(): Promise<RemoteSnapshot> {
      return { sha: 'a'.repeat(40), treeSha: 'b'.repeat(40), entries, info: { private: false, permissions: { push: true }, default_branch: 'main' } };
    }
    protected async readBlob(sha: string): Promise<Buffer> {
      return Buffer.from(files[entries.find(entry => entry.sha === sha)!.path], 'utf8');
    }
    protected async publishChanges(changes: RemoteChange[]): Promise<string> {
      published.push(changes);
      return 'c'.repeat(40);
    }
  }
  return { source: new FakeSource('owner/repo', 'main', 'token'), published };
}
describe('A remote workspace manifest written from the browser', () => {
  it('commits to the file it was read from', async () => {
    const { source, published } = sourceWith('.mygitnotes.yaml', 'posts');
    await source.saveWorkspaceConfig(manifest('posts').replace('title: Test', 'title: Renamed'), 'a'.repeat(40));
    expect(published).toHaveLength(1);
    expect(published[0][0].path).toBe('.mygitnotes.yaml');
    expect(parseYaml(published[0][0].content!).workspace.title).toBe('Renamed');
  });
  it('refuses a revision that no longer matches the repository', async () => {
    const { source, published } = sourceWith('.mygitnotes.yaml', 'posts');
    await expect(source.saveWorkspaceConfig(manifest('posts'), 'd'.repeat(40))).rejects.toThrow(/Reload before saving/);
    expect(published).toHaveLength(0);
  });
  it('confines the manifest scope to the manifest itself', async () => {
    const { source, published } = sourceWith('.mygitnotes.yaml', 'posts');
    await expect(source.commitChanges([{ path: 'posts/note.md', content: 'x' }], 'a'.repeat(40), 'save', 'config')).rejects.toThrow(/not an allowed workspace resource/);
    expect(published).toHaveLength(0);
  });
  it('stores the roots as written, not the notes/ prefix the reader adds to a legacy layout', async () => {
    const { source, published } = sourceWith('notes/.mygitnotes.yaml', 'ex');
    // The reader resolves `ex` to `notes/ex` for the app; writing that back would move the notebook.
    expect((await source.config()).notebooks[0].root).toBe('notes/ex');
    await source.saveWorkspaceConfig(`schema_version: 1\nworkspace:\n  title: Test\n  default_notebook: ex\nnotebooks:\n  - id: ex\n    title: Example\n    root: notes/ex\n`, 'a'.repeat(40));
    expect(parseYaml(published[0][0].content!).notebooks[0].root).toBe('ex');
  });
});
