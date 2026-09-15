import type { NoteGraphData } from '@mygitnotes/core/note-graph';
import type { GraphLayout } from '@mygitnotes/core/screen-page';
import { optimizeGraphLayout } from './graph-topology-layout.js';

export function initializeGraphLayout(graph: NoteGraphData, known: GraphLayout): GraphLayout {
  const saved = new Map(known.nodes.map(node => [node.path, node]));
  const nodes = graph.nodes.map(node => {
    const previous = saved.get(node.id);
    return previous ? { ...previous, pinned: true } : { path: node.id, x: 0, y: 0 };
  });
  // Existing positions are temporary anchors, not new user-owned pins.
  const result = nodes.every(node => saved.has(node.path)) ? { nodes } : optimizeGraphLayout({ nodes }, graph.links);
  return { nodes: result.nodes.map(node => saved.has(node.path) ? { ...saved.get(node.path)! } : node) };
}
