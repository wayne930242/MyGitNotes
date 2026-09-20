import ForceGraph2D from 'react-force-graph-2d';
import { themeColor, tokenAlpha } from '../../lib/theme-color.js';
import type { useGraphController } from './useGraphController.js';
import type { Node } from './types.js';
export function GraphCanvas({ model }: { model: ReturnType<typeof useGraphController>; }) {
  const { laneIds, showOutside, closing, fg, size, selected, setSelected, layout, hover, sessions, laneMembers, expanded, graphData, nodeColor, currentLayout, persistLayout, freeze, additive, select, frame, onEngineStop, onNodeHover } = model;

  return (
    <>
      <ForceGraph2D
        ref={fg}
        width={size.width}
        height={size.height}
        graphData={graphData}
        nodeId='id'
        cooldownTicks={1}
        onRenderFramePost={frame}
        onEngineStop={onEngineStop}
        onNodeDragEnd={node => {
          freeze();
          const next = currentLayout();
          const saved = next.nodes.find(n => n.path === node.id);
          if (saved) saved.pinned = true;
          persistLayout(next);
        }}
        onNodeClick={(node, event) => select(node.id, event)}
        onNodeHover={onNodeHover}
        onBackgroundClick={() => setSelected([])}
        enablePanInteraction={event => !additive(event)}
        nodeCanvasObject={(node: Node, ctx, scale) => {
          if (expanded.has(node.id) || closing.has(node.id)) return;
          const x = node.x || 0, y = node.y || 0, radius = selected.includes(node.id) ? 9 : 6;
          ctx.beginPath();
          ctx.arc(x, y, radius, 0, Math.PI * 2);
          ctx.fillStyle = nodeColor(node);
          ctx.globalAlpha = showOutside && laneIds.length && !laneMembers.has(node.id) ? .25 : node.external ? .4 : 1;
          ctx.fill();
          if (selected.includes(node.id)) {
            ctx.strokeStyle = themeColor('var(--color-text)');
            ctx.lineWidth = 2 / scale;
            ctx.stroke();
          }
          ctx.font = `${12 / scale}px sans-serif`;
          ctx.textAlign = 'center';
          ctx.fillStyle = themeColor('var(--color-muted)');
          ctx.fillText(node.title, x, y + radius + 15 / scale);
          ctx.globalAlpha = 1;
        }}
        nodePointerAreaPaint={(node: Node, color, ctx) => {
          if (expanded.has(node.id)) return;
          ctx.beginPath();
          ctx.arc(node.x || 0, node.y || 0, 12, 0, Math.PI * 2);
          ctx.fillStyle = color;
          ctx.fill();
        }}
        linkCanvasObjectMode={() => 'replace'}
        linkCanvasObject={(edge: any, ctx, scale) => {
          const a = edge.source as Node, b = edge.target as Node;
          if (a.x === undefined || b.x === undefined) return;
          const end = (from: Node, to: Node) => {
            const card = layout.nodes.find(n => n.path === from.id && n.expanded);
            const dx = to.x! - from.x!, dy = to.y! - from.y!;
            const factor = card ? Math.min((card.width || 360) / 2 / (Math.abs(dx) || 1e-9), (card.height || 300) / 2 / (Math.abs(dy) || 1e-9)) : 8 / Math.max(1, Math.hypot(dx, dy));
            return { x: from.x! + dx * Math.min(.49, factor), y: from.y! + dy * Math.min(.49, factor) };
          };
          const start = end(a, b), stop = end(b, a), angle = Math.atan2(stop.y - start.y, stop.x - start.x);
          const pending = sessions.get(a.id)?.dirty;
          ctx.strokeStyle = themeColor(tokenAlpha('muted', 55));
          ctx.lineWidth = (hover === a.id || hover === b.id ? 2 : 1) / scale;
          ctx.setLineDash(pending ? [5 / scale, 4 / scale] : []);
          ctx.beginPath();
          ctx.moveTo(start.x, start.y);
          ctx.lineTo(stop.x, stop.y);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.beginPath();
          ctx.moveTo(stop.x, stop.y);
          ctx.lineTo(stop.x - Math.cos(angle - .45) * 8 / scale, stop.y - Math.sin(angle - .45) * 8 / scale);
          ctx.moveTo(stop.x, stop.y);
          ctx.lineTo(stop.x - Math.cos(angle + .45) * 8 / scale, stop.y - Math.sin(angle + .45) * 8 / scale);
          ctx.stroke();
        }}
      />
    </>
  );
}
