import { StateEffect, StateField } from '@codemirror/state';
import { EditorView, WidgetType } from '@codemirror/view';
import { isolateHistory, redo, undo } from '@codemirror/commands';
import { findMarkdownTables, serializeMarkdownTable, type TableAlignment, tableCellEditorText } from '../lib/markdown-tables.js';
import { renderNote } from '../lib/markdown.js';
import type { TranslationKey } from '../lib/i18n/en.js';
import { youtubeLabels } from '../lib/youtube-embed.js';

type Translate = (key: TranslationKey, params?: Record<string, string | number>) => string;
const icons: Record<string, string> = { expand: '<path d="M8 4H4v4m0-4 6 6m6 10h4v-4m0 4-6-6"/>', fit: '<path d="M4 4v16M20 4v16M7 12h10m-7-3-3 3 3 3m4-6 3 3-3 3"/>', row: '<rect x="3" y="3" width="18" height="14" rx="2"/><path d="M3 8h18M3 12h18M8 21h8"/>', column: '<rect x="3" y="3" width="18" height="14" rx="2"/><path d="M9 3v14M15 3v14M8 21h8"/>', edit: '<path d="m15 5 4 4M4 20l4-1L20 7a3 3 0 0 0-4-4L4 15v5Z"/>' };
interface TableUI {
  row: number;
  column: number;
  width: 'fit' | 'expanded';
}
export const tableUIChanged = StateEffect.define<{ from: number; ui: TableUI; }>();
export const tableUIState = StateField.define<Map<number, TableUI>>({
  create: () => new Map(),
  update(value, transaction) {
    const next = new Map([...value].map(([from, ui]) => [transaction.changes.mapPos(from, -1), ui]));
    for (const effect of transaction.effects) if (effect.is(tableUIChanged)) next.set(effect.value.from, effect.value.ui);
    return next;
  },
});

