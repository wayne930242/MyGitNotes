import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from '../lib/i18n/index.js';
import { findMarkdownTables, serializeMarkdownTable, type MarkdownTable, type TableAlignment } from '../lib/markdown-tables.js';

interface Props {
  content: string;
  readOnly: boolean;
  selection: () => number;
  replace: (from: number, to: number, text: string) => void;
}

export function MarkdownTableTools({ content, readOnly, selection, replace }: Props) {
  const { t } = useTranslation();
  const dialog = useRef<HTMLDialogElement>(null);
  const [draft, setDraft] = useState<MarkdownTable | null>(null);
  const [snapshot, setSnapshot] = useState('');
  const [selected, setSelected] = useState<[number, number]>([0, 0]);
  const [isNew, setIsNew] = useState(false);
  const tables = useMemo(() => findMarkdownTables(content), [content]);
  const [row, column] = selected;
  useEffect(() => { if (draft) dialog.current?.showModal(); }, [!!draft]);
  const close = () => { dialog.current?.close(); setDraft(null); };
  const open = (table?: MarkdownTable) => {
    const position = selection();
    setDraft(table ?? { from: position, to: position, rows: [[t('table.column') + ' 1', t('table.column') + ' 2'], ['', '']], alignments: ['none', 'none'] });
    setSnapshot(content); setSelected([0, 0]); setIsNew(!table);
  };
  const edit = () => {
    const position = selection();
    open(tables.find(table => table.from <= position && table.to >= position) ?? tables[0]);
  };
  const update = (operation: (table: MarkdownTable) => void) => setDraft(previous => {
    if (!previous) return previous;
    const next = { ...previous, rows: previous.rows.map(values => [...values]), alignments: [...previous.alignments] };
    operation(next); return next;
  });
  const addRow = (index: number) => {
    update(table => table.rows.splice(index, 0, table.alignments.map(() => ''))); setSelected([index, column]);
  };
  const addColumn = (index: number) => {
    update(table => { table.rows.forEach(values => values.splice(index, 0, '')); table.alignments.splice(index, 0, 'none'); }); setSelected([row, index]);
  };
  const apply = () => {
    if (!draft || readOnly || snapshot !== content) return;
    const newline = content.includes('\r\n') ? '\r\n' : '\n';
    const text = serializeMarkdownTable(draft, newline);
    replace(draft.from, draft.to, isNew ? `${newline}${newline}${text}${newline}${newline}` : text);
    close();
  };
  return <>
    {!readOnly && <>
      <button type="button" onClick={() => open()}>{t('table.insert')}</button>
      <button type="button" disabled={!tables.length} onClick={edit}>{t('table.edit')}</button>
      {tables.length > 1 && <select aria-label={t('table.select')} value="" onChange={event => open(tables[Number(event.target.value)])}>
        <option value="" disabled>{t('table.select')}</option>
        {tables.map((table, index) => <option key={table.from} value={index}>{index + 1}: {table.rows[0].join(' / ')}</option>)}
      </select>}
    </>}
    <dialog ref={dialog} className="markdown-table-dialog" aria-label={t('table.edit')} onCancel={close}>
      {draft && <div className="flex flex-col min-h-0 gap-3 p-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-semibold">{isNew ? t('table.insert') : t('table.edit')}</h2>
          <button type="button" onClick={close} aria-label={t('table.cancel')}>×</button>
        </div>
        <p className="text-xs text-slate-500">{t('table.hint')}</p>
        <div className="markdown-table-actions" role="group" aria-label={t('table.operations')}>
          <button type="button" disabled={row === 0} onClick={() => addRow(row)}>{t('table.rowBefore')}</button>
          <button type="button" onClick={() => addRow(row + 1)}>{t('table.rowAfter')}</button>
          <button type="button" disabled={row === 0} onClick={() => { update(table => table.rows.splice(row, 1)); setSelected([row - 1, column]); }}>{t('table.deleteRow')}</button>
          <button type="button" onClick={() => addColumn(column)}>{t('table.columnBefore')}</button>
          <button type="button" onClick={() => addColumn(column + 1)}>{t('table.columnAfter')}</button>
          <button type="button" disabled={draft.alignments.length === 1} onClick={() => {
            update(table => { table.rows.forEach(values => values.splice(column, 1)); table.alignments.splice(column, 1); }); setSelected([row, Math.max(0, column - 1)]);
          }}>{t('table.deleteColumn')}</button>
          <label>{t('table.align')} <select aria-label={t('table.align')} value={draft.alignments[column]} onChange={event => update(table => { table.alignments[column] = event.target.value as TableAlignment; })}>
            {(['none', 'left', 'center', 'right'] as const).map(value => <option key={value} value={value}>{t(`table.${value}`)}</option>)}
          </select></label>
        </div>
        <p className="text-xs" aria-live="polite">{t('table.selected', { row: row + 1, column: column + 1 })}</p>
        <div className="markdown-table-grid">
          <table><tbody>{draft.rows.map((values, rowIndex) => <tr key={rowIndex}>{values.map((value, columnIndex) => <td key={columnIndex} data-selected={row === rowIndex && column === columnIndex}>
            <input aria-label={t('table.cell', { row: rowIndex + 1, column: columnIndex + 1 })} value={value}
              className={rowIndex === 0 ? 'font-semibold' : ''}
              onFocus={() => setSelected([rowIndex, columnIndex])}
              onChange={event => update(table => { table.rows[rowIndex][columnIndex] = event.target.value; })} />
          </td>)}</tr>)}</tbody></table>
        </div>
        {snapshot !== content && <p role="alert">{t('table.changed')}</p>}
        <div className="markdown-table-actions justify-end">
          <button type="button" onClick={close}>{t('table.cancel')}</button>
          <button type="button" disabled={readOnly || snapshot !== content} onClick={apply}>{t('table.apply')}</button>
        </div>
      </div>}
    </dialog>
  </>;
}
