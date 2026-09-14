import { useCallback } from 'react';
import type { NoteGraphNode } from '@mygitnotes/core/note-graph';

export const nodeRadius = (node: NoteGraphNode) => 3.5 + Math.min(5, Math.sqrt(node.inDegree || 0) * 1.5);
type PositionedNode = NoteGraphNode & { x?: number; y?: number };

export function useGraphPainting({ nodes, hoverNode, focusNodeId, neighbors, isDark, nodeColor }: {
  nodes: NoteGraphNode[]; hoverNode: NoteGraphNode | null; focusNodeId?: string; neighbors: Set<string>; isDark: boolean; nodeColor: (node: NoteGraphNode) => string;
}) {
  // Custom node rendering on Canvas
  const paintNode = useCallback(
    (node: unknown, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const n = node as NoteGraphNode & { x?: number; y?: number };
      if (n.x === undefined || n.y === undefined) return;

      const isHovered = hoverNode?.id === n.id;
      const isNeighbor = neighbors.has(n.id);
      const isDimmed = hoverNode && !isHovered && !isNeighbor;

      const color = nodeColor(n);

      const radius = nodeRadius(n);

      ctx.save();
      ctx.globalAlpha = (isDimmed ? 0.25 : 1.0) * (n.external ? 0.35 : 1);

      // Outer glow for hovered
      if (isHovered) {
        ctx.beginPath();
        ctx.arc(n.x, n.y, radius + 4 / globalScale, 0, 2 * Math.PI, false);
        ctx.fillStyle = isDark ? 'rgba(148, 163, 184, 0.2)' : 'rgba(120, 149, 181, 0.16)';
        ctx.fill();
      }

      // Main circle
      ctx.beginPath();
      ctx.arc(n.x, n.y, radius, 0, 2 * Math.PI, false);
      ctx.fillStyle = color;
      ctx.fill();

      // Border stroke
      ctx.lineWidth = 1.5 / globalScale;
      ctx.strokeStyle = isDark ? '#1e293b' : '#ffffff';
      ctx.stroke();

      if (n.id === focusNodeId) {
        ctx.beginPath();
        ctx.arc(n.x, n.y, radius + 5 / globalScale, 0, 2 * Math.PI);
        ctx.lineWidth = 2 / globalScale;
        ctx.strokeStyle = isDark ? '#cbd5e1' : '#64748b';
        ctx.stroke();
      }

      ctx.restore();
    },
    [hoverNode, focusNodeId, neighbors, isDark, nodeColor]
  );

  // Lay labels out after the nodes, in screen-sized units, with priority for focus.
  const paintLabels = useCallback((ctx: CanvasRenderingContext2D, scale: number) => {
    const positionedNodes = (nodes as PositionedNode[]).filter(
      (n): n is PositionedNode & { x: number; y: number } => n.x !== undefined && n.y !== undefined
    );
    type Box = { x: number; y: number; w: number; h: number };
    const occupied: Box[] = positionedNodes.filter(n => !hoverNode || neighbors.has(n.id)).map(n => {
      const r = nodeRadius(n) + 5 / scale;
      return { x: n.x - r, y: n.y - r, w: r * 2, h: r * 2 };
    });
    const priority = (n: NoteGraphNode) => hoverNode?.id === n.id ? 1e6 : neighbors.has(n.id) ? 1e5 : n.inDegree || 0;
    const sorted = [...positionedNodes].sort((a, b) => priority(b) - priority(a) || a.id.localeCompare(b.id));
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const n of sorted) {
      if (hoverNode && !neighbors.has(n.id)) continue;
      if (!hoverNode && scale < 0.8 && !n.inDegree) continue;
      const focused = hoverNode?.id === n.id;
      ctx.font = `${focused ? 600 : 400} ${12 / scale}px system-ui, -apple-system, sans-serif`;
      const lines: string[] = [];
      let line = '';
      // Tokenize words and individual CJK characters for natural mixed-language wrapping.
      const tokens = n.title.match(/[a-zA-Z0-9_.-]+|\s+|[^\s]/gu) || [];
      for (const token of tokens.flatMap(word => ctx.measureText(word).width > 168 / scale ? Array.from(word) : [word])) {
        if (line && ctx.measureText(line + token).width > 168 / scale) {
          lines.push(line.trim());
          line = token.trimStart();
        } else line += token;
      }
      if (line) lines.push(line.trim());
      const visible = hoverNode ? lines : lines.slice(0, 2);
      if (lines.length > visible.length) visible[visible.length - 1] += '…';
      // Bound even a single long filename to the available label width.
      for (let i = 0; i < visible.length; i++) {
        while (ctx.measureText(visible[i]).width > 176 / scale && visible[i].length > 1) {
          visible[i] = visible[i].replace(/…$/, '').slice(0, -1) + '…';
        }
      }
      const w = Math.max(...visible.map(l => ctx.measureText(l).width), 0) + 12 / scale;
      const h = (visible.length * 17 + 6) / scale;
      const gap = nodeRadius(n) + 9 / scale;
      const candidates: Box[] = [
        { x: n.x - w / 2, y: n.y + gap, w, h },
        { x: n.x - w / 2, y: n.y - gap - h, w, h },
        { x: n.x + gap, y: n.y - h / 2, w, h },
        { x: n.x - gap - w, y: n.y - h / 2, w, h },
      ];
      if (hoverNode) {
        // Focus labels are mandatory; search additional lanes instead of hiding them.
        for (let lane = 1; lane <= nodes.length; lane++) {
          candidates.push({ x: n.x - w / 2, y: n.y + gap + lane * (h + 8 / scale), w, h });
        }
      }
      const box = candidates.find(b => !occupied.some(o => b.x < o.x + o.w && b.x + b.w > o.x && b.y < o.y + o.h && b.y + b.h > o.y)) || (hoverNode ? candidates[candidates.length - 1] : undefined);
      if (!box) continue;
      occupied.push(box);
      ctx.globalAlpha = n.external ? 0.45 : 1;
      ctx.fillStyle = isDark ? 'rgba(15,23,42,0.9)' : 'rgba(248,250,252,0.94)';
      ctx.beginPath();
      ctx.roundRect(box.x, box.y, w, h, 4 / scale);
      ctx.fill();
      ctx.fillStyle = isDark ? focused ? '#f1f5f9' : '#cbd5e1' : focused ? '#334155' : '#64748b';
      visible.forEach((text, i) => ctx.fillText(text, box.x + w / 2, box.y + (11.5 + i * 17) / scale));
    }
    ctx.restore();
  }, [nodes, hoverNode, neighbors, isDark]);

  return { paintNode, paintLabels };
}
