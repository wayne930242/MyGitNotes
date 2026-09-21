import { escapeHtml } from '../../lib/directives.js';
import { EditorView, WidgetType } from '@codemirror/view';
import { isolateHistory } from '@codemirror/commands';
import { syntaxTree } from '@codemirror/language';
import { renderNote } from '../../lib/markdown.js';
import { formatDateYMD } from '../../lib/date-utils.js';
import { setTaskChecked, setTokenValue } from '../../lib/task-tokens.js';
import { TASK_TOKEN_ICON_SVG } from '../../lib/task-icons.js';
import { activateYouTubeEmbed, populateYouTubeEmbed, type YouTubeLabels } from '../../lib/youtube-embed.js';
import { createMermaidBlock, hydrateMermaid, replaceMermaidSource } from '../../lib/mermaid.js';
import { type MermaidEditorLabels, openMermaidEditor } from '../../lib/mermaid-editor.js';
import { chipEditChanged } from './chip-editing.js';

function externalLinkIcon(href: string, label: string, sourcePath: string): HTMLAnchorElement {
  const anchor = document.createElement('a');
  anchor.className = 'live-md-external-link';
  anchor.href = href;
  anchor.target = '_blank';
  anchor.rel = 'noopener noreferrer';
  anchor.title = label;
  anchor.setAttribute('aria-label', `${label}: ${href}`);
  anchor.dataset.workspaceLink = href;
  anchor.dataset.sourcePath = sourcePath;
  anchor.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 3h6v6M10 14 21 3M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/></svg>';
  return anchor;
}
export class ExternalLink extends WidgetType {
  constructor(readonly href: string, readonly label: string, readonly path: string) {
    super();
  }
  eq(other: ExternalLink) {
    return this.href === other.href && this.label === other.label && this.path === other.path;
  }
  toDOM() {
    return externalLinkIcon(this.href, this.label, this.path);
  }
}
export class RenderedMarkdown extends WidgetType {
  constructor(readonly text: string, readonly path: string, readonly from: number, readonly block: boolean, readonly linkLabel: string, readonly tableLabel: string) {
    super();
  }
  eq(other: RenderedMarkdown) {
    return this.text === other.text && this.path === other.path && this.from === other.from && this.linkLabel === other.linkLabel && this.tableLabel === other.tableLabel;
  }
  toDOM(view: EditorView) {
    const isImageOnly = /^\s*!\[.*?\]\(.*?\)\s*$/.test(this.text);
    const dom = document.createElement(this.block ? 'div' : 'span');
    dom.className = 'live-md-rendered prose-custom' + (isImageOnly ? ' live-md-image-rendered' : '');
    // flow-root keeps rendered child margins inside the widget, where CodeMirror measures block heights.
    if (this.block) {
      dom.style.display = 'flow-root';
      dom.style.width = '100%';
    }
    dom.innerHTML = renderNote(this.text, this.path, this.tableLabel);
    dom.setAttribute('aria-label', 'Rendered Markdown; click to edit');
    dom.addEventListener('mousedown', event => {
      if ((event.target as HTMLElement).closest('a, [data-workspace-link]')) return;
      if ((event.target as HTMLElement).matches('.markdown-table-scroll')) return;
      if ((event.target as HTMLElement).tagName.toLowerCase() === 'img') return;
      event.preventDefault();
      view.dispatch({ selection: { anchor: this.from } });
      view.focus();
    });
    for (const image of dom.querySelectorAll('img')) image.addEventListener('load', () => view.requestMeasure());
    return dom;
  }
  get estimatedHeight() {
    return this.block ? 100 : 160;
  }
}
export class PageBreak extends WidgetType {
  constructor(readonly from: number, readonly label: string, readonly pageNumber: number) {
    super();
  }
  eq(other: PageBreak) {
    return this.from === other.from && this.label === other.label && this.pageNumber === other.pageNumber;
  }
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
  get estimatedHeight() {
    return 48;
  }
}
export class PageFooter extends WidgetType {
  constructor(readonly pageNumber: number, readonly label: string) {
    super();
  }
  eq(other: PageFooter) {
    return this.pageNumber === other.pageNumber && this.label === other.label;
  }
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
  get estimatedHeight() {
    return 24;
  }
}
export class TaskCheckbox extends WidgetType {
  constructor(readonly checked: boolean, readonly from: number, readonly readonly: boolean) {
    super();
  }
  eq(other: TaskCheckbox) {
    return this.checked === other.checked && this.from === other.from && this.readonly === other.readonly;
  }
  toDOM(view: EditorView) {
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = this.checked;
    input.disabled = this.readonly;
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
export class TokenChip extends WidgetType {
  constructor(readonly emoji: string, readonly value: string, readonly posKey: number, readonly readonly: boolean) {
    super();
  }
  eq(other: TokenChip) {
    return this.emoji === other.emoji && this.value === other.value && this.posKey === other.posKey && this.readonly === other.readonly;
  }
  toDOM(view: EditorView) {
    const span = document.createElement('span');
    span.className = 'live-md-token-chip';
    span.innerHTML = `${TASK_TOKEN_ICON_SVG[this.emoji] ?? ''}<span class="live-md-token-chip-value">${this.value}</span>`;
    if (!this.readonly) {
      span.setAttribute('role', 'button');
      span.tabIndex = 0;
      span.title = 'Click to change or clear this date';
      const open = (event: Event) => {
        event.preventDefault();
        event.stopPropagation();
        view.dispatch({ effects: chipEditChanged.of({ pos: this.posKey, editing: true }) });
      };
      span.addEventListener('mousedown', event => event.preventDefault());
      span.addEventListener('click', open);
      span.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') open(event);
      });
    }
    return span;
  }
}
export class TokenEditor extends WidgetType {
  constructor(readonly emoji: string, readonly withTime: boolean, readonly value: string | undefined, readonly lineFrom: number, readonly lineTo: number, readonly posKey: number) {
    super();
  }
  eq(other: TokenEditor) {
    return this.emoji === other.emoji && this.value === other.value && this.lineFrom === other.lineFrom && this.posKey === other.posKey;
  }
  toDOM(view: EditorView) {
    const wrap = document.createElement('span');
    wrap.className = 'live-md-token-editor';
    const input = document.createElement('input');
    input.className = 'ui-control';
    input.type = this.withTime ? 'datetime-local' : 'date';
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
    input.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close(undefined);
      }
    });
    const clear = document.createElement('button');
    clear.type = 'button';
    clear.className = 'live-md-token-clear';
    clear.setAttribute('aria-label', 'Clear date');
    clear.textContent = '×';
    clear.addEventListener('mousedown', event => event.preventDefault());
    clear.addEventListener('click', () => close(null));
    // The icon names which date is being edited, so a start picker is not mistaken for a due picker.
    wrap.insertAdjacentHTML('afterbegin', TASK_TOKEN_ICON_SVG[this.emoji] ?? '');
    wrap.appendChild(input);
    wrap.appendChild(clear);
    requestAnimationFrame(() => input.focus());
    return wrap;
  }
}
export class DateAdder extends WidgetType {
  constructor(readonly emoji: string, readonly posKey: number, readonly label: string) {
    super();
  }
  eq(other: DateAdder) {
    return this.emoji === other.emoji && this.posKey === other.posKey && this.label === other.label;
  }
  toDOM(view: EditorView) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'live-md-due-adder';
    button.innerHTML = `<span aria-hidden="true">+</span>${TASK_TOKEN_ICON_SVG[this.emoji] ?? ''}`;
    button.title = this.label;
    button.setAttribute('aria-label', this.label);
    button.addEventListener('mousedown', event => event.preventDefault());
    button.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      view.dispatch({ effects: chipEditChanged.of({ pos: this.posKey, editing: true }) });
    });
    return button;
  }
}
export class MdxImportWidget extends WidgetType {
  constructor(readonly rawText: string, readonly from: number) {
    super();
  }
  eq(other: MdxImportWidget) {
    return this.rawText === other.rawText && this.from === other.from;
  }
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
export class BulletMarker extends WidgetType {
  eq() {
    return true;
  }
  toDOM() {
    const span = document.createElement('span');
    span.textContent = '•';
    span.setAttribute('aria-hidden', 'true');
    return span;
  }
}
export class YouTubeWidget extends WidgetType {
  constructor(readonly owner: string, readonly videoId: string, readonly start: number, readonly sourceUrl: string, readonly from: number, readonly labels: YouTubeLabels) {
    super();
  }
  eq(other: YouTubeWidget) {
    return this.owner === other.owner && this.videoId === other.videoId && this.start === other.start && this.sourceUrl === other.sourceUrl && this.from === other.from && this.labels === other.labels;
  }
  toDOM(view: EditorView) {
    // CodeMirror measures a block widget's own box, which excludes its margins, so the spacing
    // around the embed lives on this wrapper as padding; a margin here would shift every click
    // below it by the margin CodeMirror never counted.
    const wrapper = document.createElement('div');
    wrapper.className = 'note-youtube-block';
    const container = document.createElement('div');
    container.className = 'note-youtube-embed';
    container.dataset.videoId = this.videoId;
    container.dataset.start = String(this.start);
    container.dataset.youtubeSourceUrl = this.sourceUrl;
    container.dataset.youtubeSession = `${this.owner}:${this.videoId}:${this.start}:${this.from}`;

    const { poster: button, image: img } = populateYouTubeEmbed(container, this.labels);
    img.addEventListener('load', () => view.requestMeasure());

    button.addEventListener('mousedown', event => {
      event.stopPropagation();
    });
    button.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      activateYouTubeEmbed(button);
      view.requestMeasure();
    });
    for (const modeButton of container.querySelectorAll<HTMLButtonElement>('[data-youtube-mode-option]')) modeButton.addEventListener('mousedown', event => event.stopPropagation());

