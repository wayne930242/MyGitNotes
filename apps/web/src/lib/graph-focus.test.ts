import { describe, expect, it } from 'vitest';
import type { NoteGraphLink, NoteGraphNode } from '@mygitnotes/core/note-graph';
import { graphFocus, toggleGraphFocus } from './graph-focus.js';

const nodes = ['a', 'b', 'c', 'd'].map(id => ({ id, title: id })) as NoteGraphNode[];
const links = [{ source: 'a', target: 'b' }, { source: 'c', target: 'a' }] as NoteGraphLink[];

describe('graph preview focus', () => {
  it('toggles the same node off and reopens it on the next click', () => {
    let selected = toggleGraphFocus(null, 'a');
    expect(selected).toBe('a');
    selected = toggleGraphFocus(selected, 'a');
    expect(selected).toBeNull();
    expect(graphFocus(nodes, links, selected, null).neighbors.size).toBe(0);
    expect(toggleGraphFocus(selected, 'a')).toBe('a');
  });
  it('switches directly to another selected node', () => {
    expect(toggleGraphFocus('a', 'b')).toBe('b');
  });
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
