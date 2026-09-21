import type { EditorView } from '@codemirror/view';
import { attachLineGutterGesture } from '../../lib/line-gutter-gesture.js';

interface GutterLineCopyDeps {
  lineOffset: { current: number; };
  onCopyLines: { current: ((firstLine: number, lastLine?: number) => void) | undefined; };
}

const GUTTER_ELEMENT = '.cm-lineNumbers .cm-gutterElement';

/** Wires the line-number gutter's tap, long-press and drag-to-copy-a-range interaction onto a CodeMirror view; returns a cleanup. */
export function attachGutterLineCopy(view: EditorView, { lineOffset, onCopyLines }: GutterLineCopyDeps): () => void {
  return attachLineGutterGesture({
    gutter: view.dom,
    scroller: view.scrollDOM,
    lineFromTarget: target => {
      const element = target.closest<HTMLElement>(GUTTER_ELEMENT);
      const displayed = Number(element?.textContent);
      return element && Number.isFinite(displayed) ? displayed - lineOffset.current : null;
    },
    lineAtY: y => view.state.doc.lineAt(view.lineBlockAtHeight(y - view.documentTop).from).number,
    lineHeight: () => view.defaultLineHeight,
    // Scrolling re-renders the gutter, so the range is repainted on every call rather than once per change.
    onPreview: range =>
      view.dom.querySelectorAll<HTMLElement>(GUTTER_ELEMENT).forEach(node => {
        const number = Number(node.textContent) - lineOffset.current;
        node.classList.toggle('cm-line-copy-selected', range !== null && number >= range[0] && number <= range[1]);
      }),
    onCopy: (first, last) => onCopyLines.current?.(first, last),
  });
}
