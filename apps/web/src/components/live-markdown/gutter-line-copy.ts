import { BlockType, type EditorView, GutterMarker, lineNumberWidgetMarker } from '@codemirror/view';
import { attachLineGutterGesture, type LineSpan } from '../../lib/line-gutter-gesture.js';

interface GutterLineCopyDeps {
  lineOffset: { current: number; };
  onCopyLines: { current: ((firstLine: number, lastLine?: number) => void) | undefined; };
}

const GUTTER_ELEMENT = '.cm-lineNumbers .cm-gutterElement';

/**
 * The line number beside a block widget (a directive, table, video, diagram or display formula). CodeMirror leaves
 * those rows without one, so the widget's lines could be neither seen in the gutter nor picked up by a drag.
 * It shows the widget's first line and records every line it replaces.
 */
class BlockLineNumber extends GutterMarker {
  constructor(readonly first: number, readonly last: number, readonly label: string) {
    super();
  }
  eq(other: BlockLineNumber) {
    return other.first === this.first && other.last === this.last && other.label === this.label;
  }
  toDOM() {
    const element = document.createElement('span');
    element.textContent = this.label;
    element.dataset.lineFirst = String(this.first);
    element.dataset.lineLast = String(this.last);
    return element;
  }
}

/** Gives each block widget that replaces document lines a line number, formatted as the gutter formats lines. */
export function blockWidgetLineNumbers(lineOffset: { current: number; }) {
  return lineNumberWidgetMarker.of((view, _widget, block) => {
    // Widgets placed between lines replace none and keep no number, as the page footer does.
    if (block.type !== BlockType.WidgetRange || block.to <= block.from) return null;
    const first = view.state.doc.lineAt(block.from).number, last = view.state.doc.lineAt(block.to).number;
    return new BlockLineNumber(first, last, String(first + lineOffset.current));
  });
}

/** The document lines a gutter row stands for: a block widget's recorded lines, or the one line its number names. */
function rowSpan(element: HTMLElement, offset: number): LineSpan | null {
  const marker = element.querySelector<HTMLElement>('[data-line-first]');
  if (marker) return [Number(marker.dataset.lineFirst), Number(marker.dataset.lineLast)];
  const displayed = Number(element.textContent);
  return element.textContent && Number.isFinite(displayed) ? [displayed - offset, displayed - offset] : null;
}

/** Wires the line-number gutter's tap, long-press and drag-to-copy-a-range interaction onto a CodeMirror view; returns a cleanup. */
export function attachGutterLineCopy(view: EditorView, { lineOffset, onCopyLines }: GutterLineCopyDeps): () => void {
  return attachLineGutterGesture({
    gutter: view.dom,
    scroller: view.scrollDOM,
    lineFromTarget: target => {
      const element = target.closest<HTMLElement>(GUTTER_ELEMENT);
      return element ? rowSpan(element, lineOffset.current) : null;
    },
    // A block widget, or a line an inline widget joins to the next, spans several document lines.
    lineAtY: y => {
      const block = view.lineBlockAtHeight(y - view.documentTop);
      return [view.state.doc.lineAt(block.from).number, view.state.doc.lineAt(block.to).number];
    },
    lineHeight: () => view.defaultLineHeight,
    // Scrolling re-renders the gutter, so the range is repainted on every call rather than once per change.
    onPreview: range =>
      view.dom.querySelectorAll<HTMLElement>(GUTTER_ELEMENT).forEach(node => {
        const span = rowSpan(node, lineOffset.current);
        node.classList.toggle('cm-line-copy-selected', range !== null && span !== null && span[0] <= range[1] && span[1] >= range[0]);
      }),
    onCopy: (first, last) => onCopyLines.current?.(first, last),
  });
}
