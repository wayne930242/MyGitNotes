import { StateField } from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate, WidgetType } from '@codemirror/view';
import { isolateHistory } from '@codemirror/commands';
import { moveOutlineItem, type OutlineDrop, type OutlineItem, outlineItems } from '../../lib/outline-editing.js';

interface Labels {
  move: string;
  before: string;
  after: string;
  child: string;
}
const ranges = StateField.define<OutlineItem[]>({ create: state => outlineItems(state.doc.toString()), update: (items, transaction) => transaction.docChanged ? outlineItems(transaction.state.doc.toString()) : items });

class ItemHandle extends WidgetType {
  constructor(readonly from: number, readonly label: string, readonly start: (event: PointerEvent) => void) {
    super();
  }
  eq(other: ItemHandle) {
    return this.from === other.from && this.label === other.label;
  }
  toDOM() {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'ui-icon-button outline-drag-handle';
    button.dataset.outlineHandle = String(this.from);
    button.setAttribute('aria-label', this.label);
    button.title = this.label;
    button.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="9" cy="5" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="9" cy="19" r="1"/><circle cx="15" cy="5" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="19" r="1"/></svg>';
    button.addEventListener('pointerdown', this.start);
    const anchor = document.createElement('span');
    anchor.className = 'outline-handle-anchor';
    anchor.append(button);
    return anchor;
  }
}

/** Pointer adapter inside the existing CodeMirror view, not a synchronized React tree/editor. */
export function outlineDrag(labels: Labels) {
  const drag = ViewPlugin.fromClass(
    class {
      private gesture: { from: number; x: number; y: number; pointer: number; active: boolean; } | null = null;
      private target: { item: OutlineItem; placement: OutlineDrop; } | null = null;
      private indicator: HTMLDivElement;
      decorations: DecorationSet;
      constructor(readonly view: EditorView) {
        this.decorations = this.handles();
        this.indicator = document.createElement('div');
        this.indicator.className = 'outline-drop-indicator';
        this.indicator.setAttribute('role', 'status');
        this.indicator.hidden = true;
        view.dom.append(this.indicator);
      }
      private handles() {
        return this.view.state.readOnly ? Decoration.none : Decoration.set(this.view.state.field(ranges).map(item => Decoration.widget({ widget: new ItemHandle(item.from, labels.move, event => this.start(event, item.from)), side: -1 }).range(item.marker)), true);
      }
      update(update: ViewUpdate) {
        if (update.docChanged || update.state.readOnly) this.cancel();
        if (update.docChanged || update.startState.readOnly !== update.state.readOnly) this.decorations = this.handles();
      }
      start(event: PointerEvent, from: number) {
        if (this.view.state.readOnly || this.view.compositionStarted || event.button !== 0) return false;
        this.cancel();
        this.gesture = { from, x: event.clientX, y: event.clientY, pointer: event.pointerId, active: false };
        window.addEventListener('pointermove', this.move);
        window.addEventListener('pointerup', this.finish);
        window.addEventListener('pointercancel', this.cancel);
        window.addEventListener('keydown', this.key);
        event.preventDefault();
        return true;
      }
      private key = (event: KeyboardEvent) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          this.cancel();
        }
      };
      private move = (event: PointerEvent) => {
        const gesture = this.gesture;
        if (!gesture || event.pointerId !== gesture.pointer) return;
        if (!gesture.active && Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) < 4) return;
        gesture.active = true;
        event.preventDefault();
        const viewport = this.view.scrollDOM.getBoundingClientRect();
        if (event.clientY < viewport.top + 24) this.view.scrollDOM.scrollTop -= 16;
        if (event.clientY > viewport.bottom - 24) this.view.scrollDOM.scrollTop += 16;
        const position = this.view.posAtCoords({ x: event.clientX, y: event.clientY });
        const items = this.view.state.field(ranges);
        let item = position === null ? undefined : items.filter(candidate => candidate.from <= position && position <= candidate.to).at(-1);
        this.target = null;
        this.indicator.hidden = true;
        if (!item) return;
        // Moving left can target an ancestor level; moving right explicitly selects child placement.
        let coords = this.view.coordsAtPos(item.marker);
        while (coords && item.parent !== null && event.clientX < coords.left) {
          item = items.find(candidate => candidate.marker === item!.parent)!;
          coords = this.view.coordsAtPos(item.marker);
        }
        if (!coords) return;
        const contentCoords = this.view.coordsAtPos(item.content);
        const placement: OutlineDrop = contentCoords && event.clientX >= contentCoords.left + this.view.defaultCharacterWidth * 2 ? 'child' : event.clientY < (coords.top + coords.bottom) / 2 ? 'before' : 'after';
        if (!moveOutlineItem(this.view.state.doc.toString(), gesture.from, item.from, placement)) return;
        const boundary = placement === 'before' ? coords : this.view.coordsAtPos(item.to);
        if (!boundary) return;
        this.target = { item, placement };
        const host = this.view.dom.getBoundingClientRect();
        const left = (placement === 'child' ? contentCoords?.left ?? coords.left : coords.left) - host.left;
        this.indicator.style.left = `${left}px`;
        this.indicator.style.top = `${(placement === 'before' ? boundary.top : boundary.bottom) - host.top}px`;
        this.indicator.style.width = `${Math.max(40, host.width - left - 12)}px`;
        this.indicator.textContent = labels[placement];
        this.indicator.dataset.outlineDrop = placement;
        this.indicator.dataset.indent = String(placement === 'child' ? item.contentIndent : item.indent);
        this.indicator.hidden = false;
      };
      private finish = (event: PointerEvent) => {
        if (!this.gesture || event.pointerId !== this.gesture.pointer) return;
        const result = this.gesture.active && this.target && !this.view.state.readOnly ? moveOutlineItem(this.view.state.doc.toString(), this.gesture.from, this.target.item.from, this.target.placement) : null;
        this.cancel();
        if (!result) return;
        this.view.dispatch({ changes: result.changes, selection: { anchor: result.anchor, head: result.head }, scrollIntoView: true, userEvent: 'move.outline', annotations: isolateHistory.of('full') });
        this.view.focus();
      };
      private cancel = () => {
        this.gesture = null;
        this.target = null;
        this.indicator.hidden = true;
        delete this.indicator.dataset.outlineDrop;
        window.removeEventListener('pointermove', this.move);
        window.removeEventListener('pointerup', this.finish);
        window.removeEventListener('pointercancel', this.cancel);
        window.removeEventListener('keydown', this.key);
      };
      destroy() {
        this.cancel();
        this.indicator.remove();
      }
    },
    { decorations: value => value.decorations },
  );
  return [ranges, drag, EditorView.baseTheme({ '.outline-handle-anchor': { position: 'relative', display: 'inline-block', width: '0', height: '0', verticalAlign: 'middle' }, '.outline-drag-handle': { position: 'absolute', left: '-24px', top: '-10px', width: '20px', height: '20px', minWidth: '20px', minHeight: '20px', padding: '2px', cursor: 'grab', touchAction: 'none', color: 'var(--color-muted)' }, '.outline-drop-indicator': { position: 'absolute', pointerEvents: 'none', zIndex: '20', height: '2px', backgroundColor: 'var(--color-primary)', color: 'var(--color-primary)', fontSize: '11px', lineHeight: '16px', textAlign: 'right' }, '.outline-drop-indicator[hidden]': { display: 'none' }, '@media (max-width: 600px)': { '.outline-handle-anchor .outline-drag-handle': { left: '-16px', top: '-7px', width: '14px', height: '14px', minWidth: '14px', minHeight: '14px', padding: '0' } } })];
}
