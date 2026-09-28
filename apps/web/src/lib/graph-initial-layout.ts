import type { NoteGraphData } from '@mygitnotes/core/note-graph';
import type { GraphPlacement } from './graph-layout.js';
import { optimizeGraphLayout } from './graph-topology-layout.js';

export function initializeGraphLayout(graph: NoteGraphData, known: GraphPlacement): GraphPlacement {
  const saved = new Map(known.nodes.map(node => [node.id, node]));
  const nodes = graph.nodes.map(node => {
    const previous = saved.get(node.id);
    return previous ? { ...previous, pinned: true } : { id: node.id, x: 0, y: 0 };
  });
  // Existing positions are temporary anchors, not new user-owned pins.
  const result = nodes.every(node => saved.has(node.id)) ? { nodes } : optimizeGraphLayout({ nodes }, graph.links);
  return { nodes: result.nodes.map(node => saved.has(node.id) ? { ...saved.get(node.id)! } : node) };
}
