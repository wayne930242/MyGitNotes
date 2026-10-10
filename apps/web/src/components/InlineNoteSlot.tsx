import { type HTMLAttributes, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent, type PointerEvent, type ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Check, Pencil } from 'lucide-react';
import { noteRefKey } from '@mygitnotes/core/note-query';
import { useCompilationEditingContext } from '../lib/compilation-editing.js';
import { useTranslation } from '../lib/i18n/index.js';
import type { NoteEditorSession } from './note-editor/types.js';
import { Button } from './Button.js';
import { HostedNoteEditor } from './NoteEditorHost.js';

/** Where a click on a note's body is meant for the thing clicked, not for the note: links, controls and embeds. */
const INTERACTIVE = 'a,button,input,select,textarea,summary,label,[role="button"],iframe,video,audio,.note-youtube-embed,.mermaid,[data-mermaid]';
const EDITOR_TARGET = '.cm-content[contenteditable="true"],textarea';

export interface InlineNoteSlotParts {
  /** Edit or Done for the slot's heading; nothing where the note cannot be edited. */
  controls: ReactNode;
  /** The reading view, or the note's editor while the slot edits. */
  body: ReactNode;
  editing: boolean;
  /** The note's title, following the editor's while the slot edits. */
  title: string;
  /** Spread on the element that frames the slot. */
  frameProps: HTMLAttributes<HTMLElement> & { ref: (element: HTMLElement | null) => void; };
}

export interface InlineNoteSlotProps {
  /** The card or section id, unique among the compilation's slots. */
  slot: string;
  notebookId: string;
  path: string;
  title: string;
  /** Whether the note can be edited here: write access, and not a state such as reorder mode that rules editing out. */
  writable: boolean;
  /** `grow`: the editor takes its content's height (a Book section). `fill`: it fills the card's content area and scrolls inside. */
  layout: 'grow' | 'fill';
  /** The note as it reads. */
  reading: ReactNode;
  /** Opens the note in zoom: the title, and a click on the body where editing is not offered. */
  onOpenZoom: () => void;
  children: (parts: InlineNoteSlotParts) => ReactNode;
}

/** The nearest ancestor that scrolls vertically, which keeps a Book section's heading still while its neighbours resize. */
function scroller(from: HTMLElement | null): HTMLElement | null {
  for (let element = from?.parentElement ?? null; element; element = element.parentElement) {
    const overflow = getComputedStyle(element).overflowY;
    if ((overflow === 'auto' || overflow === 'scroll') && element.scrollHeight > element.clientHeight) return element;
  }
  return null;
}

/**
 * A note slot of an open compilation, a Book section or a lane card: the note as it reads, or its editor in place.
 * The editor is the shared hosted editor, so drafts, autosave, conflicts and ownership hand-over are the editor's own;
 * the compilation's editing state keeps one slot editing at a time.
 */
