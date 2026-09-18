import { useState } from 'react';
import type { NoteGraphNode } from '@mygitnotes/core/note-graph';
import { useTranslation } from '../../lib/i18n/index.js';
import { useNoteCandidates } from '../../lib/note-completion.js';
import { HostedNoteEditor } from '../NoteEditorHost.js';
import type { NoteEditorHandle, NoteEditorSession } from '../NoteEditor.js';

export function GraphNoteCard({ node, session, editorRef, onSession, onCollapse, onMaximize, onSelect, onMove, onResize, onConnect, onLink, onCaret, selected, maximized, color }: {
  node: NoteGraphNode; selected: boolean; maximized: boolean;
  color: string;
  /** The card's editing session while this card owns the note's editor. */
  session?: NoteEditorSession; editorRef: React.Ref<NoteEditorHandle>; onSession: (session: NoteEditorSession | null) => void;
  onCollapse: () => void; onMaximize: () => void; onSelect: (event: React.MouseEvent) => void;
  onMove: (event: React.PointerEvent) => void; onResize: (event: React.PointerEvent) => void;
  onConnect: (event: React.PointerEvent) => void; onLink: (target: { path: string; title: string }) => void; onCaret: (position: number) => void;
}) {
  const { t } = useTranslation();
  const [linking, setLinking] = useState(false), [query, setQuery] = useState('');
  const candidates = useNoteCandidates(linking ? query : null, node.id);
  return <article className={`graph-note-card ${selected ? 'is-selected' : ''}`} style={{ borderColor: color, '--graph-node-color': color } as React.CSSProperties} data-graph-note={node.id} aria-label={node.title}>
    <header onPointerDown={event => { if (!(event.target as Element).closest('button,select,[role="combobox"],.editor-mode-switch') || (event.target as Element).closest('.graph-note-title')) onMove(event); }}>
      <button className="graph-note-title" onClick={onSelect} aria-pressed={selected}>{session?.title || node.title}</button>
      <button type="button" onClick={onMaximize} aria-label={t('graph.maximize')}>{maximized ? '↙' : '↗'}</button>
      <button type="button" onClick={onCollapse} aria-label={t('graph.collapse')}>−</button>
    </header>
    <button type="button" className="graph-connection-port" disabled={!session || session.locked} onPointerDown={onConnect} onClick={() => { setLinking(value => !value); setQuery(''); }} aria-label={t('graph.connect')} title={t('graph.connect')} />
    {linking && <div className="note-link-picker"><input type="search" autoFocus value={query} aria-label={t('graph.findNote')} onChange={event => setQuery(event.target.value)} />
      {candidates.map(target => <button key={target.path} onClick={() => { onLink({ path: target.path, title: target.title }); setLinking(false); }}>{target.title}<small>{target.path}</small></button>)}</div>}
    <HostedNoteEditor path={node.id} frame="compact" active={false} editorRef={editorRef} onSession={onSession} onCaret={onCaret} />
    {!maximized && <button type="button" className="graph-card-resize" aria-label={t('graph.resize')} onPointerDown={onResize}>◢</button>}
  </article>;
}
