import { useState } from 'react';
import type { NoteItem } from '../../lib/types.js';
import type { GraphEditing } from '../../lib/use-graph-editing.js';
import { MarkdownEditor, type MarkdownEditorMode } from '../MarkdownEditor.js';
import { Code2, Eye } from 'lucide-react';
import { useTranslation } from '../../lib/i18n/index.js';
import { noteCandidates } from '../../lib/note-completion.js';

export function GraphNoteCard({ note, notes, editing, onCollapse, onMaximize, onSelect, onMove, onResize, onConnect, onLink, onCaret, selected, maximized, color }: {
  note: NoteItem; notes: NoteItem[]; editing?: GraphEditing; selected: boolean; maximized: boolean;
  color: string;
  onCollapse: () => void; onMaximize: () => void; onSelect: (event: React.MouseEvent) => void;
  onMove: (event: React.PointerEvent) => void; onResize: (event: React.PointerEvent) => void;
  onConnect: (event: React.PointerEvent) => void; onLink: (target: NoteItem) => void; onCaret: (position: number) => void;
}) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<MarkdownEditorMode>('live');
  const [linking, setLinking] = useState(false), [query, setQuery] = useState('');
  const entry = editing?.store.get(note), current = entry?.draft || note;
  const readonly = !editing?.writable || entry?.blocked;
  return <article className={`graph-note-card ${selected ? 'is-selected' : ''}`} style={{ borderColor: color, '--graph-node-color': color } as React.CSSProperties} data-graph-note={note.path} aria-label={note.title}
    onKeyDownCapture={event => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z' && !event.nativeEvent.isComposing) { event.preventDefault(); event.stopPropagation(); if (!readonly) editing?.store.undo(note, event.shiftKey); }
    }}>
    <header onPointerDown={event => { if (!(event.target as Element).closest('button,select,[role="combobox"],.editor-mode-switch') || (event.target as Element).closest('.graph-note-title')) onMove(event); }}>
      <button className="graph-note-title" onClick={onSelect} aria-pressed={selected}>{current.title}</button>
      <button type="button" className="graph-mode-toggle" data-mode-toggle={mode} title={t(mode === 'live' ? 'editor.source' : 'editor.livePreview')} aria-label={t(mode === 'live' ? 'editor.source' : 'editor.livePreview')} onClick={() => setMode(mode === 'live' ? 'raw' : 'live')}>{mode === 'live' ? <Code2 size={14} /> : <Eye size={14} />}</button>
      <button type="button" onClick={onMaximize} aria-label={t('graph.maximize')}>{maximized ? '↙' : '↗'}</button>
      <button type="button" onClick={onCollapse} aria-label={t('graph.collapse')}>−</button>
    </header>
    <button type="button" className="graph-connection-port" disabled={readonly} onPointerDown={onConnect} onClick={() => { setLinking(value => !value); setQuery(''); }} aria-label={t('graph.connect')} title={t('graph.connect')} />
    {linking && <div className="note-link-picker"><input type="search" autoFocus value={query} aria-label={t('graph.findNote')} onChange={event => setQuery(event.target.value)} />
      {noteCandidates(notes, query, note.path).map(target => <button key={target.path} onClick={() => { onLink(target); setLinking(false); }}>{target.title}<small>{target.path}</small></button>)}</div>}
    {entry?.error && <div role="alert" className="graph-editor-error">{entry.error}<button onClick={() => void editing?.store.flush(note.path).catch(() => {})}>{t('graph.retry')}</button><button onClick={() => {
      const a = document.createElement('a'), url = URL.createObjectURL(new Blob([current.content], { type: 'text/markdown' })); a.href = url; a.download = note.path.split('/').pop() || 'draft.md'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    }}>{t('graph.downloadDraft')}</button></div>}
    <MarkdownEditor compact content={current.content} path={note.path} mode={mode} readOnly={Boolean(readonly)} onChange={content => { if (!readonly) editing?.store.edit(note, content); }} onCaret={onCaret} ariaLabel={`${t('graph.editNote')}: ${note.title}`} />
    <footer><span title={note.path}>{note.notebookId} · {note.path.split('/').pop()}</span><span role="status">{t(entry?.saving ? 'editor.saving' : entry?.dirty ? 'graph.pending' : 'graph.saved')}</span></footer>
    {!maximized && <button type="button" className="graph-card-resize" aria-label={t('graph.resize')} onPointerDown={onResize}>◢</button>}
  </article>;
}