export function InlineNoteSlot({ slot, notebookId, path, title, writable, layout, reading, onOpenZoom, children }: InlineNoteSlotProps) {
  const { t } = useTranslation();
  const { editing: current, start, finish } = useCompilationEditingContext();
  const key = noteRefKey({ notebookId, path });
  const editing = current?.slot === slot;
  const [session, setSession] = useState<NoteEditorSession | null>(null);
  const [frame, setFrame] = useState<HTMLElement | null>(null);
  const [toggle, setToggle] = useState<HTMLButtonElement | null>(null);
  const pointer = useRef('');
  const top = useRef<number | null>(null);
  const refocus = useRef(false);
  const shown = editing ? session?.title || title : title;

  const begin = async () => {
    top.current = frame?.getBoundingClientRect().top ?? null;
    if (!await start({ slot, key })) top.current = null;
  };
  const end = async () => {
    refocus.current = true;
    if (!await finish()) refocus.current = false;
  };

  // Entering edit mode keeps the heading where it was on screen, even when the section just left shrank above it.
  useLayoutEffect(() => {
    if (!editing || top.current === null) return;
    const delta = (frame?.getBoundingClientRect().top ?? top.current) - top.current;
    top.current = null;
    const parent = scroller(frame);
    if (parent && delta) parent.scrollTop += delta;
  }, [editing, frame]);

  // Back to reading after Done or Escape, focus sits on the slot's Edit button.
  useEffect(() => {
    if (editing || !refocus.current) return;
    refocus.current = false;
    toggle?.focus();
  }, [editing, toggle]);

  // The editor mounts once its note has loaded and, after a hand-over, been claimed; focus it at the start of the body then.
  useEffect(() => {
    const root = frame;
    if (!editing || !root) return;
    const focusStart = () => {
      const target = root.querySelector<HTMLElement>(EDITOR_TARGET);
      if (!target) return false;
      if (!target.contains(document.activeElement)) target.focus({ preventScroll: true });
      if (target instanceof HTMLTextAreaElement) target.setSelectionRange(0, 0);
      return true;
    };
    if (focusStart()) return;
    const observer = new MutationObserver(() => {
      if (focusStart()) observer.disconnect();
    });
    observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['contenteditable'] });
    return () => observer.disconnect();
  }, [editing, frame]);

  // In source mode the note is a textarea, which does not grow with its text; a Book section sizes it to its lines so the book scrolls as one document.
  useEffect(() => {
    const root = frame;
    if (!editing || layout !== 'grow' || !root) return;
    const fit = (area: HTMLTextAreaElement) => {
      area.style.height = 'auto';
      area.style.height = `${area.scrollHeight}px`;
    };
    const fitAll = () => root.querySelectorAll('textarea').forEach(fit);
    const onInput = (event: Event) => {
      if (event.target instanceof HTMLTextAreaElement) fit(event.target);
    };
    fitAll();
    root.addEventListener('input', onInput);
    // Switching to source mode adds the textarea; a change of note content from outside the editor changes its lines.
    const observer = new MutationObserver(fitAll);
    observer.observe(root, { childList: true, subtree: true, characterData: true });
    return () => {
      root.removeEventListener('input', onInput);
      observer.disconnect();
    };
  }, [editing, layout, frame]);

  const onBodyClick = (event: MouseEvent<HTMLElement>) => {
    if ((event.target as HTMLElement).closest(INTERACTIVE) || window.getSelection()?.toString()) return;
    const device = (event.nativeEvent as { pointerType?: string; }).pointerType || pointer.current;
    if (writable && (device === 'mouse' || device === 'pen')) void begin();
    else onOpenZoom();
  };
  const onKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Escape' || event.defaultPrevented || event.nativeEvent.isComposing) return;
    // Nothing inside the editor wanted this Escape (selection, completion, a panel): it leaves the slot, and no further.
    event.preventDefault();
    event.stopPropagation();
    void end();
  };

  const label = t(editing ? 'compilation.finishNote' : 'compilation.editNote', { title: shown });
  const controls = writable || editing
    ? (
      <Button ref={setToggle} size='small' variant={editing ? 'primary' : 'default'} className='compilation-edit-toggle' aria-label={label} title={label} onClick={() => void (editing ? end() : begin())}>
        {editing ? <Check aria-hidden='true' /> : <Pencil aria-hidden='true' />}
        <span>{t(editing ? 'editor.finishEditing' : 'editor.startEditing')}</span>
      </Button>
    )
    : null;
  const body = editing
    ? (
      <div className='compilation-inline-editor' role='group' aria-label={shown} data-layout={layout}>
        <HostedNoteEditor notebookId={notebookId} path={path} frame='compact' active={false} claim onSession={setSession} />
      </div>
    )
    : <div className='compilation-inline-reading' onPointerDown={(event: PointerEvent<HTMLElement>) => void (pointer.current = event.pointerType)} onClick={onBodyClick}>{reading}</div>;
  /* eslint-disable react/refs -- The render prop receives handlers that read refs only when an event runs, never while rendering. */
  return children({ controls, body, editing, title: shown, frameProps: { ref: setFrame, ...(editing ? { 'data-editing': '', 'data-key-scope': 'compilation-edit', 'onKeyDown': onKeyDown } : {}) } as InlineNoteSlotParts['frameProps'] });
  /* eslint-enable react/refs */
}
