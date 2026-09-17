import { useState } from 'react';
import type { NoteGraphNode } from '@mygitnotes/core/note-graph';
import type { NoteItem } from '../../lib/types.js';
import type { GraphEditing } from '../../lib/use-graph-editing.js';
import { MarkdownEditor, type MarkdownEditorMode } from '../MarkdownEditor.js';
import { Code2, Eye } from 'lucide-react';
import { useTranslation } from '../../lib/i18n/index.js';
import { useNoteCandidates } from '../../lib/note-completion.js';

export function GraphNoteCard({ note, node, editing, onCollapse, onMaximize, onSelect, onMove, onResize, onConnect, onLink, onCaret, selected, maximized, color }: {
  /** Absent until the note's body has been read; the card shows its loading state meanwhile. */
  note?: NoteItem; node: NoteGraphNode; editing?: GraphEditing; selected: boolean; maximized: boolean;
  color: string;
  onCollapse: () => void; onMaximize: () => void; onSelect: (event: React.MouseEvent) => void;
  onMove: (event: React.PointerEvent) => void; onResize: (event: React.PointerEvent) => void;
  onConnect: (event: React.PointerEvent) => void; onLink: (target: { path: string; title: string }) => void; onCaret: (position: number) => void;
}) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<MarkdownEditorMode>('live');
  const [linking, setLinking] = useState(false), [query, setQuery] = useState('');
  const candidates = useNoteCandidates(linking ? query : null, node.id);
  const entry = note ? editing?.store.get(note) : undefined, current = entry?.draft || note;
  const readonly = !note || !editing?.writable || entry?.blocked;
  return <article className={`graph-note-card ${selected ? 'is-selected' : ''}`} style={{ borderColor: color, '--graph-node-color': color } as React.CSSProperties} data-graph-note={node.id} aria-label={node.title}
    onKeyDownCapture={event => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z' && !event.nativeEvent.isComposing) { event.preventDefault(); event.stopPropagation(); if (!readonly && note) editing?.store.undo(note, event.shiftKey); }
    }}>
    <header onPointerDown={event => { if (!(event.target as Element).closest('button,select,[role="combobox"],.editor-mode-switch') || (event.target as Element).closest('.graph-note-title')) onMove(event); }}>
      <button className="graph-note-title" onClick={onSelect} aria-pressed={selected}>{current?.title || node.title}</button>
      <button type="button" className="graph-mode-toggle" data-mode-toggle={mode} title={t(mode === 'live' ? 'editor.source' : 'editor.livePreview')} aria-label={t(mode === 'live' ? 'editor.source' : 'editor.livePreview')} onClick={() => setMode(mode === 'live' ? 'raw' : 'live')}>{mode === 'live' ? <Code2 size={14} /> : <Eye size={14} />}</button>
      <button type="button" onClick={onMaximize} aria-label={t('graph.maximize')}>{maximized ? '↙' : '↗'}</button>
      <button type="button" onClick={onCollapse} aria-label={t('graph.collapse')}>−</button>
    </header>
    <button type="button" className="graph-connection-port" disabled={Boolean(readonly)} onPointerDown={onConnect} onClick={() => { setLinking(value => !value); setQuery(''); }} aria-label={t('graph.connect')} title={t('graph.connect')} />
    {linking && <div className="note-link-picker"><input type="search" autoFocus value={query} aria-label={t('graph.findNote')} onChange={event => setQuery(event.target.value)} />
      {candidates.map(target => <button key={target.path} onClick={() => { onLink({ path: target.path, title: target.title }); setLinking(false); }}>{target.title}<small>{target.path}</small></button>)}</div>}
    {entry?.error && <div role="alert" className="graph-editor-error">{entry.error}<button onClick={() => void editing?.store.flush(node.id).catch(() => {})}>{t('graph.retry')}</button><button onClick={() => {
      const a = document.createElement('a'), url = URL.createObjectURL(new Blob([current?.content || ''], { type: 'text/markdown' })); a.href = url; a.download = node.id.split('/').pop() || 'draft.md'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    }}>{t('graph.downloadDraft')}</button></div>}
    {note && current
      ? <MarkdownEditor compact content={current.content} path={note.path} mode={mode} readOnly={Boolean(readonly)} onChange={content => { if (!readonly) editing?.store.edit(note, content); }} onCaret={onCaret} ariaLabel={`${t('graph.editNote')}: ${note.title}`} />
      : <p role="status" className="graph-note-loading">{t('notes.loadingNote')}</p>}
    <footer><span title={node.id}>{node.notebookId} · {node.id.split('/').pop()}</span><span role="status">{t(entry?.saving ? 'editor.saving' : entry?.dirty ? 'graph.pending' : 'graph.saved')}</span></footer>
    {!maximized && <button type="button" className="graph-card-resize" aria-label={t('graph.resize')} onPointerDown={onResize}>◢</button>}
  </article>;
}
