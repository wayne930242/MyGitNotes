import { type RefObject, useCallback, useRef } from 'react';
import type { ForceGraphMethods } from 'react-force-graph-2d';
import type { NoteGraphLink, NoteGraphNode } from '@mygitnotes/core/note-graph';
import { themeColor, tokenAlpha } from '../../lib/theme-color.js';
import { useTranslation } from '../../lib/i18n/index.js';
type PositionedNode = NoteGraphNode & { x?: number; y?: number; };

export function useGraphMinimap({ graphRef: fgRef, graphData, dimensions, isDark, nodeColor, onClearHover, onReset: handleResetZoom, onNavigate }: { graphRef: RefObject<ForceGraphMethods<NoteGraphNode, NoteGraphLink> | undefined>; graphData: { nodes: NoteGraphNode[]; links: NoteGraphLink[]; }; dimensions: { width: number; height: number; }; isDark: boolean; nodeColor: (node: NoteGraphNode) => string; onClearHover: () => void; onReset: () => void; onNavigate: () => void; }) {
  const { t } = useTranslation();
  const minimapRef = useRef<HTMLCanvasElement>(null);
  const minimapTransform = useRef({ x: 0, y: 0, scale: 1 });
  const minimapViewport = useRef<{ x: number; y: number; w: number; h: number; } | null>(null);
  const minimapGesture = useRef<{ pointerId: number; startX: number; startY: number; inside: boolean; moved: boolean; centerX: number; centerY: number; scale: number; offsetX: number; offsetY: number; } | null>(null);
  /* eslint-disable react-hooks/exhaustive-deps -- The isDark dependency invalidates canvas colors read from CSS; those external colors are not otherwise React dependencies. */
  const paintMinimap = useCallback(() => {
    const canvas = minimapRef.current;
    const ctx = canvas?.getContext('2d');
    const graph = fgRef.current;
    if (!canvas || !ctx || !graph) return;
    const width = 176;
    const height = 112;
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
      canvas.width = width * dpr;
      canvas.height = height * dpr;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    minimapViewport.current = null;
    const nodes = (graphData.nodes as PositionedNode[]).filter((n): n is PositionedNode & { x: number; y: number; } => n.x !== undefined && n.y !== undefined);
    if (!nodes.length) return;
    const left = Math.min(...nodes.map(n => n.x)) - 20;
    const top = Math.min(...nodes.map(n => n.y)) - 20;
    const right = Math.max(...nodes.map(n => n.x)) + 20;
    const bottom = Math.max(...nodes.map(n => n.y)) + 20;
    const scale = Math.min((width - 24) / (right - left), (height - 24) / (bottom - top));
    const x = (width - (right - left) * scale) / 2 - left * scale;
    const y = (height - (bottom - top) * scale) / 2 - top * scale;
    minimapTransform.current = { x, y, scale };
    const byId = new Map(nodes.map(n => [n.id, n]));
    ctx.strokeStyle = themeColor('var(--color-border)');
    ctx.lineWidth = 0.75;
    for (const link of graphData.links) {
      const source = typeof link.source === 'object' ? link.source as PositionedNode : byId.get(link.source);
      const target = typeof link.target === 'object' ? link.target as PositionedNode : byId.get(link.target);
      if (source?.x === undefined || source.y === undefined || target?.x === undefined || target.y === undefined) continue;
      ctx.beginPath();
      ctx.moveTo(source.x * scale + x, source.y * scale + y);
      ctx.lineTo(target.x * scale + x, target.y * scale + y);
      ctx.stroke();
    }
    for (const n of nodes) {
      ctx.beginPath();
      ctx.arc(n.x * scale + x, n.y * scale + y, 2.2, 0, Math.PI * 2);
      ctx.fillStyle = nodeColor(n);
      ctx.fill();
    }
    const start = graph.screen2GraphCoords(0, 0);
    const end = graph.screen2GraphCoords(dimensions.width, dimensions.height);
    const vx = Math.max(1, start.x * scale + x);
    const vy = Math.max(1, start.y * scale + y);
    const vw = Math.max(0, Math.min(width - 1, end.x * scale + x) - vx);
    const vh = Math.max(0, Math.min(height - 1, end.y * scale + y) - vy);
    minimapViewport.current = { x: vx, y: vy, w: vw, h: vh };
    ctx.fillStyle = themeColor(tokenAlpha('primary', 8));
    ctx.strokeStyle = themeColor('var(--color-primary)');
    ctx.lineWidth = 1;
    ctx.fillRect(vx, vy, vw, vh);
    ctx.strokeRect(vx, vy, vw, vh);
  }, [fgRef, graphData, dimensions, isDark, nodeColor]);
  /* eslint-enable react-hooks/exhaustive-deps */

  const minimap = (
    <button
      type='button'
      aria-label={t('graph.minimap')}
      title={t('graph.minimapHint')}
      onMouseEnter={onClearHover}
      className='overflow-hidden rounded-xl border border-line/80 bg-surface/90 shadow-sm backdrop-blur-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary'
      onClick={(event) => {
        if (!fgRef.current || !graphData.nodes.length) return;
        if (event.detail === 0) handleResetZoom();
      }}
    >
      <canvas
        ref={minimapRef}
        style={{ width: 176, height: 112, touchAction: 'none' }}
        aria-hidden='true'
        className='block cursor-crosshair'
        onPointerDown={event => {
          if (event.button !== 0 || !event.isPrimary || !fgRef.current || !minimapViewport.current) return;
          onNavigate();
          const rect = event.currentTarget.getBoundingClientRect();
          const px = event.clientX - rect.left;
          const py = event.clientY - rect.top;
          const box = minimapViewport.current;
          const inside = px >= box.x && px <= box.x + box.w && py >= box.y && py <= box.y + box.h;
          const center = fgRef.current.centerAt();
          const transform = minimapTransform.current;
          minimapGesture.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, inside, moved: false, centerX: center.x, centerY: center.y, scale: transform.scale, offsetX: transform.x, offsetY: transform.y };
          event.currentTarget.setPointerCapture(event.pointerId);
          event.currentTarget.style.cursor = inside ? 'grabbing' : 'crosshair';
        }}
        onPointerMove={event => {
          const gesture = minimapGesture.current;
          if (gesture) {
            if (gesture.pointerId !== event.pointerId) return;
            const dx = event.clientX - gesture.startX;
            const dy = event.clientY - gesture.startY;
            if (Math.hypot(dx, dy) > 3) gesture.moved = true;
            if (gesture.inside && gesture.moved) {
              fgRef.current?.centerAt(gesture.centerX + dx / gesture.scale, gesture.centerY + dy / gesture.scale, 0);
            }
            return;
          }
          const rect = event.currentTarget.getBoundingClientRect();
          const px = event.clientX - rect.left, py = event.clientY - rect.top;
          const box = minimapViewport.current;
          event.currentTarget.style.cursor = box && px >= box.x && px <= box.x + box.w && py >= box.y && py <= box.y + box.h ? 'grab' : 'crosshair';
        }}
        onPointerUp={event => {
          const gesture = minimapGesture.current;
          if (!gesture || gesture.pointerId !== event.pointerId) return;
          minimapGesture.current = null;
          event.currentTarget.releasePointerCapture(event.pointerId);
          event.currentTarget.style.cursor = gesture.inside ? 'grab' : 'crosshair';
          if (!gesture.inside && !gesture.moved && Math.hypot(event.clientX - gesture.startX, event.clientY - gesture.startY) <= 3) {
            const rect = event.currentTarget.getBoundingClientRect();
            fgRef.current?.centerAt((event.clientX - rect.left - gesture.offsetX) / gesture.scale, (event.clientY - rect.top - gesture.offsetY) / gesture.scale, 300);
          }
        }}
        onPointerCancel={() => {
          minimapGesture.current = null;
        }}
        onLostPointerCapture={event => {
          minimapGesture.current = null;
          event.currentTarget.style.cursor = 'crosshair';
        }}
      />
      <span className='block pb-2 text-[10px] text-muted'>{t('graph.minimap')}</span>
    </button>
  );
  return { paintMinimap, minimap };
}
