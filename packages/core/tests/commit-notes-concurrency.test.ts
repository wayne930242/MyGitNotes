import { describe, expect, it, vi } from 'vitest';
import { type RemoteSnapshot, RemoteSource } from '../src/remote-source.js';

// A 200-note batch commit previously fired one readFile per note inside a single Promise.all,
// which could burst up to 200 concurrent uncached blob reads at the GitHub/GitLab API. commitNotes
// now prefetches first and reads existing content in chunks of 6, mirroring the `contents()` path.
describe('RemoteSource.commitNotes bounds concurrent blob reads', () => {
  it('prefetches once, then reads existing notes in chunks of at most 6 concurrent requests', async () => {
    const manifest = 'schema_version: 1\nworkspace:\n  title: Test\n  default_notebook: ex\nnotebooks:\n  - id: ex\n    title: Example\n    root: notes/ex\n';
    const paths = Array.from({ length: 20 }, (_, i) => `notes/ex/n${i}.md`);
    const files: Record<string, string> = { 'notes/.github-notes.yaml': manifest };
    for (const path of paths) files[path] = '---\ntitle: Note\n---\n\nBody.\n';
    const entries = Object.keys(files).map(path => ({ path, type: 'blob', mode: '100644', sha: `sha-${path}` }));

    let concurrent = 0, maxConcurrent = 0, noteReads = 0;
    const notePaths = new Set(paths);
    class FakeSource extends RemoteSource {
      protected async loadSnapshot(): Promise<RemoteSnapshot> {
        return { sha: 'a'.repeat(40), treeSha: 'b'.repeat(40), entries, info: { private: false, permissions: { push: true }, default_branch: 'main' } };
      }
      protected async readBlob(sha: string): Promise<Buffer> {
        const path = entries.find(e => e.sha === sha)!.path;
        const isNote = notePaths.has(path);
        if (isNote) {
          noteReads++;
          concurrent++;
          maxConcurrent = Math.max(maxConcurrent, concurrent);
        }
        await new Promise(resolve => setTimeout(resolve, 5));
        if (isNote) concurrent--;
        return Buffer.from(files[path], 'utf8');
      }
      protected async publishChanges(): Promise<string> {
        return 'c'.repeat(40);
      }
    }

    const source = new FakeSource('owner/repo', 'main', 'token');
    const prefetchSpy = vi.spyOn(source, 'prefetchFiles');
    const notes = paths.map(path => ({ path, content: 'Body.', metadata: { title: 'Note' } }));

    await source.commitNotes(notes, 'a'.repeat(40), 'docs: update');

    expect(prefetchSpy).toHaveBeenCalledWith(paths);
    expect(noteReads).toBe(paths.length);
    expect(maxConcurrent).toBeLessThanOrEqual(6);
  });
});
