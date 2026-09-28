import { describe, expect, it } from 'vitest';
import { buildNoteGraph, extractNoteLinks } from '../src/note-graph.js';
import type { NotebookConfig, NoteItem } from '../src/types.js';

describe('note graph extraction', () => {
  const validPaths = new Set(['notes/example/welcome.md', 'notes/example/index.md', 'notes/example/getting-started/edit-and-commit.md', 'notes/example/projects/weekly-review.md', 'notes/example/projects/ideas/reading-list.md', 'notes/example/hidden.md']);

  it('extracts valid internal relative markdown links and ignores external/assets/images', () => {
    const content = `
# Welcome
Check out [Edit and Commit](getting-started/edit-and-commit.md).
Also see [Weekly Review](projects/weekly-review.md) and [Missing Note](missing.md).
Here is an image: ![Demo Image](../../assets/demo.png)
And external link: [GitHub](https://github.com) or [Email](mailto:test@example.com).
Anchor link: [Section](#getting-started).
Self link: [Self](welcome.md).
`;
    const links = extractNoteLinks(content, 'notes/example/welcome.md', validPaths);
    expect(links).toContain('notes/example/getting-started/edit-and-commit.md');
    expect(links).toContain('notes/example/projects/weekly-review.md');
    expect(links).not.toContain('notes/example/missing.md');
    expect(links).not.toContain('notes/example/welcome.md');
    expect(links.length).toBe(2);
  });

  it('handles relative parent directory paths (../)', () => {
    const content = `
[Weekly Review](../weekly-review.md)
[Welcome](../../welcome.md)
`;
    const links = extractNoteLinks(content, 'notes/example/projects/ideas/reading-list.md', validPaths);
    expect(links).toContain('notes/example/projects/weekly-review.md');
    expect(links).toContain('notes/example/welcome.md');
    expect(links.length).toBe(2);
  });

  it('builds graph data with accurate in-degrees, out-degrees and node sizing', () => {
    const notes: NoteItem[] = [{ id: 'notes/example/welcome.md', path: 'notes/example/welcome.md', notebookId: 'example', title: 'Welcome', status: 'done', tags: ['guide'], metadata: {}, content: 'Links to [Edit](getting-started/edit-and-commit.md) and [Weekly](projects/weekly-review.md)' }, { id: 'notes/example/getting-started/edit-and-commit.md', path: 'notes/example/getting-started/edit-and-commit.md', notebookId: 'example', title: 'Edit & Commit', status: 'working', tags: ['editing'], metadata: {}, content: 'Back to [Welcome](../welcome.md)' }, { id: 'notes/example/projects/weekly-review.md', path: 'notes/example/projects/weekly-review.md', notebookId: 'example', title: 'Weekly Review', status: 'inbox', tags: ['planning'], metadata: {}, content: 'Also references [Welcome](../welcome.md)' }, { id: 'notes/example/hidden.md', path: 'notes/example/hidden.md', notebookId: 'example', title: 'Hidden Note', status: 'archived', tags: [], metadata: { hiden: true }, content: 'Nothing here' }];

    const graph = buildNoteGraph(notes);
    // Hidden note is excluded by default
    expect(graph.nodes.length).toBe(3);
    const welcomeNode = graph.nodes.find((n) => n.id === 'example:notes/example/welcome.md');
    expect(welcomeNode).toBeDefined();
    // Welcome is linked by edit-and-commit and weekly-review -> inDegree 2
    expect(welcomeNode?.inDegree).toBe(2);
    // Welcome links to edit-and-commit and weekly-review -> outDegree 2
    expect(welcomeNode?.outDegree).toBe(2);
    expect(welcomeNode?.val).toBeGreaterThan(4);

    const editNode = graph.nodes.find((n) => n.id === 'example:notes/example/getting-started/edit-and-commit.md');
    expect(editNode?.inDegree).toBe(1);

    // Including hidden notes
    const graphWithHidden = buildNoteGraph(notes, { includeHidden: true });
    expect(graphWithHidden.nodes.length).toBe(4);
  });

  describe('across repositories', () => {
    const note = (notebookId: string, path: string, content: string): NoteItem => ({ id: path, path, notebookId, title: path, tags: [], metadata: {}, content });
    // `one` and `two` live in different repositories and share a root; `sibling` shares one's repository.
    const notebooks = [{ id: 'one', title: 'One', root: 'notes/shared', pathAliases: { '@/*': 'notes/shared/*' } }, { id: 'two', title: 'Two', root: 'notes/shared', pathAliases: { '@/*': 'notes/shared/elsewhere/*' } }, { id: 'sibling', title: 'Sibling', root: 'notes/sibling' }] as NotebookConfig[];
    const repositories: Record<string, string> = { one: 'first', sibling: 'first', two: 'second' };
    const notes = [note('one', 'notes/shared/a.md', '[same](b.md) [alias](@/c.md) [only two](only-two.md) [sibling](../sibling/s.md)'), note('one', 'notes/shared/b.md', ''), note('one', 'notes/shared/c.md', ''), note('two', 'notes/shared/a.md', '[same](b.md) [alias](@/c.md) [[only-two]]'), note('two', 'notes/shared/b.md', ''), note('two', 'notes/shared/elsewhere/c.md', ''), note('two', 'notes/shared/only-two.md', ''), note('sibling', 'notes/sibling/s.md', '[[c]]')];
    const graph = buildNoteGraph(notes, { notebooks, repositoryOf: id => repositories[id] });

    it('keeps notes with the same path as distinct nodes', () => {
      expect(graph.nodes.filter(node => node.path === 'notes/shared/a.md').map(node => node.id)).toEqual(['one:notes/shared/a.md', 'two:notes/shared/a.md']);
    });

    it("resolves links within the source repository, with the source notebook's aliases", () => {
      const from = (source: string) => graph.links.filter(link => link.source === source).map(link => link.target);
      expect(from('one:notes/shared/a.md')).toEqual(['one:notes/shared/b.md', 'one:notes/shared/c.md', 'sibling:notes/sibling/s.md']);
      expect(from('two:notes/shared/a.md')).toEqual(['two:notes/shared/b.md', 'two:notes/shared/elsewhere/c.md', 'two:notes/shared/only-two.md']);
      expect(from('sibling:notes/sibling/s.md')).toEqual(['one:notes/shared/c.md']);
      expect(graph.nodes.find(node => node.id === 'two:notes/shared/only-two.md')?.inDegree).toBe(1);
    });

    it('treats every notebook as one repository by default', () => {
      const single = buildNoteGraph([note('one', 'notes/shared/a.md', '[s](../sibling/s.md)'), note('sibling', 'notes/sibling/s.md', '')]);
      expect(single.links).toEqual([{ source: 'one:notes/shared/a.md', target: 'sibling:notes/sibling/s.md' }]);
    });
  });
});
