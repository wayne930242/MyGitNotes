import type { EditorView } from '@codemirror/view';

interface GutterLineCopyDeps {
  lineOffset: { current: number; };
  onCopyLines: { current: ((firstLine: number, lastLine?: number) => void) | undefined; };
}

/** Wires the line-number gutter's click-to-copy and drag-to-copy-a-range interaction onto a CodeMirror view; returns a cleanup. */
export function attachGutterLineCopy(view: EditorView, { lineOffset, onCopyLines }: GutterLineCopyDeps): () => void {
  let gutterDrag: { start: number; current: number; } | null = null;
  let lastGutterClick: { line: number; at: number; } | null = null;
  let lastGutterCopy: { line: number; at: number; } | null = null;
  let dragCleanup: (() => void) | null = null;

  const clearGutterRange = () => view.dom.querySelectorAll<HTMLElement>('.cm-lineNumbers .cm-gutterElement').forEach(node => node.classList.remove('cm-line-copy-selected'));
  const gutterMouseDown = (event: MouseEvent) => {
    if (event.button !== 0) return;
    const target = (event.target as HTMLElement).closest<HTMLElement>('.cm-lineNumbers .cm-gutterElement');
    const displayed = Number(target?.textContent);
    if (!target || !Number.isFinite(displayed)) return;
    event.preventDefault();
    event.stopPropagation();
    const line = displayed - lineOffset.current;
    gutterDrag = { start: line, current: line };
    target.classList.add('cm-line-copy-selected');
    const previous = lastGutterClick;
    if (previous?.line === line && performance.now() - previous.at < 500) {
      lastGutterClick = null;
      lastGutterCopy = { line, at: performance.now() };
      gutterDrag = null;
      clearGutterRange();
      onCopyLines.current?.(line);
      return;
    }
    const move = (moveEvent: MouseEvent) => {
      const drag = gutterDrag;
      if (!drag) return;
      const hovered = document.elementFromPoint(moveEvent.clientX, moveEvent.clientY)?.closest<HTMLElement>('.cm-lineNumbers .cm-gutterElement');
      const hoveredNumber = Number(hovered?.textContent);
      if (!hovered || !Number.isFinite(hoveredNumber)) return;
      drag.current = hoveredNumber - lineOffset.current;
      view.dom.querySelectorAll<HTMLElement>('.cm-lineNumbers .cm-gutterElement').forEach(node => {
        const number = Number(node.textContent) - lineOffset.current;
        node.classList.toggle('cm-line-copy-selected', number >= Math.min(drag.start, drag.current) && number <= Math.max(drag.start, drag.current));
      });
    };
    const up = (upEvent: MouseEvent) => {
      const drag = gutterDrag;
      if (!drag) return;
      upEvent.preventDefault();
      gutterDrag = null;
      dragCleanup?.();
      clearGutterRange();
      if (drag.start !== drag.current) {
        lastGutterClick = null;
        onCopyLines.current?.(drag.start, drag.current);
      } else lastGutterClick = { line: drag.start, at: performance.now() };
    };
    dragCleanup?.();
    dragCleanup = () => {
      window.removeEventListener('mousemove', move, true);
      window.removeEventListener('mouseup', up, true);
      dragCleanup = null;
    };
    window.addEventListener('mousemove', move, true);
    window.addEventListener('mouseup', up, true);
  };
  const gutterDoubleClick = (event: MouseEvent) => {
    const target = (event.target as HTMLElement).closest<HTMLElement>('.cm-lineNumbers .cm-gutterElement');
    const displayed = Number(target?.textContent);
    if (!target || !Number.isFinite(displayed)) return;
    event.preventDefault();
    event.stopPropagation();
    const line = displayed - lineOffset.current, recent = lastGutterCopy;
    if (recent?.line === line && performance.now() - recent.at < 500) return;
    lastGutterCopy = { line, at: performance.now() };
    onCopyLines.current?.(line);
  };
  view.dom.addEventListener('mousedown', gutterMouseDown, true);
  view.dom.addEventListener('dblclick', gutterDoubleClick, true);
  return () => {
    dragCleanup?.();
    view.dom.removeEventListener('mousedown', gutterMouseDown, true);
    view.dom.removeEventListener('dblclick', gutterDoubleClick, true);
  };
}
