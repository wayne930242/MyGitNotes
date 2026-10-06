const DOUBLE_TAP_MS = 500;
const LONG_PRESS_MS = 500;
const MOVE_SLOP_PX = 6;
const EDGE_LINES = 2;
const MAX_SCROLL_STEP_PX = 24;

/** The lines one gutter row stands for: one line, or every line a block widget (a table, a directive) replaces. */
export type LineSpan = readonly [first: number, last: number];

export interface LineGutterGestureOptions {
  /** Stable element that receives the gesture's pointer events and holds pointer capture. */
  gutter: HTMLElement;
  /** The element that scrolls while a range is dragged toward its top or bottom edge. */
  scroller: HTMLElement;
  /** The body line (or the lines of a block widget) a pointer target sits on, or null when the target is not a line number. */
  lineFromTarget: (target: Element) => number | LineSpan | null;
  /** The body line (or the lines of a block widget) at a viewport y coordinate, clamped to the document. */
  lineAtY: (clientY: number) => number | LineSpan;
  lineHeight: () => number;
  /** Called with the inclusive range being selected, and null when the gesture ends. */
  onPreview: (range: [number, number] | null) => void;
  onCopy: (firstLine: number, lastLine?: number) => void;
}

interface Drag {
  id: number;
  start: LineSpan;
  current: LineSpan;
  originX: number;
  originY: number;
  y: number;
  moved: boolean;
}

const spanOf = (line: number | LineSpan): LineSpan => typeof line === 'number' ? [line, line] : line;
/** The lines from one span to another, whichever way the drag went; a block widget at either end counts whole. */
const rangeOf = (a: LineSpan, b: LineSpan): LineSpan => [Math.min(a[0], b[0]), Math.max(a[1], b[1])];

/**
 * Line-number gutter gestures shared by the live and source editors: a double tap or a touch long-press
 * copies one line (or the block widget a row stands for), and a drag (mouse or touch) selects a range that
 * scrolls when the pointer reaches the top or bottom two visible lines. Returns a cleanup.
 */
export function attachLineGutterGesture(options: LineGutterGestureOptions): () => void {
  const { gutter, scroller } = options;
  let drag: Drag | null = null;
  let lastTap: { line: number; at: number; } | null = null;
  let lastCopy: { line: number; at: number; } | null = null;
  const copy = ([first, last]: LineSpan) => last === first ? options.onCopy(first) : options.onCopy(first, last);
  let longPress: ReturnType<typeof setTimeout> | undefined;
  let frame = 0;

  const paint = () => {
    if (drag) options.onPreview([...rangeOf(drag.start, drag.current)]);
  };
  const end = () => {
    if (!drag) return;
    clearTimeout(longPress);
    cancelAnimationFrame(frame);
    frame = 0;
    if (gutter.hasPointerCapture?.(drag.id)) gutter.releasePointerCapture(drag.id);
    drag = null;
    options.onPreview(null);
  };
  const tick = () => {
    frame = 0;
    if (!drag) return;
    const rect = scroller.getBoundingClientRect();
    const edge = EDGE_LINES * options.lineHeight();
    const below = drag.y - (rect.bottom - edge);
    const above = rect.top + edge - drag.y;
    const depth = below > 0 ? below : above > 0 ? -above : 0;
    if (depth) scroller.scrollTop += Math.sign(depth) * Math.max(2, Math.min(Math.abs(depth) / edge, 1.5) * MAX_SCROLL_STEP_PX);
    drag.current = spanOf(options.lineAtY(drag.y));
    paint();
    frame = requestAnimationFrame(tick);
  };
  const lineOf = (event: Event) => {
    const line = event.target instanceof Element ? options.lineFromTarget(event.target) : null;
    return line === null ? null : spanOf(line);
  };

  const pointerDown = (event: PointerEvent) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    const span = lineOf(event);
    if (span === null) return;
    const line = span[0];
    event.preventDefault();
    event.stopPropagation();
    end();
    const previous = lastTap;
    if (previous?.line === line && performance.now() - previous.at < DOUBLE_TAP_MS) {
      lastTap = null;
      lastCopy = { line, at: performance.now() };
      copy(span);
      return;
    }
    drag = { id: event.pointerId, start: span, current: span, originX: event.clientX, originY: event.clientY, y: event.clientY, moved: false };
    paint();
    gutter.setPointerCapture?.(event.pointerId);
    if (event.pointerType !== 'mouse') {
      longPress = setTimeout(() => {
        if (!drag || drag.moved) return;
        lastTap = null;
        lastCopy = { line, at: performance.now() };
        navigator.vibrate?.(15);
        end();
        copy(span);
      }, LONG_PRESS_MS);
    }
  };
  const pointerMove = (event: PointerEvent) => {
    if (!drag || event.pointerId !== drag.id) return;
    const active = drag;
    active.y = event.clientY;
    if (!active.moved) {
      if (Math.hypot(event.clientX - active.originX, event.clientY - active.originY) < MOVE_SLOP_PX) return;
      active.moved = true;
      clearTimeout(longPress);
      frame = requestAnimationFrame(tick);
    }
    active.current = spanOf(options.lineAtY(event.clientY));
    paint();
  };
  const pointerUp = (event: PointerEvent) => {
    if (!drag || event.pointerId !== drag.id) return;
    event.preventDefault();
    const finished = drag;
    end();
    const range = rangeOf(finished.start, finished.current);
    if (finished.moved && (range[0] !== finished.start[0] || range[1] !== finished.start[1])) {
      lastTap = null;
      options.onCopy(range[0], range[1]);
    } else lastTap = { line: finished.start[0], at: performance.now() };
  };
  const doubleClick = (event: MouseEvent) => {
    const span = lineOf(event);
    if (span === null) return;
    const line = span[0];
    event.preventDefault();
    event.stopPropagation();
    const recent = lastCopy;
    if (recent?.line === line && performance.now() - recent.at < DOUBLE_TAP_MS) return;
    lastCopy = { line, at: performance.now() };
    copy(span);
  };
  const contextMenu = (event: Event) => {
    if (lineOf(event) !== null) event.preventDefault();
  };

  gutter.addEventListener('pointerdown', pointerDown, true);
  gutter.addEventListener('pointermove', pointerMove);
  gutter.addEventListener('pointerup', pointerUp);
  gutter.addEventListener('pointercancel', end);
  gutter.addEventListener('dblclick', doubleClick, true);
  gutter.addEventListener('contextmenu', contextMenu, true);
  return () => {
    end();
    gutter.removeEventListener('pointerdown', pointerDown, true);
    gutter.removeEventListener('pointermove', pointerMove);
    gutter.removeEventListener('pointerup', pointerUp);
    gutter.removeEventListener('pointercancel', end);
    gutter.removeEventListener('dblclick', doubleClick, true);
    gutter.removeEventListener('contextmenu', contextMenu, true);
  };
}
