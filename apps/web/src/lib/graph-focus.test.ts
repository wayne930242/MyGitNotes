import { describe, expect, it } from 'vitest';
import type { NoteGraphNode, NoteGraphLink } from '@github-notes/core/note-graph';
import { graphFocus } from './graph-focus.js';

const nodes = ['a', 'b', 'c', 'd'].map(id => ({ id, title: id })) as NoteGraphNode[];
const links = [{ source: 'a', target: 'b' }, { source: 'c', target: 'a' }] as NoteGraphLink[];

describe('graph preview focus', () => {
  it('retains the selected node after the pointer leaves or hovers another node', () => {
    for (const hover of [null, nodes[3]]) {
      const result = graphFocus(nodes, links, 'a', hover);
      expect(result.selected).toBe(nodes[0]);
      expect(result.highlighted).toBe(nodes[0]);
      expect([...result.neighbors]).toEqual(['a', 'b', 'c']);
    }
  });
  it('clears focus when the preview closes and restores ordinary hover', () => {
    expect(graphFocus(nodes, links, null, null).neighbors.size).toBe(0);
    const result = graphFocus(nodes, links, null, nodes[3]);
    expect(result.selected).toBeNull();
    expect(result.highlighted).toBe(nodes[3]);
  });
  it('changes selection and supports simulation-resolved links', () => {
    const resolved = [{ source: nodes[0], target: nodes[1] }] as unknown as NoteGraphLink[];
    expect([...graphFocus(nodes, resolved, 'b', null).neighbors]).toEqual(['b', 'a']);
  });
});
