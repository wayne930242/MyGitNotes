import { LiveMarkdownTable, tableUIState } from './LiveMarkdownTable.js';
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { Compartment, EditorState, StateEffect, StateField, Transaction, type Range } from '@codemirror/state';
import { Decoration, EditorView, WidgetType, keymap, drawSelection, highlightActiveLineGutter, lineNumbers, type DecorationSet } from '@codemirror/view';
import { autocompletion, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { defaultHighlightStyle, HighlightStyle, syntaxHighlighting, syntaxTree } from '@codemirror/language';
import { tags } from '@lezer/highlight';
import { marked } from 'marked';
import { parseYouTubeUrl } from '@mygitnotes/core/screen-page';
import { renderNote } from '../lib/markdown.js';
import { headingSlug, resolveWorkspaceHref } from '../lib/workspace-links.js';
import { useLocation } from 'react-router-dom';
import { useTranslation, type I18nContextValue } from '../lib/i18n/index.js';
import { getAtCompletionItems } from '../lib/at-completion.js';
import { noteCompletionAt, noteCandidates } from '../lib/note-completion.js';
import { noteLinkHref } from '@mygitnotes/core/workspace-links';
import type { NoteItem } from '../lib/types.js';
import { formatDateYMD } from '../lib/date-utils.js';
import { DONE_EMOJI, DUE_EMOJI, TIMESTAMP_EMOJI, findToken, isTaskLine, setTaskChecked, setTokenValue } from '../lib/task-tokens.js';

export interface LiveMarkdownHandle {
  insert: (text: string) => void;
  revealRange: (from: number, to: number, focus?: boolean) => void;
  goToLine: (line: number, options?: { focus?: boolean; smooth?: boolean }) => void;
  getCurrentLine: () => number;
}
interface Props { content: string; notePath: string; readOnly: boolean; ariaLabel?: string; onChange: (content: string) => void; noteOptions?: NoteItem[]; onCaret?: (position: number) => void }
const focusChanged = StateEffect.define<boolean>();
function externalLinkIcon(href: string, label: string, sourcePath: string): HTMLAnchorElement {
  const anchor = document.createElement('a');
  anchor.className = 'live-md-external-link'; anchor.href = href; anchor.target = '_blank'; anchor.rel = 'noopener noreferrer';
  anchor.title = label; anchor.setAttribute('aria-label', `${label}: ${href}`);
  anchor.dataset.workspaceLink = href; anchor.dataset.sourcePath = sourcePath;
  anchor.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 3h6v6M10 14 21 3M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/></svg>';
  return anchor;
}
class ExternalLink extends WidgetType {
  constructor(readonly href: string, readonly label: string, readonly path: string) { super(); }
  eq(other: ExternalLink) { return this.href === other.href && this.label === other.label && this.path === other.path; }
  toDOM() { return externalLinkIcon(this.href, this.label, this.path); }
}
class RenderedMarkdown extends WidgetType {
  constructor(readonly text: string, readonly path: string, readonly from: number, readonly block: boolean, readonly linkLabel: string, readonly tableLabel: string) { super(); }
  eq(other: RenderedMarkdown) { return this.text === other.text && this.path === other.path && this.from === other.from && this.linkLabel === other.linkLabel && this.tableLabel === other.tableLabel; }
  toDOM(view: EditorView) {
    const dom = document.createElement(this.block ? 'div' : 'span'); dom.className = 'live-md-rendered prose-custom';
    if (this.block) { dom.style.display = 'block'; dom.style.width = '100%'; }
    dom.innerHTML = renderNote(this.text, this.path, this.tableLabel);
    dom.setAttribute('aria-label', 'Rendered Markdown; click to edit');
    dom.addEventListener('mousedown', event => {
      if ((event.target as HTMLElement).closest('a, [data-workspace-link]')) return;
      if ((event.target as HTMLElement).matches('.markdown-table-scroll')) return;
      event.preventDefault(); view.dispatch({selection:{anchor:this.from}}); view.focus();
    });
    for (const image of dom.querySelectorAll('img')) image.addEventListener('load', () => view.requestMeasure());
    return dom;
  }
  get estimatedHeight() { return this.block ? 100 : 160; }
}
class PageBreak extends WidgetType {
  constructor(readonly from: number, readonly label: string) { super(); }
  eq(other: PageBreak) { return this.from === other.from && this.label === other.label; }
  toDOM(view: EditorView) {
    const dom = document.createElement('div'); dom.className = 'live-md-page-break';
    dom.dataset.pageBreak = ''; dom.textContent = this.label;
    dom.addEventListener('mousedown', event => { event.preventDefault(); view.dispatch({ selection: { anchor: this.from } }); view.focus(); });
    return dom;
  }
  get estimatedHeight() { return 64; }
}
class TaskCheckbox extends WidgetType {
  constructor(readonly checked: boolean, readonly from: number, readonly readonly: boolean) { super(); }
  eq(other: TaskCheckbox) { return this.checked === other.checked && this.from === other.from && this.readonly === other.readonly; }
  toDOM(view: EditorView) {
    const input = document.createElement('input'); input.type = 'checkbox'; input.checked = this.checked; input.disabled = this.readonly;
    input.setAttribute('aria-label', 'Toggle task');
    input.addEventListener('change', () => {
      if (view.state.readOnly) return;
      const line = view.state.doc.lineAt(this.from);
      const newLine = setTaskChecked(line.text, input.checked, formatDateYMD(new Date()));
      view.dispatch({ changes: { from: line.from, to: line.to, insert: newLine }, userEvent: 'input' });
    });
    return input;
  }
}
const chipEditChanged = StateEffect.define<{ pos: number; editing: boolean }>();
const chipEditState = StateField.define<Set<number>>({
  create: () => new Set(),
  update(value, transaction) {
    const next = new Set([...value].map(pos => transaction.changes.mapPos(pos, -1)));
    for (const effect of transaction.effects) if (effect.is(chipEditChanged)) {
      if (effect.value.editing) next.add(effect.value.pos); else next.delete(effect.value.pos);
    }
    return next;
  },
});
class TokenChip extends WidgetType {
  constructor(readonly emoji: string, readonly value: string, readonly posKey: number, readonly readonly: boolean) { super(); }
  eq(other: TokenChip) { return this.emoji === other.emoji && this.value === other.value && this.posKey === other.posKey && this.readonly === other.readonly; }
  toDOM(view: EditorView) {
    const span = document.createElement('span'); span.className = 'live-md-token-chip'; span.textContent = `${this.emoji} ${this.value}`;
    if (!this.readonly) {
      span.setAttribute('role', 'button'); span.tabIndex = 0; span.title = 'Click to change or clear this date';
      const open = (event: Event) => {
        event.preventDefault(); event.stopPropagation();
        view.dispatch({ effects: chipEditChanged.of({ pos: this.posKey, editing: true }) });
      };
      span.addEventListener('mousedown', event => event.preventDefault());
      span.addEventListener('click', open);
      span.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') open(event); });
    }
    return span;
  }
}
class TokenEditor extends WidgetType {
  constructor(readonly emoji: string, readonly withTime: boolean, readonly value: string | undefined, readonly lineFrom: number, readonly lineTo: number, readonly posKey: number) { super(); }
  eq(other: TokenEditor) { return this.emoji === other.emoji && this.value === other.value && this.lineFrom === other.lineFrom && this.posKey === other.posKey; }
  toDOM(view: EditorView) {
    const wrap = document.createElement('span'); wrap.className = 'live-md-token-editor';
    const input = document.createElement('input'); input.className = 'ui-control'; input.type = this.withTime ? 'datetime-local' : 'date';
    if (this.value) input.value = this.withTime ? this.value.replace(' ', 'T') : this.value;
    /** `undefined` cancels with no change; `null` clears the token; a string sets its value. */
    const close = (newValue: string | null | undefined) => {
      const line = view.state.doc.lineAt(this.lineFrom);
      const effects = chipEditChanged.of({ pos: this.posKey, editing: false });
      if (newValue === undefined) {
        view.dispatch({ effects });
      } else {
        const newLine = setTokenValue(line.text, this.emoji, newValue, this.withTime);
        view.dispatch({ changes: { from: line.from, to: line.to, insert: newLine }, effects, userEvent: 'input' });
      }
      view.focus();
    };
    input.addEventListener('change', () => close(input.value ? (this.withTime ? input.value.replace('T', ' ') : input.value) : null));
    input.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); close(undefined); } });
    const clear = document.createElement('button'); clear.type = 'button'; clear.className = 'live-md-token-clear'; clear.setAttribute('aria-label', 'Clear date'); clear.textContent = '×';
    clear.addEventListener('mousedown', event => event.preventDefault());
    clear.addEventListener('click', () => close(null));
    wrap.appendChild(input); wrap.appendChild(clear);
    requestAnimationFrame(() => input.focus());
    return wrap;
  }
}
class DueDateAdder extends WidgetType {
  constructor(readonly posKey: number) { super(); }
  eq(other: DueDateAdder) { return this.posKey === other.posKey; }
  toDOM(view: EditorView) {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'live-md-due-adder'; button.textContent = `+${DUE_EMOJI}`;
    button.title = 'Add a due date'; button.setAttribute('aria-label', 'Add a due date');
    button.addEventListener('mousedown', event => event.preventDefault());
    button.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); view.dispatch({ effects: chipEditChanged.of({ pos: this.posKey, editing: true }) }); });
    return button;
  }
}
function atCompletionSource(context: CompletionContext): CompletionResult | null {
  const match = context.matchBefore(/@\w*/);
  if (!match || (match.from === match.to && !context.explicit)) return null;
  const onTaskLine = isTaskLine(context.state.doc.lineAt(match.from).text);
  return {
    from: match.from,
    to: match.to,
    options: getAtCompletionItems({ onTaskLine, now: new Date() }).map(item => ({
      label: item.label,
      apply: item.insertText !== undefined ? item.insertText : (view: EditorView, _completion: unknown, from: number, to: number) => {
        const newLineTo = view.state.doc.lineAt(from).to - (to - from);
        view.dispatch({ changes: { from, to, insert: '' }, effects: chipEditChanged.of({ pos: newLineTo, editing: true }) });
      },
    })),
  };
}
class BulletMarker extends WidgetType {
  eq() { return true; }
  toDOM() { const span=document.createElement('span');span.textContent='•';span.setAttribute('aria-hidden','true');return span; }
}
class YouTubeWidget extends WidgetType {
  constructor(readonly videoId: string, readonly start: number, readonly from: number) { super(); }
  eq(other: YouTubeWidget) { return this.videoId === other.videoId && this.start === other.start && this.from === other.from; }
  toDOM(view: EditorView) {
    const container = document.createElement('div');
    container.className = 'note-youtube-embed';
    container.dataset.videoId = this.videoId;
    container.dataset.start = String(this.start);

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'note-youtube-poster';
    button.setAttribute('aria-label', 'Play YouTube video');

    const img = document.createElement('img');
    img.src = `https://img.youtube.com/vi/${encodeURIComponent(this.videoId)}/hqdefault.jpg`;
    img.alt = '';
    img.loading = 'lazy';
    img.addEventListener('load', () => view.requestMeasure());

    const playBtn = document.createElement('span');
    playBtn.className = 'note-youtube-play-btn';
    playBtn.setAttribute('aria-hidden', 'true');
    playBtn.innerHTML = '<svg width="48" height="48" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';

    button.appendChild(img);
    button.appendChild(playBtn);
    container.appendChild(button);

    const activate = () => {
      const iframe = document.createElement('iframe');
      iframe.title = 'YouTube video player';
      iframe.src = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(this.videoId)}?start=${this.start}&autoplay=1&playsinline=1&rel=0`;
      iframe.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';
      iframe.allowFullscreen = true;
      iframe.className = 'note-youtube-iframe';
      container.replaceChildren(iframe);
      view.requestMeasure();
    };

    button.addEventListener('mousedown', event => { event.stopPropagation(); });
    button.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      activate();
    });

    container.addEventListener('mousedown', event => {
      if ((event.target as HTMLElement).closest('.note-youtube-poster, iframe')) return;
      event.preventDefault();
      view.dispatch({ selection: { anchor: this.from } });
      view.focus();
    });

    return container;
  }
  get estimatedHeight() { return 280; }
}
function liveDecorations(state: EditorState, focused: boolean, notePath: string, linkLabel: string, tableLabel: string, pageLabel: string, t: I18nContextValue['t']): DecorationSet {
  const marks: Range<Decoration>[] = [];
  let pageNumber = 1;
  const references = marked.lexer(state.doc.toString()).links;
  const active = (from: number, to: number) => focused && !state.readOnly && state.selection.ranges.some(range => state.doc.lineAt(range.from).from <= to && state.doc.lineAt(range.to).to >= from);
  const hide = (from: number, to: number) => { if (from < to) marks.push(Decoration.replace({}).range(from,to)); };
  const link = (from: number, to: number, href: string) => {
    if (!resolveWorkspaceHref(href, notePath)) return;
    marks.push(Decoration.mark({attributes:{'data-workspace-link':href,'data-source-path':notePath,role:'link',tabindex:'0',title:linkLabel}}).range(from,to));
    marks.push(Decoration.widget({widget:new ExternalLink(href,linkLabel,notePath),side:1}).range(to));
  };
  syntaxTree(state).iterate({ enter(node) {
    const {from,to,name} = node; const editing = active(from,to);
    if (/^(ATXHeading|SetextHeading)[1-6]$/.test(name)) marks.push(Decoration.line({class:`live-md-heading live-md-h${name.at(-1)}`,attributes:{'data-heading-slug':headingSlug(state.sliceDoc(from,to).split('\n')[0])}}).range(state.doc.lineAt(from).from));
    if (name === 'Blockquote') for(let line = state.doc.lineAt(from); line.from < to; line = state.doc.line(line.number+1)) {
      marks.push(Decoration.line({class:'live-md-quote'}).range(line.from)); if(line.number === state.doc.lines)break;
    }
    if (name === 'FencedCode' || name === 'CodeBlock') for(let line = state.doc.lineAt(from); line.from < to; line = state.doc.line(line.number+1)) {
      marks.push(Decoration.line({class:'live-md-codeblock'}).range(line.from)); if(line.number === state.doc.lines)break;
    }
    const styles: Record<string,string> = {StrongEmphasis:'live-md-strong',Emphasis:'live-md-emphasis',Strikethrough:'live-md-strike',InlineCode:'live-md-code',Link:'live-md-link'};
    if (styles[name] && from < to) marks.push(Decoration.mark({class:styles[name]}).range(from,to));
    if (name === 'HorizontalRule' && node.node.parent?.name === 'Document' && state.sliceDoc(from, to).trim() === '---') {
      pageNumber++;
      if (editing) marks.push(Decoration.line({ class: 'live-md-page-divider', attributes: { 'data-page-break': '' } }).range(state.doc.lineAt(from).from));
      else marks.push(Decoration.replace({ widget: new PageBreak(from, `${pageLabel} ${pageNumber}`), block: true }).range(from, to));
      return false;
    }
    if (name === 'Paragraph' && node.node.parent?.name !== 'ListItem') {
      const text = state.sliceDoc(from, to).trim();
      const match = text.match(/^\[([^\]]*)\]\(([^)]+)\)$/);
      const url = match ? match[2].trim() : text.replace(/^<|>$/g, '');
      const video = parseYouTubeUrl(url);
      if (video) {
        if (!editing) {
          marks.push(Decoration.replace({ widget: new YouTubeWidget(video.videoId, video.start, from), block: true }).range(from, to));
          return false;
        }
      }
    }
    if (name === 'Table' && node.node.parent?.name === 'Document') {
      marks.push(Decoration.replace({ widget: new LiveMarkdownTable(state.sliceDoc(from, to), notePath, from, state.readOnly, t, state.field(tableUIState).get(from)), block: true }).range(from, to));
      return false;
    }
    if (!editing && (name === 'Image' || name === 'Table' || name === 'HorizontalRule')) {
      marks.push(Decoration.replace({widget:new RenderedMarkdown(state.sliceDoc(from,to),notePath,from,name !== 'Image',linkLabel,tableLabel),block:name !== 'Image'}).range(from,to)); return false;
    }
    if (!editing && name === 'TaskMarker') { marks.push(Decoration.replace({widget:new TaskCheckbox(state.sliceDoc(from,to).toLowerCase()==='[x]',from,state.readOnly)}).range(from,to)); return false; }
    if (!editing && name === 'ListMark' && node.node.parent?.parent?.name === 'BulletList') {
      if (node.node.parent.getChild('Task')) hide(from,to+1);
      else marks.push(Decoration.replace({widget:new BulletMarker()}).range(from,to));
    }
    // Bare URLs and angle-bracket autolinks have URL nodes without a Link parent.
    if (name === 'URL' && !['Link','Image','LinkReference'].includes(node.node.parent?.name ?? '')) link(from,to,state.sliceDoc(from,to));
    if (name === 'Link') {
      const url = node.node.getChild('URL');
      if (url) {
        const href = state.sliceDoc(url.from,url.to).replace(/^<|>$/g,'');
        link(from,to,href);
        const source = state.sliceDoc(from,to); const start = source.indexOf('[')+1; const end = source.indexOf('](',start);
        if (!editing && end >= start) { hide(from,from+start); hide(from+end,to); return false; }
      } else {
        const source = state.sliceDoc(from, to);
        const reference = source.match(/^\[([^\]]+)\](?:\[([^\]]*)\])?$/);
        const target = reference && references[(reference[2] || reference[1]).replace(/\s+/g, ' ').toLowerCase()];
        if (target) {
          link(from, to, target.href);
          if (!editing) { hide(from, from + 1); hide(from + 1 + reference![1].length, to); return false; }
        }
      }
    }
    if (!editing && /^(HeaderMark|EmphasisMark|StrikethroughMark|CodeMark|QuoteMark)$/.test(name)) {
      // Keep fenced code delimiters visible so language and boundaries remain editable.
      if (name === 'CodeMark' && node.node.parent?.name === 'FencedCode') return;
      let end = to; if ((name === 'HeaderMark' || name === 'QuoteMark') && state.sliceDoc(to,to+1)===' ')end++;
      hide(from,end);
    }
  }});
  const editingChips = state.field(chipEditState);
  const TOKENS: [string, boolean][] = [[DUE_EMOJI, false], [DONE_EMOJI, false], [TIMESTAMP_EMOJI, true]];
  for (let lineNumber = 1; lineNumber <= state.doc.lines; lineNumber++) {
    const line = state.doc.line(lineNumber);
    for (const [emoji, withTime] of TOKENS) {
      const token = findToken(line.text, emoji, withTime);
      if (!token) continue;
      const from = line.from + token.start, to = line.from + token.end;
      if (editingChips.has(from)) marks.push(Decoration.replace({ widget: new TokenEditor(emoji, withTime, token.value, line.from, line.to, from), side: 1 }).range(from, to));
      else marks.push(Decoration.replace({ widget: new TokenChip(emoji, token.value, from, state.readOnly) }).range(from, to));
    }
    if (!state.readOnly && isTaskLine(line.text) && !findToken(line.text, DUE_EMOJI)) {
      if (editingChips.has(line.to)) marks.push(Decoration.widget({ widget: new TokenEditor(DUE_EMOJI, false, undefined, line.from, line.to, line.to), side: 2 }).range(line.to));
      else marks.push(Decoration.widget({ widget: new DueDateAdder(line.to), side: 2 }).range(line.to));
    }
  }
  return Decoration.set(marks,true);
}
const theme = EditorView.theme({
  '&':{height:'100%',color:'var(--color-text)',backgroundColor:'transparent'},
  '&.cm-focused':{outline:'none'}, '.cm-scroller':{overflow:'auto',fontFamily:'inherit',lineHeight:'1.8'},
  '.cm-content':{padding:'28px 36px',maxWidth:'900px',margin:'0 auto',minHeight:'100%',width:'100%',caretColor:'var(--color-primary)'},
  '.cm-line':{padding:'0 2px'}, '.cm-cursor':{borderLeftColor:'var(--color-primary)'},
  '.cm-gutters':{backgroundColor:'transparent',borderRight:'1px solid var(--color-border)'},
  '.cm-lineNumbers':{color:'var(--color-muted)',fontFamily:'monospace',fontSize:'11px',opacity:'0.55'},
  '.cm-lineNumbers .cm-gutterElement':{paddingLeft:'8px',paddingRight:'10px',transformOrigin:'right center',transition:'color 150ms, transform 150ms, font-weight 150ms'},
  '.cm-lineNumbers .cm-activeLineGutter':{color:'var(--color-primary)',fontWeight:'700',transform:'scale(1.08)'},
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground':{backgroundColor:'var(--color-primary-light)'},
  '.live-md-heading':{fontWeight:'700',lineHeight:'1.4',paddingTop:'12px',paddingBottom:'8px'},
  '.live-md-heading span':{textDecoration:'none'},
  '.live-md-h1':{fontSize:'1.85em'},'.live-md-h2':{fontSize:'1.5em'},'.live-md-h3':{fontSize:'1.25em'},
  '.live-md-strong':{fontWeight:'700'},'.live-md-emphasis':{fontStyle:'italic'},'.live-md-strike':{textDecoration:'line-through'},
  '.live-md-link, .live-md-link span, .live-md-url':{color:'var(--color-link)',textDecoration:'underline'},
  '.live-md-code':{fontFamily:'monospace',backgroundColor:'var(--color-sidebar)',borderRadius:'4px'},
  '.live-md-codeblock':{fontFamily:'monospace',backgroundColor:'var(--color-sidebar)',paddingLeft:'14px'},
  '.live-md-quote':{borderLeft:'3px solid var(--color-primary)',paddingLeft:'14px',color:'var(--color-muted)'},
  '.live-md-rendered':{display:'inline-block',maxWidth:'100%',cursor:'text'},
  '.live-md-rendered p':{margin:'0'},'.live-md-rendered img':{maxWidth:'100%',maxHeight:'360px',borderRadius:'8px'},
  '.cm-content input[type=checkbox]':{accentColor:'var(--color-primary)',verticalAlign:'middle',marginRight:'4px'},
  '.live-md-token-chip':{display:'inline-flex',alignItems:'center',padding:'0 6px',borderRadius:'999px',fontSize:'0.85em',cursor:'pointer',backgroundColor:'var(--color-sidebar)',color:'var(--color-muted)',border:'1px solid var(--color-border)'},
  '.live-md-token-editor':{display:'inline-flex',alignItems:'center',gap:'4px'},
  '.live-md-token-editor input':{fontSize:'0.85em',padding:'1px 4px'},
  '.live-md-token-clear':{cursor:'pointer',color:'var(--color-muted)',fontWeight:'700',lineHeight:'1',border:'none',background:'none',padding:'0 2px'},
  '.live-md-due-adder':{display:'inline-flex',alignItems:'center',marginLeft:'6px',padding:'0 6px',borderRadius:'999px',fontSize:'0.8em',cursor:'pointer',color:'var(--color-muted)',border:'1px dashed var(--color-border)',background:'none'},
});
export const LiveMarkdownEditor = forwardRef<LiveMarkdownHandle,Props>(({content,notePath,readOnly,onChange,noteOptions = [],onCaret,ariaLabel = 'Note content'},ref) => {
  const { t } = useTranslation(); const linkLabel = t('links.open');
  const tableLabel = t('preview.scrollableTable'), pageLabel = t('editor.page');
  const location = useLocation();
  const host = useRef<HTMLDivElement>(null); const editor = useRef<EditorView>();
  const callback = useRef(onChange); callback.current = onChange;
  const completionNotes = useRef(noteOptions); completionNotes.current = noteOptions;
  const caretCallback = useRef(onCaret); caretCallback.current = onCaret;
  const permission = useRef(new Compartment());
  useImperativeHandle(ref, () => ({
    insert(text) {const view=editor.current;if(!view||view.state.readOnly)return;view.dispatch(view.state.replaceSelection(text),{scrollIntoView:true,userEvent:'input'});view.focus();},
    revealRange(from, to, focus = false) {
      const view = editor.current; if (!view) return;
      const start = Math.max(0, Math.min(from, view.state.doc.length));
      const end = Math.max(start, Math.min(to, view.state.doc.length));
      view.dispatch({ selection: { anchor: start, head: end }, effects: EditorView.scrollIntoView(start, { y: 'center' }) });
      if (focus) view.focus();
    },
    goToLine(line, options = {}) {
      const view = editor.current; if (!view) return;
      const target = view.state.doc.line(Math.max(1, Math.min(line, view.state.doc.lines))).from;
      view.dispatch({ selection: { anchor: target } });
      if (options.smooth) requestAnimationFrame(() => view.scrollDOM.scrollTo({ top: Math.max(0, view.lineBlockAt(target).top - 20), behavior: 'smooth' }));
      else view.dispatch({ effects: EditorView.scrollIntoView(target, { y: 'start', yMargin: 20 }) });
      if (options.focus !== false) view.focus();
    },
    getCurrentLine() {
      const view = editor.current;
      if (!view) return 1;
      const atEnd = view.scrollDOM.scrollTop + view.scrollDOM.clientHeight >= view.scrollDOM.scrollHeight - 2;
      return atEnd ? view.state.doc.lines : view.state.doc.lineAt(view.viewport.from).number;
    },
  }),[]);
  useEffect(() => {
    const field = StateField.define<{decorations:DecorationSet;focused:boolean}>({
      create(state) {return {decorations:liveDecorations(state,false,notePath,linkLabel,tableLabel,pageLabel,t),focused:false};},
      update(value,tr) {
        let focused=value.focused;for(const effect of tr.effects)if(effect.is(focusChanged))focused=effect.value;
        return {focused,decorations:liveDecorations(tr.state,focused,notePath,linkLabel,tableLabel,pageLabel,t)};
      },
      provide: field => EditorView.decorations.from(field,value=>value.decorations),
    });
    const view = new EditorView({parent:host.current!,state:EditorState.create({doc:content,extensions:[
      markdown({base:markdownLanguage}),history(),keymap.of([...defaultKeymap,...historyKeymap]),drawSelection(),lineNumbers(),highlightActiveLineGutter(),EditorView.lineWrapping,
      syntaxHighlighting(defaultHighlightStyle),syntaxHighlighting(HighlightStyle.define([{tag:tags.url,class:'live-md-url'}])),theme,tableUIState,chipEditState,field,
      autocompletion({ override: [atCompletionSource, context => {
        const text = context.state.doc.toString(), match = noteCompletionAt(text, context.pos);
        if (!match || context.state.readOnly) return null;
        return { from: match.from, to: match.to, filter: false, options: noteCandidates(completionNotes.current, match.query, notePath).map(note => ({
          label: note.title, detail: `${note.notebookId} · ${note.path}`,
          apply: noteLinkHref(notePath, note.path) + (text[context.pos] === ')' ? '' : ')'),
        })) };
      }] }),
      EditorView.atomicRanges.of(view => view.state.field(field).decorations.update({ filter: (_from, _to, decoration) => decoration.spec.widget instanceof LiveMarkdownTable })),
      permission.current.of([EditorState.readOnly.of(readOnly),EditorView.editable.of(!readOnly)]),
      EditorView.contentAttributes.of({'aria-label':ariaLabel,'role':'textbox','aria-multiline':'true'}),
      EditorView.domEventHandlers({focus:(_event,view)=>{view.dispatch({effects:focusChanged.of(true)});},blur:(_event,view)=>{view.dispatch({effects:focusChanged.of(false)});}}),
      EditorView.updateListener.of(update=>{if(update.docChanged)callback.current(update.state.doc.toString()); if ((update.selectionSet || update.docChanged || update.focusChanged) && update.view.hasFocus) caretCallback.current?.(update.state.selection.main.head);}),
    ]})});
    editor.current=view;return()=>{view.destroy();editor.current=undefined;};
  },[notePath,ariaLabel,linkLabel,tableLabel,pageLabel,t]);
  useEffect(()=>{const view=editor.current;if(view && view.state.doc.toString()!==content)view.dispatch({changes:{from:0,to:view.state.doc.length,insert:content},annotations:Transaction.addToHistory.of(false)});},[content]);
  useEffect(()=>{editor.current?.dispatch({effects:permission.current.reconfigure([EditorState.readOnly.of(readOnly),EditorView.editable.of(!readOnly)])});},[readOnly]);
  useEffect(() => {
    if (!location.hash) return;
    let anchor: string;
    try { anchor = headingSlug(decodeURIComponent(location.hash.slice(1))); } catch { return; }
    const frame = requestAnimationFrame(() => {
      const heading = [...(host.current?.querySelectorAll<HTMLElement>('[data-heading-slug]') || [])].find(node => node.dataset.headingSlug === anchor);
      heading?.scrollIntoView({ block: 'start' });
    });
    return () => cancelAnimationFrame(frame);
  }, [location.hash, notePath, content]);
  return <div ref={host} className="flex-1 min-h-0 min-w-0 overflow-hidden" data-live-markdown />;
});
