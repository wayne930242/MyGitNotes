import type { NoteGraphNode, NoteGraphLink } from '@github-notes/core/note-graph';

export const toggleGraphFocus = (selectedId: string | null, clickedId: string) => selectedId === clickedId ? null : clickedId;

export function graphFocus(nodes: NoteGraphNode[], links: NoteGraphLink[], selectedId: string | null, hoverNode: NoteGraphNode | null) {
  const selected = nodes.find(node => node.id === selectedId) || null;
  const highlighted = selected || hoverNode;
  const neighbors = new Set<string>();
  if (highlighted) {
    neighbors.add(highlighted.id);
    for (const link of links) {
      const source = typeof link.source === 'object' ? (link.source as { id: string }).id : link.source;
      const target = typeof link.target === 'object' ? (link.target as { id: string }).id : link.target;
      if (source === highlighted.id) neighbors.add(target);
      if (target === highlighted.id) neighbors.add(source);
    }
  }
  return { selected, highlighted, neighbors };
}
