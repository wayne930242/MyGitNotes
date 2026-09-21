import type { Transaction } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { findMermaidFences } from './mermaid-fence.js';

const EDGE_MARGIN = 8;
const MIN_VISIBLE_SOURCE = 80;

interface FenceBox {
  /** Line start of the fence, the position its diagram widget is anchored at. */
  pos: number;
  diagram: boolean;
  /** Distance from the top of the scroller to the top of the fence's block. */
  top: number;
  height: number;
}

/**
 * Where the fence's top should sit once its source replaces the diagram: where the diagram's top was, pulled
 * back to the edge when it was scrolled out of view, so the source and its cursor are visible. Null when the
 * diagram was not in view, which leaves the position to CodeMirror's own anchoring.
 */
export function sourceTopAfterEnter(box: { top: number; height: number }, viewportHeight: number): number | null {
  if (box.top >= viewportHeight || box.top + box.height <= 0) return null;
  return Math.min(Math.max(box.top, EDGE_MARGIN), Math.max(EDGE_MARGIN, viewportHeight - MIN_VISIBLE_SOURCE));
}

function measureFences(view: EditorView): FenceBox[] {
  const scrollerTop = view.scrollDOM.getBoundingClientRect().top;
  const drawn = new Set<number>();
  view.dom.querySelectorAll('.live-md-mermaid').forEach(wrapper => drawn.add(view.posAtDOM(wrapper)));
  return findMermaidFences(view.state).map(fence => {
    const pos = view.state.doc.lineAt(fence.from).from;
    const block = view.lineBlockAt(pos);
    return { pos, diagram: drawn.has(pos), top: view.documentTop + block.top - scrollerTop, height: block.height };
  });
}

const HOLD_FRAMES = 30;
const holds = new WeakMap<EditorView, () => void>();
let placing = false;
const USER_SCROLL_EVENTS = ['wheel', 'touchstart', 'pointerdown', 'keydown'];

/**
 * Puts the line at `pos` at `top` and keeps it there while block heights above it settle (an unmeasured
 * diagram is estimated until drawn, so the first placement can land off). The user's own scroll input, any
 * later transaction that is not the hold's own placement, and the view going away end the hold.
 */
export function holdTop(view: EditorView, pos: number, top: number) {
  const place = () => {
    placing = true;
    try {
      view.dispatch({ effects: EditorView.scrollIntoView(pos, { y: 'start', yMargin: top }) });
    } finally {
      placing = false;
    }
  };
  place();
  if (typeof requestAnimationFrame === 'undefined') return;
  const scroller = view.scrollDOM;
  let frames = 0;
  let frame = 0;
  const stop = () => {
    cancelAnimationFrame(frame);
    for (const type of USER_SCROLL_EVENTS) scroller.removeEventListener(type, stop);
    if (holds.get(view) === stop) holds.delete(view);
  };
  holds.set(view, stop);
  const check = () => {
    if (!view.dom.isConnected) return stop();
    const current = view.documentTop + view.lineBlockAt(pos).top - scroller.getBoundingClientRect().top;
    if (Math.abs(current - top) > 1) place();
    if (++frames < HOLD_FRAMES) frame = requestAnimationFrame(check);
    else stop();
  };
  for (const type of USER_SCROLL_EVENTS) scroller.addEventListener(type, stop, { passive: true });
  frame = requestAnimationFrame(check);
}

/**
 * A mermaid fence swaps between its diagram and its raw source as the cursor enters or leaves it, and
 * the two differ in height. Entering keeps the fence's top where the diagram's top was, so the source
 * lands in view; leaving keeps the cursor's line where it was, so what the user is reading stays put.
 */
export function anchorMermaidSwap(trs: readonly Transaction[], view: EditorView) {
  if (placing) return view.update(trs);
  holds.get(view)?.();
  if (trs.some(tr => tr.docChanged)) return view.update(trs);
  const before = measureFences(view);
  const head = trs[trs.length - 1].newSelection.main.head;
  const headTop = view.documentTop + view.lineBlockAt(head).top - view.scrollDOM.getBoundingClientRect().top;
  view.update(trs);
  if (!before.length) return;
  const after = new Map(measureFences(view).map(box => [box.pos, box.diagram]));
  const height = view.scrollDOM.clientHeight;
  const swapped = before.filter(box => after.get(box.pos) === !box.diagram);
  const entered = swapped.find(box => box.diagram);
  if (entered) {
    const top = sourceTopAfterEnter(entered, height);
    if (top !== null) holdTop(view, entered.pos, top);
  } else if (swapped.length && headTop >= 0 && headTop < height) {
    holdTop(view, head, headTop);
  }
}
