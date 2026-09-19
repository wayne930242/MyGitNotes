import { LiveMarkdownTable, tableUIState } from './LiveMarkdownTable.js';
import { LiveMarkdownDirective } from './LiveMarkdownDirective.js';
import { findDirectiveBlocks, escapeHtml } from '../lib/directives.js';
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { Compartment, EditorState, StateEffect, StateField, Transaction, type Range } from '@codemirror/state';
import { Decoration, EditorView, WidgetType, keymap, drawSelection, highlightActiveLineGutter, lineNumbers, layer, RectangleMarker, type DecorationSet } from '@codemirror/view';
import { autocompletion, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { HighlightStyle, syntaxHighlighting, syntaxTree } from '@codemirror/language';
import { codeMirrorTokenTheme, tokenHighlightStyle } from '../lib/codemirror-theme.js';
import { tags } from '@lezer/highlight';
import { marked } from 'marked';
import { parseYouTubeUrl } from '@mygitnotes/core/screen-page';
import { renderNote } from '../lib/markdown.js';
import { headingSlug, resolveWorkspaceHref } from '../lib/workspace-links.js';
import { useLocation } from 'react-router-dom';
import { useTranslation, type I18nContextValue } from '../lib/i18n/index.js';
import { getAtCompletionItems } from '../lib/at-completion.js';
import { useQueryClient } from '@tanstack/react-query';
import { noteCompletionAt, fetchNoteCandidates } from '../lib/note-completion.js';
import { useNoteQueryScope } from '../lib/use-note-queries.js';
import { noteLinkHref } from '@mygitnotes/core/workspace-links';
import { formatDateYMD } from '../lib/date-utils.js';
import { DONE_EMOJI, DUE_EMOJI, START_EMOJI, TIMESTAMP_EMOJI, findToken, isTaskLine, setTaskChecked, setTokenValue } from '../lib/task-tokens.js';
import { TASK_TOKEN_ICON_SVG } from '../lib/task-icons.js';

export interface LiveMarkdownHandle {
  /** Inserts `text` at `at`, or in place of the selection. */
  insert: (text: string, at?: number) => void;
  revealRange: (from: number, to: number, focus?: boolean) => void;
  goToLine: (line: number, options?: { focus?: boolean; smooth?: boolean }) => void;
  getCurrentLine: () => number;
}
interface Props { content: string; notePath: string; readOnly: boolean; ariaLabel?: string; onChange: (content: string) => void; onCaret?: (position: number) => void; showLineNumbers?: boolean }
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
    const isImageOnly = /^\s*!\[.*?\]\(.*?\)\s*$/.test(this.text);
    const dom = document.createElement(this.block ? 'div' : 'span');
    dom.className = 'live-md-rendered prose-custom' + (isImageOnly ? ' live-md-image-rendered' : '');
    // flow-root keeps rendered child margins inside the widget, where CodeMirror measures block heights.
    if (this.block) { dom.style.display = 'flow-root'; dom.style.width = '100%'; }
    dom.innerHTML = renderNote(this.text, this.path, this.tableLabel);
    dom.setAttribute('aria-label', 'Rendered Markdown; click to edit');
    dom.addEventListener('mousedown', event => {
      if ((event.target as HTMLElement).closest('a, [data-workspace-link]')) return;
      if ((event.target as HTMLElement).matches('.markdown-table-scroll')) return;
      if ((event.target as HTMLElement).tagName.toLowerCase() === 'img') return;
      event.preventDefault(); view.dispatch({selection:{anchor:this.from}}); view.focus();
    });
    for (const image of dom.querySelectorAll('img')) image.addEventListener('load', () => view.requestMeasure());
    return dom;
  }
  get estimatedHeight() { return this.block ? 100 : 160; }
}
class PageBreak extends WidgetType {
  constructor(readonly from: number, readonly label: string, readonly pageNumber: number) { super(); }
  eq(other: PageBreak) { return this.from === other.from && this.label === other.label && this.pageNumber === other.pageNumber; }
  toDOM(view: EditorView) {
    const dom = document.createElement('div');
    dom.className = 'live-md-page-break';
    dom.dataset.pageBreak = String(this.pageNumber);

    const shelf = document.createElement('div');
    shelf.className = 'live-md-page-break-shelf';
    const tag = document.createElement('span');
    tag.className = 'live-md-page-break-tag';
    tag.textContent = this.label;
    shelf.appendChild(tag);

    const gap = document.createElement('div');
    gap.className = 'live-md-page-break-gap';

    dom.appendChild(shelf);
    dom.appendChild(gap);

    dom.addEventListener('mousedown', event => {
      event.preventDefault();
      view.dispatch({ selection: { anchor: this.from } });
      view.focus();
    });
    return dom;
  }
  get estimatedHeight() { return 48; }
}
class PageFooter extends WidgetType {
  constructor(readonly pageNumber: number, readonly label: string) { super(); }
  eq(other: PageFooter) { return this.pageNumber === other.pageNumber && this.label === other.label; }
  toDOM() {
    const dom = document.createElement('div');
    dom.className = 'live-md-page-footer';
    dom.dataset.pageFooter = String(this.pageNumber);

    const shelf = document.createElement('div');
    shelf.className = 'live-md-page-break-shelf';
    const tag = document.createElement('span');
    tag.className = 'live-md-page-break-tag';
    tag.textContent = this.label;
    shelf.appendChild(tag);

    dom.appendChild(shelf);
    return dom;
  }
  get estimatedHeight() { return 24; }
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
    const span = document.createElement('span'); span.className = 'live-md-token-chip';
    span.innerHTML = `${TASK_TOKEN_ICON_SVG[this.emoji] ?? ''}<span class="live-md-token-chip-value">${this.value}</span>`;
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
    // The icon names which date is being edited, so a start picker is not mistaken for a due picker.
    wrap.insertAdjacentHTML('afterbegin', TASK_TOKEN_ICON_SVG[this.emoji] ?? '');
    wrap.appendChild(input); wrap.appendChild(clear);
    requestAnimationFrame(() => input.focus());
    return wrap;
  }
}
class DateAdder extends WidgetType {
  constructor(readonly emoji: string, readonly posKey: number, readonly label: string) { super(); }
  eq(other: DateAdder) { return this.emoji === other.emoji && this.posKey === other.posKey && this.label === other.label; }
  toDOM(view: EditorView) {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'live-md-due-adder';
    button.innerHTML = `<span aria-hidden="true">+</span>${TASK_TOKEN_ICON_SVG[this.emoji] ?? ''}`;
    button.title = this.label; button.setAttribute('aria-label', this.label);
    button.addEventListener('mousedown', event => event.preventDefault());
    button.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); view.dispatch({ effects: chipEditChanged.of({ pos: this.posKey, editing: true }) }); });
    return button;
  }
}
class MdxImportWidget extends WidgetType {
  constructor(readonly rawText: string, readonly from: number) { super(); }
  eq(other: MdxImportWidget) { return this.rawText === other.rawText && this.from === other.from; }
  toDOM(view: EditorView) {
    const span = document.createElement('span');
    span.className = 'live-md-mdx-import-chip';
    span.title = `${this.rawText} (點擊編輯)`;
    const match = /import\s+([\w{},\s*]+)\s+from\s+['"]([^'"]+)['"]/.exec(this.rawText);
    const identifier = match ? match[1].trim() : 'component';
    const source = match ? match[2].split('/').pop()?.replace(/\.\w+$/, '') || match[2] : '';
    span.innerHTML = `<span class="mdx-chip-badge">MDX</span><span class="mdx-chip-name">${escapeHtml(identifier)}</span>${source ? `<span class="mdx-chip-from">from ${escapeHtml(source)}</span>` : ''}`;
    span.addEventListener('click', () => {
      view.dispatch({ selection: { anchor: this.from } });
      view.focus();
    });
    return span;
  }
}
function atCompletionSource(context: CompletionContext): CompletionResult | null {
  const match = context.matchBefore(/@\w*/);
  if (!match || (match.from === match.to && !context.explicit)) return null;
  const onTaskLine = isTaskLine(context.state.doc.lineAt(match.from).text);
  const query = match.text.slice(1).toLowerCase();
  const allItems = getAtCompletionItems({ onTaskLine, now: new Date() });
  const items = query ? allItems.filter(item => item.label.toLowerCase().split(' ').some(word => word.startsWith(query))) : allItems;
  return {
    from: match.from,
    to: match.to,
    filter: false,
    options: items.map(item => ({
      label: item.label,
      // The token emoji this item inserts or edits; `addToOptions` renders it as an icon, never as text.
      type: item.pickTarget === 'start' ? START_EMOJI : item.pickTarget === 'due' ? DUE_EMOJI : item.insertText!.split(' ')[0],
      apply: item.insertText !== undefined ? item.insertText : (view: EditorView, _completion: unknown, from: number, to: number) => {
        const line = view.state.doc.lineAt(from);
        // Start's identity key is the line start (stable across the deletion below); due's is the line end, which shifts.
        const pos = item.pickTarget === 'start' ? line.from : line.to - (to - from);
        view.dispatch({ changes: { from, to, insert: '' }, effects: chipEditChanged.of({ pos, editing: true }) });
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
  const docText = state.doc.toString();
  const directiveBlocks = findDirectiveBlocks(docText);
  const collapsedDirectives = directiveBlocks.filter(b => !active(b.from, b.to));
  // A nested quote line carries one QuoteMark per level; each reveal is taken out of flow to the
  // same spot (see .live-md-quote-mark-reveal), so adjacent marks are merged into one span here —
  // otherwise a depth-2+ line's revealed markers would render on top of each other.
  let quoteReveal: { from: number; to: number } | null = null;
  const flushQuoteReveal = () => {
    if (quoteReveal) marks.push(Decoration.mark({class:'live-md-quote-mark-reveal'}).range(quoteReveal.from, quoteReveal.to));
    quoteReveal = null;
  };

  syntaxTree(state).iterate({ enter(node) {
    const {from,to,name} = node;
    if (collapsedDirectives.some(b => from >= b.from && to <= b.to)) {
      return false;
    }
    const editing = active(from,to);
    if (/^(ATXHeading|SetextHeading)[1-6]$/.test(name)) marks.push(Decoration.line({class:`live-md-heading live-md-h${name.at(-1)}`,attributes:{'data-heading-slug':headingSlug(state.sliceDoc(from,to).split('\n')[0])}}).range(state.doc.lineAt(from).from));
    if (name === 'Blockquote') {
      let depth = 1; for(let p = node.node.parent; p; p = p.parent) if (p.name === 'Blockquote') depth++;
      // Nested Blockquote nodes are visited separately below, each owning their own lines;
      // skip lines claimed by a nested quote so a line only gets the deepest level's indent.
      const nestedRanges = node.node.getChildren('Blockquote').map(n => ({from:n.from,to:n.to}));
      for(let line = state.doc.lineAt(from); line.from < to; line = state.doc.line(line.number+1)) {
        if (!nestedRanges.some(r => line.from < r.to && line.to > r.from)) {
          marks.push(Decoration.line({class:'live-md-quote',attributes:{style:`--quote-depth:${depth}`}}).range(line.from));
        }
        if(line.number === state.doc.lines)break;
      }
    }
    if (name === 'FencedCode' || name === 'CodeBlock') for(let line = state.doc.lineAt(from); line.from < to; line = state.doc.line(line.number+1)) {
      marks.push(Decoration.line({class:'live-md-codeblock'}).range(line.from)); if(line.number === state.doc.lines)break;
    }
    const styles: Record<string,string> = {StrongEmphasis:'live-md-strong',Emphasis:'live-md-emphasis',Strikethrough:'live-md-strike',InlineCode:'live-md-code',Link:'live-md-link'};
    if (styles[name] && from < to) marks.push(Decoration.mark({class:styles[name]}).range(from,to));
    if (name === 'HorizontalRule' && node.node.parent?.name === 'Document' && state.sliceDoc(from, to).trim() === '---') {
      const currentPage = pageNumber;
      pageNumber++;
      const label = `${pageLabel} ${currentPage}`;
      if (editing) marks.push(Decoration.line({ class: 'live-md-page-divider', attributes: { 'data-page-break': String(currentPage), 'data-page-label': label } }).range(state.doc.lineAt(from).from));
      else marks.push(Decoration.replace({ widget: new PageBreak(from, label, currentPage), block: true }).range(from, to));
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
      if (name === 'Image') {
        const line = state.doc.lineAt(from);
        if (line.text.trim() === state.sliceDoc(from, to).trim()) {
          marks.push(Decoration.line({ class: 'live-md-image-line' }).range(line.from));
        }
      }
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
    if (editing && name === 'QuoteMark') {
      // Reveal the '> ' source on the active line, but take it out of the text flow (see
      // .live-md-quote-mark-reveal) so it hangs in the gutter instead of shifting the line's text.
      let end = to; if (state.sliceDoc(to,to+1)===' ')end++;
      if (quoteReveal && quoteReveal.to === from) quoteReveal.to = end;
      else { flushQuoteReveal(); quoteReveal = {from, to: end}; }
    } else if (!editing && /^(HeaderMark|EmphasisMark|StrikethroughMark|CodeMark|QuoteMark)$/.test(name)) {
      // Keep fenced code delimiters visible so language and boundaries remain editable.
      if (name === 'CodeMark' && node.node.parent?.name === 'FencedCode') return;
      let end = to; if ((name === 'HeaderMark' || name === 'QuoteMark') && state.sliceDoc(to,to+1)===' ')end++;
      hide(from,end);
    }
  }});
  flushQuoteReveal();

  for (const block of collapsedDirectives) {
    marks.push(
      Decoration.replace({
        widget: new LiveMarkdownDirective(
          block.rawText,
          notePath,
          block.from,
          state.readOnly,
          block.type,
          block.attrs.variant,
          t
        ),
        block: true,
      }).range(block.from, block.to)
    );
  }

  const editingChips = state.field(chipEditState);
  const addDueLabel = t('editor.addDueDate'), addStartLabel = t('editor.addStartDate');
  const TOKENS: [string, boolean][] = [[DUE_EMOJI, false], [DONE_EMOJI, false], [TIMESTAMP_EMOJI, true], [START_EMOJI, false]];
  for (let lineNumber = 1; lineNumber <= state.doc.lines; lineNumber++) {
    const line = state.doc.line(lineNumber);
    if (collapsedDirectives.some(b => line.from >= b.from && line.to <= b.to)) {
      continue;
    }
    // MDX import statement: low-key display when not active/editing
    if (/^[ \t]*import\s+.*?(?:from\s+['"][^'"]+['"]|['"][^'"]+['"]);?[ \t]*$/.test(line.text)) {
      if (!active(line.from, line.to)) {
        marks.push(Decoration.replace({ widget: new MdxImportWidget(line.text.trim(), line.from) }).range(line.from, line.to));
      }
      continue;
    }
    for (const [emoji, withTime] of TOKENS) {
      const token = findToken(line.text, emoji, withTime);
      if (!token) continue;
      const from = line.from + token.start, to = line.from + token.end;
      if (editingChips.has(from)) marks.push(Decoration.replace({ widget: new TokenEditor(emoji, withTime, token.value, line.from, line.to, from), side: 1 }).range(from, to));
      else marks.push(Decoration.replace({ widget: new TokenChip(emoji, token.value, from, state.readOnly) }).range(from, to));
    }
    if (!state.readOnly && isTaskLine(line.text)) {
      if (!findToken(line.text, DUE_EMOJI)) {
        if (editingChips.has(line.to)) marks.push(Decoration.widget({ widget: new TokenEditor(DUE_EMOJI, false, undefined, line.from, line.to, line.to), side: 2 }).range(line.to));
        else marks.push(Decoration.widget({ widget: new DateAdder(DUE_EMOJI, line.to, addDueLabel), side: 2 }).range(line.to));
      }
      if (!findToken(line.text, START_EMOJI)) {
        // Identity key is line.from (not the render position) so it stays distinct from the due-date adder's line.to key.
        if (editingChips.has(line.from)) marks.push(Decoration.widget({ widget: new TokenEditor(START_EMOJI, false, undefined, line.from, line.to, line.from), side: 3 }).range(line.to));
        else marks.push(Decoration.widget({ widget: new DateAdder(START_EMOJI, line.from, addStartLabel), side: 3 }).range(line.to));
      }
    }
  }
  const lastPageLabel = `${pageLabel} ${pageNumber}`;
  marks.push(Decoration.widget({
    widget: new PageFooter(pageNumber, lastPageLabel),
    side: 1,
    block: true,
  }).range(state.doc.length));
  return Decoration.set(marks,true);
}
// .cm-content is a non-positioned box, so it always paints above drawSelection()'s
// negative-z-index selection layer, hiding the tint. This layer paints the "card" background
// behind the selection layer instead, so .cm-content itself can stay transparent.
// It must be listed after drawSelection() in the extensions array: CodeMirror z-indexes
// same-"above" layers by their order (later = more negative), so this needs the later slot
// to stay behind the selection layer instead of covering it again.
const cardBackgroundLayer = layer({
  above: false,
  class: 'cm-card-background-layer',
  update: () => true,
  markers(view) {
    const contentRect = view.contentDOM.getBoundingClientRect();
    const scrollerRect = view.scrollDOM.getBoundingClientRect();
    const left = contentRect.left - scrollerRect.left + view.scrollDOM.scrollLeft;
    const top = contentRect.top - scrollerRect.top + view.scrollDOM.scrollTop;
    return [new RectangleMarker('cm-card-background', left, top, contentRect.width, contentRect.height)];
  },
});
const theme = EditorView.theme({
  '&':{height:'100%',color:'var(--color-text)',backgroundColor:'var(--color-bg)'},
  '&.cm-focused':{outline:'none'}, '.cm-scroller':{overflow:'auto',fontFamily:'inherit',lineHeight:'1.8',backgroundColor:'var(--color-bg)',padding:'24px 16px'},
  // The horizontal inset lives on .cm-line (not .cm-content) because CodeMirror's own
  // selection-rectangle geometry (rectanglesForRange) reads a line's computed padding to
  // find the text edge for whole-line selection spans; padding on .cm-content itself is
  // invisible to that calculation and left the selection tint jutting into the card margin.
  '.cm-content':{padding:'32px 0 0',maxWidth:'880px',margin:'0 auto',minHeight:'calc(100% - 48px)',width:'100%',caretColor:'var(--color-primary)'},
  '.cm-card-background':{backgroundColor:'var(--color-surface)',borderRadius:'4px',boxShadow:'0 1px 4px 0 color-mix(in srgb, var(--color-scrim) 8%, transparent), 0 0 0 1px var(--workspace-divider)'},
  '.cm-line':{padding:'0 40px'}, '.cm-cursor':{borderLeftColor:'var(--color-primary)'},
  '.cm-gutters':{backgroundColor:'transparent',borderRight:'1px solid var(--color-border)'},
  '.cm-lineNumbers':{color:'var(--color-muted)',fontFamily:'monospace',fontSize:'11px',opacity:'0.55'},
  '.cm-lineNumbers .cm-gutterElement':{paddingLeft:'8px',paddingRight:'10px',transformOrigin:'right center',transition:'color 150ms, transform 150ms, font-weight 150ms'},
  '.cm-lineNumbers .cm-activeLineGutter':{color:'var(--color-primary)',fontWeight:'700',transform:'scale(1.08)'},
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground':{backgroundColor:'var(--color-selection) !important'},
  // CodeMirror's own hideNativeSelection theme makes the native ::selection background
  // transparent (so our .cm-selectionBackground layer shows through) but leaves its text
  // colour alone, which browsers default to a light system colour (e.g. HighlightText) —
  // illegible against our tint. `::selection` inherits from an ancestor's ::selection rule,
  // not from the originating element's own `color`, so `color: inherit` would still resolve
  // to that system default; set the normal text colour explicitly instead, per element type.
  '.cm-line ::selection, .cm-line::selection':{color:'var(--color-text)'},
  '.live-md-link::selection, .live-md-link *::selection, .live-md-url::selection':{color:'var(--color-link)'},
  '.live-md-quote::selection, .live-md-quote *::selection':{color:'var(--color-muted)'},
  '.live-md-heading':{fontWeight:'700',lineHeight:'1.4',paddingTop:'12px',paddingBottom:'8px'},
  '.live-md-heading span':{textDecoration:'none'},
  '.live-md-h1':{fontSize:'1.85em'},'.live-md-h2':{fontSize:'1.5em'},'.live-md-h3':{fontSize:'1.25em'},
  '.live-md-strong':{fontWeight:'700'},'.live-md-emphasis':{fontStyle:'italic'},'.live-md-strike':{textDecoration:'line-through'},
  '.live-md-link, .live-md-link span, .live-md-url':{color:'var(--color-link)',textDecoration:'underline'},
  '.live-md-hr':{color:'var(--color-text)'},
  '.live-md-code':{fontFamily:'monospace',backgroundColor:'var(--color-code-bg)',borderRadius:'4px'},
  // Both sides are explicit (not just the extra indent) because .live-md-codeblock is a .cm-line
  // and would otherwise fall back to .cm-line's own padding for whichever side it doesn't set —
  // now that .cm-line carries the full 40px card inset (previously .cm-content did), leaving
  // paddingRight unset would collapse only the left side, jamming the block against the card edge.
  '.live-md-codeblock':{fontFamily:'monospace',backgroundColor:'var(--color-code-bg)',paddingLeft:'54px',paddingRight:'42px'},
  // paddingLeft (38px) + borderLeft (2px) = .cm-line's own 40px inset, so the border hangs at
  // the card's left edge while the quote text lands flush with a plain paragraph line's text.
  // Nesting adds a readable step per level via --quote-depth (set per line in liveDecorations).
  '.live-md-quote':{position:'relative',borderLeft:'2px solid color-mix(in srgb, var(--color-text) 22%, var(--color-border))',paddingLeft:'calc(38px + (var(--quote-depth, 1) - 1) * 16px)',color:'var(--color-muted)'},
  // The revealed '> ' marker on an active quote line is taken out of the text flow so it
  // doesn't push the line's text further right than the lines around it (see liveDecorations).
  '.live-md-quote-mark-reveal':{position:'absolute',left:'0'},
  '.live-md-mdx-import-chip':{display:'inline-flex',alignItems:'center',gap:'5px',padding:'1px 8px',borderRadius:'4px',fontSize:'0.78em',fontFamily:'monospace',cursor:'pointer',backgroundColor:'color-mix(in srgb, var(--color-text) 4%, var(--color-surface))',color:'var(--color-muted)',border:'1px solid color-mix(in srgb, var(--color-text) 12%, var(--color-border))',opacity:'0.65',transition:'opacity 120ms ease'},
  '.live-md-mdx-import-chip:hover':{opacity:'1'},
  '.live-md-mdx-import-chip .mdx-chip-badge':{fontSize:'9px',fontWeight:'700',textTransform:'uppercase',color:'var(--color-muted)'},
  '.live-md-mdx-import-chip .mdx-chip-name':{color:'var(--color-text)',fontWeight:'600'},
  '.live-md-mdx-import-chip .mdx-chip-from':{opacity:'0.75'},
  '.live-md-image-line':{lineHeight:'0',paddingTop:'4px',paddingBottom:'4px'},
  '.live-md-rendered':{display:'inline-block',maxWidth:'100%',cursor:'text'},
  '.live-md-rendered p':{margin:'0'},'.live-md-rendered img':{maxWidth:'100%',maxHeight:'480px',borderRadius:'8px',margin:'0',cursor:'zoom-in',display:'block'},
  '.live-md-image-rendered':{display:'inline-block',verticalAlign:'top',lineHeight:'0',whiteSpace:'normal'},
  '.live-md-image-rendered p':{margin:'0',padding:'0',lineHeight:'0'},
  '.cm-content input[type=checkbox]':{accentColor:'var(--color-primary)',verticalAlign:'middle',marginRight:'4px'},
  '.live-md-token-chip':{display:'inline-flex',alignItems:'center',gap:'4px',padding:'0 6px',borderRadius:'999px',fontSize:'0.85em',cursor:'pointer',backgroundColor:'var(--color-sidebar)',color:'var(--color-muted)',border:'1px solid var(--color-border)'},
  '.live-md-token-editor':{display:'inline-flex',alignItems:'center',gap:'4px',marginLeft:'4px',color:'var(--color-muted)'},
  '.live-md-token-editor input':{fontSize:'0.85em',padding:'1px 4px'},
  '.live-md-token-clear':{cursor:'pointer',color:'var(--color-muted)',fontWeight:'700',lineHeight:'1',border:'none',background:'none',padding:'0 2px'},
  '.live-md-completion-icon':{display:'inline-flex',verticalAlign:'-2px',marginRight:'6px',color:'var(--color-muted)'},
  '.cm-tooltip-autocomplete ul li[aria-selected] .live-md-completion-icon':{color:'inherit'},
  '.live-md-due-adder':{display:'inline-flex',alignItems:'center',gap:'2px',marginLeft:'6px',padding:'0 6px',borderRadius:'999px',fontSize:'0.8em',cursor:'pointer',color:'var(--color-muted)',border:'1px dashed var(--color-border)',background:'none'},
});
export const LiveMarkdownEditor = forwardRef<LiveMarkdownHandle,Props>(({content,notePath,readOnly,onChange,onCaret,ariaLabel = 'Note content',showLineNumbers = true},ref) => {
  const { t } = useTranslation(); const linkLabel = t('links.open');
  const tableLabel = t('preview.scrollableTable'), pageLabel = t('editor.page');
  const location = useLocation();
  const host = useRef<HTMLDivElement>(null); const editor = useRef<EditorView>();
  const callback = useRef(onChange); callback.current = onChange;
  const queryClient = useQueryClient(); const scope = useNoteQueryScope();
  const completionSource = useRef({ queryClient, scope }); completionSource.current = { queryClient, scope };
  const caretCallback = useRef(onCaret); caretCallback.current = onCaret;
  const permission = useRef(new Compartment());
  const lineNumberGutter = useRef(new Compartment());
  useImperativeHandle(ref, () => ({
    insert(text, at) {
      const view=editor.current;if(!view||view.state.readOnly)return;
      const from=at===undefined?undefined:Math.max(0,Math.min(at,view.state.doc.length));
      view.dispatch(from===undefined?view.state.replaceSelection(text):{changes:{from,insert:text},selection:{anchor:from+text.length}},{scrollIntoView:true,userEvent:'input'});view.focus();
    },
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
      markdown({base:markdownLanguage}),history(),keymap.of([...defaultKeymap,...historyKeymap]),drawSelection(),cardBackgroundLayer,lineNumberGutter.current.of(showLineNumbers?[lineNumbers(),highlightActiveLineGutter()]:[]),EditorView.lineWrapping,
      syntaxHighlighting(tokenHighlightStyle),syntaxHighlighting(HighlightStyle.define([{tag:tags.url,class:'live-md-url'},{tag:tags.contentSeparator,class:'live-md-hr'}])),codeMirrorTokenTheme,theme,tableUIState,chipEditState,field,
      autocompletion({ icons: false, addToOptions: [{ position: 20, render: completion => {
        const icon = completion.type && TASK_TOKEN_ICON_SVG[completion.type];
        if (!icon) return null;
        const span = document.createElement('span'); span.className = 'live-md-completion-icon'; span.innerHTML = icon;
        return span;
      } }], override: [atCompletionSource, async context => {
        const text = context.state.doc.toString(), match = noteCompletionAt(text, context.pos);
        if (!match || context.state.readOnly) return null;
        // Typing must not send one query per character; a superseded completion is dropped.
        await new Promise(resolve => setTimeout(resolve, 150));
        if (context.aborted) return null;
        const { queryClient: client, scope: current } = completionSource.current;
        const notes = await fetchNoteCandidates(client, current, match.query, notePath);
        if (context.aborted) return null;
        return { from: match.from, to: match.to, filter: false, options: notes.map(note => ({
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
  useEffect(()=>{editor.current?.dispatch({effects:lineNumberGutter.current.reconfigure(showLineNumbers?[lineNumbers(),highlightActiveLineGutter()]:[])});},[showLineNumbers]);
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
