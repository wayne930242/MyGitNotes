import { describe, expect, it } from 'vitest';
import { notebookIdCodec, resolveBareId } from './notebook-keys.js';
import { bareNotebookRoute, keyedAppUrl } from './routes.js';

// `kb` is the default (home) repository; `campaign` shares the local id `shared` with it and alone has `trpg`.
// A hidden repository is never loaded, so its notebooks are absent from what the browser resolves against.
const notebooks = { 'kb~life': 'repo-kb', 'kb~shared': 'repo-kb', 'campaign~shared': 'repo-campaign', 'campaign~trpg': 'repo-campaign' };
const resolve = (localId: string) => resolveBareId(notebooks, 'repo-kb', localId);

describe('resolveBareId', () => {
  it('answers the one repository with the local id, else the default repository, else nothing', () => {
    expect(resolve('trpg')).toBe('campaign~trpg');
    expect(resolve('shared')).toBe('kb~shared');
    expect(resolve('hidden-only')).toBeNull();
    expect(resolveBareId({ 'campaign~shared': 'repo-campaign', 'other~shared': 'repo-other' }, 'repo-kb', 'shared')).toBeNull();
    expect(resolve('kb~life')).toBeNull();
  });
});

describe('notebookIdCodec', () => {
  it('turns a repository local id into its key and back, refusing another repository key', () => {
    const codec = notebookIdCodec('kb');
    expect(codec.toKey('life')).toBe('kb~life');
    expect(codec.toLocal('kb~life')).toBe('life');
    expect(() => codec.toLocal('campaign~trpg')).toThrow(/does not belong/);
  });
});

describe('bare-id redirect', () => {
  it('moves a bare-id route to the key, keeping the rest of the path and the query', () => {
    expect(bareNotebookRoute('/notebooks/trpg/notes/2026/a.md', '?view=list&tag=x', resolve)).toBe('/notebooks/campaign~trpg/notes/2026/a.md?view=list&tag=x');
    expect(bareNotebookRoute('/notebooks/shared/folders/projects', '', resolve)).toBe('/notebooks/kb~shared/folders/projects');
    expect(bareNotebookRoute('/notebooks/life', '', resolve)).toBe('/notebooks/kb~life');
    // URLSearchParams writes `~` as `%7E`, which reads back as the same key.
    const graph = new URL(bareNotebookRoute('/graph', '?notebook=trpg&q=hello', resolve)!, 'https://notes.test');
    expect([graph.pathname, graph.searchParams.get('notebook'), graph.searchParams.get('q')]).toEqual(['/graph', 'campaign~trpg', 'hello']);
    const both = new URL(bareNotebookRoute('/notebooks/life/notes/a.md', '?notebook=trpg', resolve)!, 'https://notes.test');
    expect([both.pathname, both.searchParams.get('notebook')]).toEqual(['/notebooks/kb~life/notes/a.md', 'campaign~trpg']);
  });

  it('leaves keys, unresolved ids, unknown keys and the former all-notebooks value to the page', () => {
    expect(bareNotebookRoute('/notebooks/kb~life/notes/a.md', '?notebook=kb~life', resolve)).toBeNull();
    expect(bareNotebookRoute('/notebooks/hidden-only/notes/a.md', '', resolve)).toBeNull();
    expect(bareNotebookRoute('/notebooks/missing~life/notes/a.md', '', resolve)).toBeNull();
    expect(bareNotebookRoute('/notebooks/all', '', resolve)).toBeNull();
    expect(bareNotebookRoute('/notes', '', resolve)).toBeNull();
  });

  it('serves a notebook whose local id is all at its key', () => {
    expect(bareNotebookRoute('/notebooks/kb~all/notes/a.md', '', id => id === 'all' ? 'kb~all' : null)).toBeNull();
  });

  it('keys an app link inside a note, keeping its fragment', () => {
    expect(keyedAppUrl('/notebooks/trpg/notes/a.md?view=list#heading', resolve)).toBe('/notebooks/campaign~trpg/notes/a.md?view=list#heading');
    expect(keyedAppUrl('/notebooks/kb~life/notes/a.md#h', resolve)).toBe('/notebooks/kb~life/notes/a.md#h');
    expect(keyedAppUrl('/notebooks/hidden-only/notes/a.md', resolve)).toBe('/notebooks/hidden-only/notes/a.md');
  });
});
