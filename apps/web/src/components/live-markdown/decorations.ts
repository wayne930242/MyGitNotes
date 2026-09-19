import { Decoration, type DecorationSet } from '@codemirror/view';
import type { EditorState, Range } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';
import { marked } from 'marked';
import { findDirectiveBlocks } from '../../lib/directives.js';
import { headingSlug, resolveWorkspaceHref } from '../../lib/workspace-links.js';
import { parseYouTubeUrl } from '@mygitnotes/core/screen-page';
import { DONE_EMOJI, DUE_EMOJI, findToken, isTaskLine, START_EMOJI, TIMESTAMP_EMOJI } from '../../lib/task-tokens.js';
import type { I18nContextValue } from '../../lib/i18n/index.js';
import { LiveMarkdownDirective } from '../LiveMarkdownDirective.js';
import { LiveMarkdownTable, tableUIState } from '../LiveMarkdownTable.js';
import { BulletMarker, DateAdder, ExternalLink, MdxImportWidget, PageBreak, PageFooter, RenderedMarkdown, TaskCheckbox, TokenChip, TokenEditor, YouTubeWidget } from './widgets.js';
import { chipEditState } from './chip-editing.js';

export function liveDecorations(state: EditorState, focused: boolean, notePath: string, linkLabel: string, tableLabel: string, pageLabel: string, youtubeOwner: string, t: I18nContextValue['t']): DecorationSet {
  const marks: Range<Decoration>[] = [];
  let pageNumber = 1;
  const references = marked.lexer(state.doc.toString()).links;
  const active = (from: number, to: number) => focused && !state.readOnly && state.selection.ranges.some(range => state.doc.lineAt(range.from).from <= to && state.doc.lineAt(range.to).to >= from);
  const hide = (from: number, to: number) => {
    if (from < to) marks.push(Decoration.replace({}).range(from, to));
  };
  const link = (from: number, to: number, href: string) => {
    if (!resolveWorkspaceHref(href, notePath)) return;
    marks.push(Decoration.mark({ attributes: { 'data-workspace-link': href, 'data-source-path': notePath, role: 'link', tabindex: '0', title: linkLabel } }).range(from, to));
    marks.push(Decoration.widget({ widget: new ExternalLink(href, linkLabel, notePath), side: 1 }).range(to));
  };
  const docText = state.doc.toString();
  const directiveBlocks = findDirectiveBlocks(docText);
  const collapsedDirectives = directiveBlocks.filter(b => !active(b.from, b.to));
  // A nested quote line carries one QuoteMark per level; each reveal is taken out of flow to the
  // same spot (see .live-md-quote-mark-reveal), so adjacent marks are merged into one span here —
  // otherwise a depth-2+ line's revealed markers would render on top of each other.
  let quoteReveal: { from: number; to: number; } | null = null;
  const flushQuoteReveal = () => {
    if (quoteReveal) marks.push(Decoration.mark({ class: 'live-md-quote-mark-reveal' }).range(quoteReveal.from, quoteReveal.to));
    quoteReveal = null;
  };

  syntaxTree(state).iterate({
    enter(node) {
      const { from, to, name } = node;
      if (collapsedDirectives.some(b => from >= b.from && to <= b.to)) {
        return false;
      }
      const editing = active(from, to);
      if (/^(ATXHeading|SetextHeading)[1-6]$/.test(name)) marks.push(Decoration.line({ class: `live-md-heading live-md-h${name.at(-1)}`, attributes: { 'data-heading-slug': headingSlug(state.sliceDoc(from, to).split('\n')[0]) } }).range(state.doc.lineAt(from).from));
      if (name === 'Blockquote') {
        let depth = 1;
        for (let p = node.node.parent; p; p = p.parent) if (p.name === 'Blockquote') depth++;
        // Nested Blockquote nodes are visited separately below, each owning their own lines;
        // skip lines claimed by a nested quote so a line only gets the deepest level's indent.
        const nestedRanges = node.node.getChildren('Blockquote').map(n => ({ from: n.from, to: n.to }));
        for (let line = state.doc.lineAt(from); line.from < to; line = state.doc.line(line.number + 1)) {
          if (!nestedRanges.some(r => line.from < r.to && line.to > r.from)) {
            marks.push(Decoration.line({ class: 'live-md-quote', attributes: { style: `--quote-depth:${depth}` } }).range(line.from));
          }
          if (line.number === state.doc.lines) break;
        }
      }
      if (name === 'FencedCode' || name === 'CodeBlock') {
        for (let line = state.doc.lineAt(from); line.from < to; line = state.doc.line(line.number + 1)) {
          marks.push(Decoration.line({ class: 'live-md-codeblock' }).range(line.from));
          if (line.number === state.doc.lines) break;
        }
      }
      const styles: Record<string, string> = { StrongEmphasis: 'live-md-strong', Emphasis: 'live-md-emphasis', Strikethrough: 'live-md-strike', InlineCode: 'live-md-code', Link: 'live-md-link' };
      if (styles[name] && from < to) marks.push(Decoration.mark({ class: styles[name] }).range(from, to));
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
            marks.push(Decoration.replace({ widget: new YouTubeWidget(youtubeOwner, video.videoId, video.start, url, from, { play: t('youtube.play'), player: t('youtube.player'), modes: t('youtube.modes'), thumbnail: t('youtube.thumbnail'), medium: t('youtube.medium'), theater: t('youtube.theater'), copy: t('youtube.copy'), copied: t('youtube.copied'), copyFailed: t('youtube.copyFailed') }), block: true }).range(from, to));
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
        marks.push(Decoration.replace({ widget: new RenderedMarkdown(state.sliceDoc(from, to), notePath, from, name !== 'Image', linkLabel, tableLabel), block: name !== 'Image' }).range(from, to));
        return false;
      }
      if (!editing && name === 'TaskMarker') {
        marks.push(Decoration.replace({ widget: new TaskCheckbox(state.sliceDoc(from, to).toLowerCase() === '[x]', from, state.readOnly) }).range(from, to));
        return false;
      }
      if (!editing && name === 'ListMark' && node.node.parent?.parent?.name === 'BulletList') {
        if (node.node.parent.getChild('Task')) hide(from, to + 1);
        else marks.push(Decoration.replace({ widget: new BulletMarker() }).range(from, to));
      }
      // Bare URLs and angle-bracket autolinks have URL nodes without a Link parent.
      if (name === 'URL' && !['Link', 'Image', 'LinkReference'].includes(node.node.parent?.name ?? '')) link(from, to, state.sliceDoc(from, to));
      if (name === 'Link') {
        const url = node.node.getChild('URL');
        if (url) {
          const href = state.sliceDoc(url.from, url.to).replace(/^<|>$/g, '');
          link(from, to, href);
          const source = state.sliceDoc(from, to);
          const start = source.indexOf('[') + 1;
          const end = source.indexOf('](', start);
          if (!editing && end >= start) {
            hide(from, from + start);
            hide(from + end, to);
            return false;
          }
        } else {
          const source = state.sliceDoc(from, to);
          const reference = source.match(/^\[([^\]]+)\](?:\[([^\]]*)\])?$/);
          const target = reference && references[(reference[2] || reference[1]).replace(/\s+/g, ' ').toLowerCase()];
          if (target) {
            link(from, to, target.href);
            if (!editing) {
              hide(from, from + 1);
              hide(from + 1 + reference![1].length, to);
              return false;
            }
          }
        }
      }
      if (editing && name === 'QuoteMark') {
        // Reveal the '> ' source on the active line, but take it out of the text flow (see
        // .live-md-quote-mark-reveal) so it hangs in the gutter instead of shifting the line's text.
        let end = to;
        if (state.sliceDoc(to, to + 1) === ' ') end++;
        if (quoteReveal && quoteReveal.to === from) quoteReveal.to = end;
        else {
          flushQuoteReveal();
          quoteReveal = { from, to: end };
        }
      } else if (!editing && /^(HeaderMark|EmphasisMark|StrikethroughMark|CodeMark|QuoteMark)$/.test(name)) {
        // Keep fenced code delimiters visible so language and boundaries remain editable.
        if (name === 'CodeMark' && node.node.parent?.name === 'FencedCode') return;
        let end = to;
        if ((name === 'HeaderMark' || name === 'QuoteMark') && state.sliceDoc(to, to + 1) === ' ') end++;
        hide(from, end);
      }
    },
  });
  flushQuoteReveal();

  for (const block of collapsedDirectives) {
    marks.push(Decoration.replace({ widget: new LiveMarkdownDirective(block.rawText, notePath, block.from, state.readOnly, block.type, block.attrs.variant, t), block: true }).range(block.from, block.to));
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
  marks.push(Decoration.widget({ widget: new PageFooter(pageNumber, lastPageLabel), side: 1, block: true }).range(state.doc.length));
  return Decoration.set(marks, true);
}
