import { tokenAlpha } from '../../lib/theme-color.js';
import type { useGraphController } from './useGraphController.js';
export function GraphGestureLayer({ model }: { model: ReturnType<typeof useGraphController>; }) {
  const { size, boxMode, setBoxMode, gesture, setGesture, additive, point, selectBox } = model;

  return (
    <>
      {boxMode && (
        <div
          className='graph-box-layer'
          onPointerDown={event => {
            if (event.button !== 0) return;
            event.currentTarget.setPointerCapture(event.pointerId);
            const start = point(event);
            setGesture({ kind: 'box', start, end: start });
          }}
          onPointerMove={event => {
            if (gesture?.kind === 'box') setGesture({ ...gesture, end: point(event) });
          }}
          onPointerCancel={() => setGesture(null)}
          onPointerUp={event => {
            if (gesture?.kind !== 'box') return;
            selectBox(gesture.start, point(event), additive(event));
            setGesture(null);
            setBoxMode(false);
          }}
        />
      )}
      {gesture && <svg className='graph-gesture' width={size.width} height={size.height}>{gesture.kind === 'box' ? <rect x={Math.min(gesture.start.x, gesture.end.x)} y={Math.min(gesture.start.y, gesture.end.y)} width={Math.abs(gesture.end.x - gesture.start.x)} height={Math.abs(gesture.end.y - gesture.start.y)} style={{ fill: tokenAlpha('primary', 20), stroke: 'var(--color-primary)' }} /> : <line x1={gesture.start.x} y1={gesture.start.y} x2={gesture.end.x} y2={gesture.end.y} style={{ stroke: 'var(--color-primary)' }} strokeWidth='2' />}</svg>}
    </>
  );
}
