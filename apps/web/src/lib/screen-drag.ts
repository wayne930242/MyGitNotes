import { closestCenter, pointerWithin, type CollisionDetection, type KeyboardCoordinateGetter } from '@dnd-kit/core';

/** Empty custom lanes participate in keyboard movement; dynamic lanes never register. */
export const screenKeyboardCoordinates: KeyboardCoordinateGetter = (event, { context, currentCoordinates }) => {
  if (!['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(event.code) || !context.collisionRect) return;
  event.preventDefault();
  const current = context.collisionRect;
  const x = current.left + current.width / 2, y = current.top + current.height / 2;
  const candidates = context.droppableContainers.getEnabled().flatMap(container => {
    if (container.id === context.active?.id) return [];
    if (String(container.id).startsWith('lane:') && !container.data.current?.empty) return [];
    const rect = context.droppableRects.get(container.id); if (!rect) return [];
    const dx = rect.left + rect.width / 2 - x, dy = rect.top + rect.height / 2 - y;
    const vertical = ['ArrowUp','ArrowDown'].includes(event.code);
    const forward = event.code === 'ArrowDown' ? dy > 5 : event.code === 'ArrowUp' ? dy < -5 : event.code === 'ArrowRight' ? dx > 5 && Math.abs(dy) < current.height / 2 : dx < -5 && Math.abs(dy) < current.height / 2;
    return forward ? [{ rect, distance: vertical ? Math.abs(dy) * 3 + Math.abs(dx) : Math.abs(dx) }] : [];
  }).sort((a,b) => a.distance - b.distance);
  const target = candidates[0]?.rect;
  return target ? { x: currentCoordinates.x + target.left + target.width / 2 - x, y: currentCoordinates.y + target.top + target.height / 2 - y } : undefined;
};

export const screenCollision: CollisionDetection = args => {
  if (!args.pointerCoordinates) return closestCenter(args);
  const hits = pointerWithin(args);
  const cards = hits.filter(hit => !String(hit.id).startsWith('lane:'));
  return cards.length ? cards : hits;
};
