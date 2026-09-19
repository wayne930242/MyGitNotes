import type { NoteGraphLink, NoteGraphNode } from '@mygitnotes/core/note-graph';

export type PositionedNode = NoteGraphNode & { x?: number; y?: number; fx?: number; fy?: number; };
export type GraphData = { nodes: NoteGraphNode[]; links: NoteGraphLink[]; };

// Relax only colliding neighbors around their existing positions, without imposing a shape.
export function expandGraphFocus(data: GraphData, focusId: string | undefined, neighbors: Set<string>, zoom: number): GraphData {
  const focus = (data.nodes as PositionedNode[]).find(node => node.id === focusId);
  if (!focus || focus.x === undefined || focus.y === undefined) return data;
  const scale = Math.max(0.05, zoom);
  const related = (data.nodes as PositionedNode[]).filter((node): node is PositionedNode & { x: number; y: number; } => neighbors.has(node.id) && node.x !== undefined && node.y !== undefined).map(node => {
    const textWidth = Array.from(node.title).reduce((width, char) => width + (/[^\x00-\xff]/.test(char) ? 12 : 7), 0);
    return { id: node.id, x: node.x * scale, y: node.y * scale, ox: node.x * scale, oy: node.y * scale, width: Math.max(36, Math.min(168, textWidth) + 20), height: 32 + Math.ceil(textWidth / 168) * 17 };
  });
  for (let iteration = 0; iteration < 80; iteration++) {
    let overlap = false;
    for (let i = 0; i < related.length; i++) {
      for (let j = i + 1; j < related.length; j++) {
        const a = related[i], b = related[j];
        const sx = (a.width + b.width) / 2 + 10, sy = (a.height + b.height) / 2 + 10;
        let dx = b.x - a.x, dy = b.y - a.y;
        if (dx === 0 && dy === 0) {
          dx = Math.cos(i + j * 2.4);
          dy = Math.sin(i + j * 2.4);
        }
        const distance = Math.hypot(dx / sx, dy / sy);
        if (distance >= 1) continue;
        overlap = true;
        const push = (1 / Math.max(0.001, distance) - 1) * 0.55;
        const aWeight = a.id === focusId ? 0 : b.id === focusId ? 1 : 0.5;
        const bWeight = b.id === focusId ? 0 : a.id === focusId ? 1 : 0.5;
        a.x -= dx * push * aWeight;
        a.y -= dy * push * aWeight;
        b.x += dx * push * bWeight;
        b.y += dy * push * bWeight;
      }
    }
    if (!overlap) break;
    for (const node of related) {
      if (node.id === focusId) continue;
      // A light tether keeps the existing arrangement recognizable.
      node.x += (node.ox - node.x) * 0.015;
      node.y += (node.oy - node.y) * 0.015;
    }
  }
  const positions = new Map(related.map(node => [node.id, { x: node.x / scale, y: node.y / scale }]));
  return {
    nodes: (data.nodes as PositionedNode[]).map(node => {
      const position = positions.get(node.id) || { x: node.x, y: node.y };
      return { ...node, ...position, fx: position.x, fy: position.y };
    }),
    links: data.links.map(link => ({ ...link, source: typeof link.source === 'object' ? (link.source as { id: string; }).id : link.source, target: typeof link.target === 'object' ? (link.target as { id: string; }).id : link.target })),
  };
}