    container.addEventListener('mousedown', event => {
      if ((event.target as HTMLElement).closest('.note-youtube-poster, .note-youtube-mode-control, iframe')) return;
      event.preventDefault();
      view.dispatch({ selection: { anchor: this.from } });
      view.focus();
    });

    wrapper.appendChild(container);
    return wrapper;
  }
  get estimatedHeight() {
    return 280;
  }
}

export interface MermaidLabels extends MermaidEditorLabels {
  edit: string;
}
/** A top-level ```mermaid fence drawn as its diagram; the raw source returns when the cursor enters the fence. */
export class MermaidDiagram extends WidgetType {
  private stop = () => {};
  constructor(readonly source: string, readonly readOnly: boolean, readonly labels: MermaidLabels) {
    super();
  }
  // Position is left out on purpose: an edit above the fence must keep the drawn diagram instead of redrawing it.
  eq(other: MermaidDiagram) {
    return this.source === other.source && this.readOnly === other.readOnly && (Object.keys(this.labels) as (keyof MermaidLabels)[]).every(key => this.labels[key] === other.labels[key]);
  }
  toDOM(view: EditorView) {
    // CodeMirror measures a block widget's own box, so spacing lives on this wrapper as padding.
    const wrapper = document.createElement('div');
    wrapper.className = 'live-md-mermaid';
    wrapper.append(createMermaidBlock(this.source));
    this.stop = hydrateMermaid(wrapper, { errorLabel: this.labels.error, onSettled: () => view.requestMeasure() });
    wrapper.addEventListener('mousedown', event => {
      if ((event.target as HTMLElement).closest('button')) return;
      event.preventDefault();
      view.dispatch({ selection: { anchor: view.posAtDOM(wrapper) } });
      view.focus();
    });
    if (!this.readOnly) {
      const edit = document.createElement('button');
      edit.type = 'button';
      edit.className = 'live-md-mermaid-edit ui-button ui-button-small';
      edit.textContent = this.labels.edit;
      edit.setAttribute('aria-label', this.labels.edit);
      edit.addEventListener('mousedown', event => {
        event.preventDefault();
        event.stopPropagation();
      });
      edit.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        this.edit(view, view.posAtDOM(wrapper));
      });
      wrapper.append(edit);
    }
    return wrapper;
  }
  private edit(view: EditorView, pos: number) {
    let node: ReturnType<ReturnType<typeof syntaxTree>['resolveInner']> | null = syntaxTree(view.state).resolveInner(pos, 1);
    while (node && node.name !== 'FencedCode') node = node.parent;
    if (!node) return;
    const { from, to } = node;
    const fence = view.state.sliceDoc(from, to);
    openMermaidEditor({
      source: this.source,
      labels: this.labels,
      onSave: source => {
        const text = replaceMermaidSource(fence, source);
        if (text !== fence) view.dispatch({ changes: { from, to, insert: text }, annotations: isolateHistory.of('full'), userEvent: 'input' });
      },
      onClose: () => view.focus(),
    });
  }
  destroy() {
    this.stop();
  }
  ignoreEvent() {
    return true;
  }
  get estimatedHeight() {
    return 240;
  }
}
