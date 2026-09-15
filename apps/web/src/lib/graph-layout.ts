import type { GraphLayout } from '@mygitnotes/core/screen-page';

export function arrangeGraphLayout(layout: GraphLayout, { compact = false }: { compact?: boolean } = {}): GraphLayout {
  const nodes = layout.nodes.map(node => ({ ...node }));
  const dimensions = nodes.map(node => node.expanded ? [node.width || 360, node.height || 300] : [32, 32]);
  if (compact && nodes.length) {
    const center = nodes.reduce((sum, node) => ({ x: sum.x + node.x / nodes.length, y: sum.y + node.y / nodes.length }), { x: 0, y: 0 });
    for (const node of nodes) if (!node.pinned) { node.x = center.x + (node.x - center.x) * .88; node.y = center.y + (node.y - center.y) * .88; }
    // Align only nearby card centers. Separate clusters keep their topology.
    for (const axis of ['x', 'y'] as const) {
      let anchor: number | undefined;
      for (const node of nodes.filter(node => node.expanded).sort((a, b) => a[axis] - b[axis])) {
        if (!node.pinned && anchor !== undefined && node[axis] - anchor <= 32) node[axis] = anchor;
        else anchor = node[axis];
      }
    }
  }
  // Resolve rectangles along their existing relative direction, rather than
  // stacking cards on one axis. Pinned positions are user-owned anchors.
  for (let pass = 0; pass < 120; pass++) {
    let moved = false;
    const bounds = nodes.map((node, index) => ({ index, left: node.x - dimensions[index][0] / 2 - 12, right: node.x + dimensions[index][0] / 2 + 12 })).sort((a, b) => a.left - b.left || a.index - b.index);
    for (let i = 0; i < bounds.length; i++) for (let j = i + 1; j < bounds.length && bounds[j].left < bounds[i].right; j++) {
      const ai = bounds[i].index, bi = bounds[j].index, a = nodes[ai], b = nodes[bi];
      if (a.pinned && b.pinned) continue;
      const width = (dimensions[ai][0] + dimensions[bi][0]) / 2 + 24;
      const height = (dimensions[ai][1] + dimensions[bi][1]) / 2 + 24;
      let dx = b.x - a.x, dy = b.y - a.y;
      if (Math.abs(dx) >= width - .01 || Math.abs(dy) >= height - .01) continue;
      if (Math.hypot(dx, dy) < .001) {
        const angle = (ai * 31 + bi * 17 + 1) * 2.399963229728653;
        dx = Math.cos(angle) * .01; dy = Math.sin(angle) * .01;
      }
      const scale = Math.min(width / Math.max(Math.abs(dx), 1e-9), height / Math.max(Math.abs(dy), 1e-9)) - 1;
      const shareA = a.pinned ? 0 : b.pinned ? 1 : .5, shareB = b.pinned ? 0 : a.pinned ? 1 : .5;
      a.x -= dx * (scale + .001) * shareA; a.y -= dy * (scale + .001) * shareA;
      b.x += dx * (scale + .001) * shareB; b.y += dy * (scale + .001) * shareB;
      moved = true;
    }
    if (!moved) break;
  }
  return { nodes };
}

/** Lane height follows graph-space bounds, never the user's camera transform. */
export function graphLaneViewport(layout: GraphLayout, width: number) {
  const bounds = layout.nodes.filter(n => Number.isFinite(n.x) && Number.isFinite(n.y)).map(n => ({
    x: n.x, y: n.y, w: n.expanded ? n.width || 360 : 32, h: n.expanded ? n.height || 300 : 32,
  }));
  if (!bounds.length) return { height: 300, zoom: 1, x: 0, y: 0 };
  const left = Math.min(...bounds.map(n => n.x - n.w / 2)), right = Math.max(...bounds.map(n => n.x + n.w / 2));
  const top = Math.min(...bounds.map(n => n.y - n.h / 2)), bottom = Math.max(...bounds.map(n => n.y + n.h / 2));
  const zoom = Math.min(1, Math.max(1, width - 120) / Math.max(1, right - left));
  return { height: Math.max(300, Math.ceil((bottom - top) * zoom + 120)), zoom, x: (left + right) / 2, y: (top + bottom) / 2 };
}