export class LiveMarkdownTable extends WidgetType {
  constructor(readonly text: string, readonly path: string, readonly from: number, readonly readOnly: boolean, readonly t: Translate, readonly ui?: TableUI) {
    super();
  }
  eq(other: LiveMarkdownTable) {
    return this.text === other.text && this.path === other.path && this.from === other.from && this.readOnly === other.readOnly && this.t === other.t && this.ui === other.ui;
  }
  toDOM(view: EditorView) {
    const root = document.createElement('div');
    root.className = 'live-md-table live-md-rendered prose-custom';
    root.contentEditable = 'false';
    root.dataset.tableFrom = String(this.from);
    const model = findMarkdownTables(this.text)[0];
    root.innerHTML = renderNote(this.text, this.path, this.t('preview.scrollableTable'), youtubeLabels(this.t));
    if (!model) return root;
    const scroller = root.querySelector<HTMLElement>('.markdown-table-scroll')!;
    const table = root.querySelector('table')!;
    let width: TableUI['width'] = this.ui?.width ?? 'expanded';
    if (!this.ui) {
      try {
        width = localStorage.getItem('github-notes:table-width') === 'fit' ? 'fit' : 'expanded';
      } catch { /* Use the default width. */ }
    }
    root.dataset.tableWidth = width;
    let row = Math.min(this.ui?.row ?? 0, model.rows.length - 1);
    let column = Math.min(this.ui?.column ?? 0, model.alignments.length - 1);
    let input: HTMLTextAreaElement | null = null;
    let initialValue = '';
    let committing = false;
    const toolbar = document.createElement('div');
    toolbar.className = 'live-table-toolbar';
    toolbar.setAttribute('role', 'toolbar');
    toolbar.setAttribute('aria-label', this.t('table.operations'));
    root.prepend(toolbar);
    const button = (parent: HTMLElement, label: string, symbol: string, action: () => void, className = '') => {
      const control = document.createElement('button');
      control.type = 'button';
      control.className = className;
      control.title = label;
      control.setAttribute('aria-label', label);
      if (icons[symbol]) control.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[symbol]}</svg>`;
      else control.textContent = symbol;
      control.addEventListener('mousedown', event => event.preventDefault());
      control.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        action();
      });
      parent.append(control);
      return control;
    };
    const restoreFocus = () =>
      requestAnimationFrame(() => {
        if (!view.dom.isConnected) return;
        const cell = view.dom.querySelector<HTMLElement>(`.live-md-table[data-table-from="${this.from}"] [data-selected="true"]`);
        if (cell) cell.focus({ preventScroll: true });
        else view.focus();
      });
    const captureInput = () => {
      if (input && input.value !== initialValue) model.rows[row][column] = input.value;
    };
    const save = (focusAfter = true) => {
      if (this.readOnly || view.state.readOnly || committing || !root.isConnected || view.state.sliceDoc(this.from, this.from + this.text.length) !== this.text) return;
      captureInput();
      committing = true;
      const text = serializeMarkdownTable(model);
      view.dispatch({ ...(text === this.text ? {} : { changes: { from: this.from, to: this.from + this.text.length, insert: text } }), effects: tableUIChanged.of({ from: this.from, ui: { row, column, width } }), annotations: isolateHistory.of('full'), userEvent: 'input.table' });
      view.requestMeasure();
      if (focusAfter) restoreFocus();
    };
    const setWidth = () => {
      width = width === 'fit' ? 'expanded' : 'fit';
      captureInput();
      try {
        localStorage.setItem('github-notes:table-width', width);
      } catch { /* Keep this editor's choice. */ }
      if (input) save();
      else view.dispatch({ effects: tableUIChanged.of({ from: this.from, ui: { row, column, width } }) });
      view.requestMeasure();
      restoreFocus();
    };
    const widthButton = button(toolbar, this.t(width === 'fit' ? 'table.expanded' : 'table.fit'), width === 'fit' ? 'expand' : 'fit', setWidth);
    widthButton.dataset.tableWidthToggle = '';
    if (this.readOnly) return root;

    const alignment = document.createElement('select');
    alignment.title = this.t('table.align');
    alignment.setAttribute('aria-label', this.t('table.align'));
    for (const value of ['none', 'left', 'center', 'right'] as const) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = this.t(`table.${value}`);
      alignment.append(option);
    }
    alignment.addEventListener('mousedown', event => {
      if (input) event.preventDefault();
    });
    alignment.addEventListener('change', () => {
      captureInput();
      model.alignments[column] = alignment.value as TableAlignment;
      save();
    });
    toolbar.prepend(alignment);
    const deleteRow = button(toolbar, this.t('table.deleteRow'), 'row', () => {
      if (row === 0) return;
      captureInput();
      input = null;
      model.rows.splice(row, 1);
      row--;
      save();
    });
    const deleteColumn = button(toolbar, this.t('table.deleteColumn'), 'column', () => {
      if (model.alignments.length === 1) return;
      captureInput();
      input = null;
      model.rows.forEach(values => values.splice(column, 1));
      model.alignments.splice(column, 1);
      column = Math.max(0, column - 1);
      save();
    });
    for (const [control, axis] of [[deleteRow, 'row'], [deleteColumn, 'column']] as const) {
      control.addEventListener('mouseenter', () => {
        if (control.disabled) return;
        const cells = axis === 'row' ? [...table.rows[row].cells] : [...table.rows].map(values => values.cells[column]);
        cells.forEach(cell => cell.setAttribute('data-delete-preview', ''));
      });
      control.addEventListener('mouseleave', () => table.querySelectorAll('[data-delete-preview]').forEach(cell => cell.removeAttribute('data-delete-preview')));
    }
    const selectCell = (nextRow: number, nextColumn: number) => {
      row = nextRow;
      column = nextColumn;
      for (const cell of table.querySelectorAll<HTMLElement>('th, td')) cell.removeAttribute('data-selected');
      table.rows[row]?.cells[column]?.setAttribute('data-selected', 'true');
      deleteRow.disabled = row === 0;
      deleteColumn.disabled = model.alignments.length === 1;
      alignment.value = model.alignments[column];
    };
    const editCell = (cell: HTMLTableCellElement, nextRow: number, nextColumn: number) => {
      if (input || view.state.readOnly) return;
      selectCell(nextRow, nextColumn);
      initialValue = tableCellEditorText(model.rows[row][column]);
      input = document.createElement('textarea');
      input.className = 'live-table-cell-editor';
      input.value = initialValue;
      input.rows = 1;
      input.wrap = 'soft';
      input.title = this.t('table.multilineHint');
      input.setAttribute('aria-description', this.t('table.multilineHint'));
      input.setAttribute('aria-label', this.t('table.cell', { row: row + 1, column: column + 1 }));
      const original = cell.innerHTML;
      const cancel = (focusAfter = true) => {
        input = null;
        cell.innerHTML = original;
        view.requestMeasure();
        if (focusAfter) cell.focus();
      };
      input.addEventListener('blur', event => {
        if (!input || committing) return;
        if (input.value === initialValue) {
          cancel(false);
          return;
        }
        const next = event.relatedTarget;
        if (next instanceof HTMLTableCellElement && table.contains(next)) {
          captureInput();
          input = null;
          row = (next.parentElement as HTMLTableRowElement).rowIndex;
          column = next.cellIndex;
          save();
        } else save(false);
      });
      input.addEventListener('keydown', event => {
        event.stopPropagation();
        if (event.isComposing) return;
        if (event.key === 'Escape') {
          event.preventDefault();
          cancel();
        } else if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
          event.preventDefault();
          save();
        } else if (event.key === 'Tab') {
          const next = row * model.alignments.length + column + (event.shiftKey ? -1 : 1);
          if (next >= 0 && next < model.rows.length * model.alignments.length) {
            event.preventDefault();
            captureInput();
            input = null;
            row = Math.floor(next / model.alignments.length);
            column = next % model.alignments.length;
            save();
          }
        }
      });
      const display = document.createElement('div');
      display.className = 'live-table-cell-display';
      display.setAttribute('aria-hidden', 'true');
      display.append(...cell.childNodes);
      const resizeInput = () => {
        if (!input) return;
        // Measure content independently of the row height so deleting lines can shrink it.
        const style = getComputedStyle(input);
        input.style.height = '0px';
        display.style.height = `${input.scrollHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom)}px`;
        input.style.removeProperty('height');
        view.requestMeasure();
      };
      input.addEventListener('input', resizeInput);
      cell.append(display, input);
      resizeInput();
      input.focus();
      input.select();
    };
    const editButton = button(toolbar, this.t('table.editCell'), 'edit', () => editCell(table.rows[row].cells[column], row, column));
    toolbar.prepend(editButton);
    for (const [r, values] of [...table.rows].entries()) {
      for (const [c, cell] of [...values.cells].entries()) {
        cell.tabIndex = 0;
        cell.title = this.t('table.inlineHint');
        cell.addEventListener('click', event => {
          if (!(event.target as HTMLElement).closest('a, textarea')) selectCell(r, c);
        });
        cell.addEventListener('dblclick', event => {
          if (!(event.target as HTMLElement).closest('a, textarea')) {
            event.preventDefault();
            editCell(cell, r, c);
          }
        });
        cell.addEventListener('keydown', event => {
          if (event.target !== cell) return;
          if (event.key === 'Enter' || event.key === 'F2') {
            event.preventDefault();
            editCell(cell, r, c);
          }
          if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
            event.preventDefault();
            event.stopPropagation();
            (event.shiftKey ? redo : undo)(view);
            restoreFocus();
          }
        });
        cell.addEventListener('focus', () => selectCell(r, c));
      }
    }
    selectCell(row, column);
    // One insertion target per axis follows the nearest visible grid boundary.
    let rowIndex = 1, columnIndex = 0;
    const addRow = button(root, this.t('table.insertRowHere'), '+', () => {
      captureInput();
      input = null;
      model.rows.splice(rowIndex, 0, model.alignments.map(() => ''));
      row = rowIndex;
      save();
    }, 'live-table-insert live-table-insert-row');
    const addColumn = button(root, this.t('table.insertColumnHere'), '+', () => {
      captureInput();
      input = null;
      model.rows.forEach(values => values.splice(columnIndex, 0, ''));
      model.alignments.splice(columnIndex, 0, 'none');
      column = columnIndex;
      save();
    }, 'live-table-insert live-table-insert-column');
    const positionHandles = (x: number, y: number, showSelected = false) => {
      const box = root.getBoundingClientRect(), scrollBox = scroller.getBoundingClientRect();
      const rows = [...table.rows], columns = [...table.rows[0].cells];
      const rowEdges = rows.map((element, index) => ({ index: index + 1, position: element.getBoundingClientRect().bottom }));
      const columnEdges = [{ index: 0, position: columns[0].getBoundingClientRect().left }, ...columns.map((element, index) => ({ index: index + 1, position: element.getBoundingClientRect().right }))].filter(edge => edge.position >= scrollBox.left - 1 && edge.position <= scrollBox.right + 1);
      const closestRow = showSelected ? rowEdges[row] : rowEdges.reduce((a, b) => Math.abs(a.position - y) < Math.abs(b.position - y) ? a : b);
      const closestColumn = showSelected ? columnEdges.find(edge => edge.index === column + 1) : columnEdges.reduce<typeof columnEdges[number] | undefined>((a, b) => !a || Math.abs(b.position - x) < Math.abs(a.position - x) ? b : a, undefined);
      rowIndex = closestRow.index;
      addRow.style.left = `${scrollBox.left - box.left}px`;
      addRow.style.top = `${closestRow.position - box.top}px`;
      addRow.dataset.visible = String(showSelected || Math.abs(closestRow.position - y) <= 10);
      addRow.dataset.insertIndex = String(rowIndex);
      if (closestColumn) {
        columnIndex = closestColumn.index;
        addColumn.style.left = `${closestColumn.position - box.left}px`;
        addColumn.style.top = `${scrollBox.top - box.top}px`;
        addColumn.dataset.visible = String(showSelected || Math.abs(closestColumn.position - x) <= 10);
        addColumn.dataset.insertIndex = String(columnIndex);
      } else addColumn.dataset.visible = 'false';
    };
    root.addEventListener('pointermove', event => {
      if (event.pointerType === 'touch') return;
      delete root.dataset.touchActive;
      if ((event.target as HTMLElement).closest('button, select, textarea, .live-table-toolbar')) return;
      positionHandles(event.clientX, event.clientY);
    });
    root.addEventListener('pointerdown', event => {
      if (event.pointerType === 'touch' && (event.target as HTMLElement).closest('td, th')) {
        const cell = (event.target as HTMLElement).closest<HTMLTableCellElement>('td, th')!;
        selectCell((cell.parentElement as HTMLTableRowElement).rowIndex, cell.cellIndex);
        positionHandles(event.clientX, event.clientY, true);
        root.dataset.touchActive = 'true';
      }
    });
    root.addEventListener('focusin', event => {
      if ((event.target as HTMLElement).matches('td, th') && (!root.matches(':hover') || root.dataset.touchActive === 'true')) positionHandles(0, 0, true);
    });
    scroller.addEventListener('scroll', () => {
      if (root.dataset.touchActive === 'true') positionHandles(0, 0, true);
      else {
        addRow.dataset.visible = 'false';
        addColumn.dataset.visible = 'false';
      }
    });
    return root;
  }
  get estimatedHeight() {
    return (this.text.split('\n').length - 1) * 40 + 48;
  }
}
