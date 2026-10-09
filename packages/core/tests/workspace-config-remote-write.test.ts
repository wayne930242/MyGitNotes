import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';
import { type RemoteChange, type RemoteEntry, type RemoteSnapshot, RemoteSource } from '../src/remote-source.js';
import { RemoteManifest } from '../src/remote-manifest.js';
import { parseWorkspaceConfig } from '../src/config.js';

const manifest = (root: string) => `schema_version: 1\nworkspace:\n  title: Test\n  default_notebook: ex\nnotebooks:\n  - id: ex\n    title: Example\n    root: ${root}\n`;

/** Serves one manifest at `location` plus the notebook tree it points at, and records what was published. */
/** With `text`, the file holds that text and the reader serves the notebooks another manifest declares, as a notebook repository's reader does. */
function sourceWith(location: string, root: string, text?: string) {
  const files: Record<string, string> = { [location]: text ?? manifest(root) };
  const published: RemoteChange[][] = [];
  // Each publish moves the head and gives the files it wrote new blobs, as the platform does.
  const entries = () => [...Object.keys(files).map(path => ({ path, type: 'blob', mode: '100644', sha: `sha-${path}-${published.length}` })), { path: location.startsWith('notes/') ? `notes/${root}` : root, type: 'tree', mode: '040000', sha: 'sha-tree' }];
  class FakeSource extends RemoteSource {
    get id() {
      return 'github:owner/repo@main';
    }
    protected async loadSnapshot(): Promise<RemoteSnapshot> {
      return { sha: published.length ? 'c'.repeat(40) : 'a'.repeat(40), treeSha: 'b'.repeat(40), entries: entries(), info: { private: false, permissions: { push: true }, default_branch: 'main' } };
    }
    protected async readBlob(sha: string): Promise<Buffer> {
      return Buffer.from(files[entries().find(entry => entry.sha === sha)!.path], 'utf8');
    }
    protected async publishChanges(changes: RemoteChange[]): Promise<string> {
      published.push(changes);
      for (const change of changes) if (change.content !== undefined) files[change.path] = change.content;
      return 'c'.repeat(40);
    }
  }
  const source = new FakeSource('owner/repo', 'main', 'token', undefined, async () => text === undefined ? (await store.load()).config : parseWorkspaceConfig(manifest(root)));
  const store = new RemoteManifest(source);
  return { source, store, published };
}
describe('A remote workspace manifest written from the browser', () => {
  it('commits to the file it was read from', async () => {
    const { store, published } = sourceWith('.mygitnotes.yaml', 'posts');
    await store.save(manifest('posts').replace('title: Test', 'title: Renamed'), 'a'.repeat(40));
    expect(published).toHaveLength(1);
    expect(published[0][0].path).toBe('.mygitnotes.yaml');
    expect(parseYaml(published[0][0].content!).workspace.title).toBe('Renamed');
  });
  it('refuses a revision that no longer matches the repository', async () => {
    const { store, published } = sourceWith('.mygitnotes.yaml', 'posts');
    await expect(store.save(manifest('posts'), 'd'.repeat(40))).rejects.toThrow(/Reload before saving/);
    expect(published).toHaveLength(0);
  });
  it('confines the manifest scope to the manifest itself', async () => {
    const { source, published } = sourceWith('.mygitnotes.yaml', 'posts');
    await expect(source.commitChanges([{ path: 'posts/note.md', content: 'x' }], 'a'.repeat(40), 'save', 'config')).rejects.toThrow(/not an allowed workspace resource/);
    expect(published).toHaveLength(0);
  });
  it('stores the roots as written, not the notes/ prefix the reader adds to a legacy layout', async () => {
    const { source, store, published } = sourceWith('notes/.mygitnotes.yaml', 'ex');
    // The reader resolves `ex` to `notes/ex` for the app; writing that back would move the notebook.
    expect((await source.config()).notebooks[0].root).toBe('notes/ex');
    await store.save(`schema_version: 1\nworkspace:\n  title: Test\n  default_notebook: ex\nnotebooks:\n  - id: ex\n    title: Example\n    root: notes/ex\n`, 'a'.repeat(40));
    expect(parseYaml(published[0][0].content!).notebooks[0].root).toBe('ex');
  });
  it("reads a repository's own file as it is: a manifest that does not parse is its text, and saving replaces it", async () => {
    const { store, published } = sourceWith('.mygitnotes.yaml', 'posts', 'workspace: [broken\n');
    await expect(store.load()).rejects.toThrow();
    expect(await store.read()).toMatchObject({ state: 'invalid', text: 'workspace: [broken\n', revision: 'a'.repeat(40) });
    await store.save(manifest('posts'), 'a'.repeat(40));
    expect(published[0][0].path).toBe('.mygitnotes.yaml');
    expect(parseYaml(published[0][0].content!).workspace.title).toBe('Test');
  });
  it('reads a valid file as the file', async () => {
    const { store } = sourceWith('.mygitnotes.yaml', 'posts');
    expect(await store.read()).toMatchObject({ state: 'file', revision: 'a'.repeat(40), config: { workspace: { title: 'Test' } } });
  });

  it('reports a manifest it cannot read with the reason, and reads it again next time', async () => {
    let failing = true;
    const entries: RemoteEntry[] = [{ path: '.mygitnotes.yaml', type: 'blob', mode: '100644', sha: 'sha-manifest' }];
    class FlakySource extends RemoteSource {
      get id() {
        return 'github:owner/flaky@main';
      }
      protected async loadSnapshot(): Promise<RemoteSnapshot> {
        return { sha: 'a'.repeat(40), treeSha: 'b'.repeat(40), entries, info: { private: false, permissions: { push: true }, default_branch: 'main' } };
      }
      protected async readBlob(): Promise<Buffer> {
        if (failing) throw new Error('blob fetch failed');
        return Buffer.from(manifest('posts'), 'utf8');
      }
      protected async publishChanges(): Promise<string> {
        return 'c'.repeat(40);
      }
    }
    const store = new RemoteManifest(new FlakySource('owner/flaky', 'main', 'token', undefined, async () => parseWorkspaceConfig(manifest('posts'))));
    expect(await store.read()).toEqual({ state: 'invalid', text: '', error: 'blob fetch failed', revision: 'a'.repeat(40) });
    await expect(store.load()).rejects.toThrow('blob fetch failed');
    // A failed read is not kept for the snapshot: once the platform answers, the file is read.
    failing = false;
    expect(await store.read()).toMatchObject({ state: 'file', config: { workspace: { title: 'Test' } } });
  });
  it('reports a manifest over the read limit as one it cannot read', async () => {
    const entries: RemoteEntry[] = [{ path: '.mygitnotes.yaml', type: 'blob', mode: '100644', sha: 'sha-big', size: 6 * 1024 * 1024 }];
    class LargeSource extends RemoteSource {
      get id() {
        return 'github:owner/large@main';
      }
      protected async loadSnapshot(): Promise<RemoteSnapshot> {
        return { sha: 'a'.repeat(40), treeSha: 'b'.repeat(40), entries, info: { private: false, permissions: { push: true }, default_branch: 'main' } };
      }
      protected async readBlob(): Promise<Buffer> {
        throw new Error('not read');
      }
      protected async publishChanges(): Promise<string> {
        return 'c'.repeat(40);
      }
    }
    const store = new RemoteManifest(new LargeSource('owner/large', 'main', 'token', undefined, async () => parseWorkspaceConfig(manifest('posts'))));
    expect(await store.read()).toMatchObject({ state: 'invalid', text: '', error: expect.stringMatching(/5 MiB/) });
  });
  it('does not take a symbolic link for the manifest', async () => {
    const entries: RemoteEntry[] = [{ path: 'notes/.mygitnotes.yaml', type: 'blob', mode: '120000', sha: 'sha-link' }, { path: '.mygitnotes.yaml', type: 'blob', mode: '100644', sha: 'sha-file' }, { path: 'posts', type: 'tree', mode: '040000', sha: 'sha-tree' }];
    class LinkedSource extends RemoteSource {
      get id() {
        return 'github:owner/linked@main';
      }
      protected async loadSnapshot(): Promise<RemoteSnapshot> {
        return { sha: 'a'.repeat(40), treeSha: 'b'.repeat(40), entries, info: { private: false, permissions: { push: true }, default_branch: 'main' } };
      }
      protected async readBlob(sha: string): Promise<Buffer> {
        return Buffer.from(sha === 'sha-file' ? manifest('posts') : 'notes/elsewhere.yaml', 'utf8');
      }
      protected async publishChanges(): Promise<string> {
        return 'c'.repeat(40);
      }
    }
    const store = new RemoteManifest(new LinkedSource('owner/linked', 'main', 'token', undefined, async () => parseWorkspaceConfig(manifest('posts'))));
    expect(await store.read()).toMatchObject({ state: 'file', config: { workspace: { title: 'Test' } } });
  });
});
