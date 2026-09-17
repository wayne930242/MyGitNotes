import { EditorView, WidgetType } from '@codemirror/view';
import { isolateHistory } from '@codemirror/commands';
import {
  DIRECTIVE_TEMPLATES,
  HANDOUT_VARIANTS,
  updateDirectiveType,
  updateDirectiveVariant,
} from '../lib/directives.js';
import { renderNote } from '../lib/markdown.js';
import type { TranslationKey } from '../lib/i18n/en.js';

type Translate = (key: TranslationKey, params?: Record<string, string | number>) => string;

const editIcon = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 5 4 4M4 20l4-1L20 7a3 3 0 0 0-4-4L4 15v5Z"/></svg>';

export class LiveMarkdownDirective extends WidgetType {
  constructor(
    readonly text: string,
    readonly path: string,
    readonly from: number,
    readonly readOnly: boolean,
    readonly currentType: string,
    readonly currentVariant?: string,
    readonly t?: Translate
  ) {
    super();
  }

  eq(other: LiveMarkdownDirective) {
    return (
      this.text === other.text &&
      this.path === other.path &&
      this.from === other.from &&
      this.readOnly === other.readOnly &&
      this.currentType === other.currentType &&
      this.currentVariant === other.currentVariant
    );
  }

  toDOM(view: EditorView) {
    const root = document.createElement('div');
    root.className = 'live-md-directive live-md-rendered prose-custom';
    root.contentEditable = 'false';
    root.dataset.directiveFrom = String(this.from);
    root.dataset.directiveType = this.currentType;

    // Render HTML of the directive block
    root.innerHTML = renderNote(this.text, this.path);

    if (this.readOnly) return root;

    // Build the interactive toolbar
    const toolbar = document.createElement('div');
    toolbar.className = 'live-directive-toolbar';
    toolbar.setAttribute('role', 'toolbar');
    toolbar.setAttribute('aria-label', 'Directive 區塊操作');

    // 1. Type selector (格式挑選)
    const typeSelect = document.createElement('select');
    typeSelect.className = 'live-directive-type-select';
    typeSelect.title = '更換區塊格式';
    typeSelect.setAttribute('aria-label', '更換區塊格式');

    for (const tpl of DIRECTIVE_TEMPLATES) {
      const option = document.createElement('option');
      option.value = tpl.type;
      option.textContent = tpl.label;
      if (tpl.type === this.currentType) {
        option.selected = true;
      }
      typeSelect.append(option);
    }
    typeSelect.value = this.currentType;

    typeSelect.addEventListener('mousedown', event => event.stopPropagation());
    typeSelect.addEventListener('change', () => {
      const newType = typeSelect.value;
      if (newType === this.currentType) return;
      const updatedText = updateDirectiveType(this.text, newType);
      if (updatedText !== this.text) {
        view.dispatch({
          changes: { from: this.from, to: this.from + this.text.length, insert: updatedText },
          annotations: isolateHistory.of('full'),
          userEvent: 'input.directive',
        });
        view.requestMeasure();
      }
    });
    toolbar.append(typeSelect);

    // 2. Variant selector (若是 handout 道具，支援挑選紙質/樣式變體)
    if (this.currentType === 'handout') {
      const variantSelect = document.createElement('select');
      variantSelect.className = 'live-directive-variant-select';
      variantSelect.title = '更換樣式風格';
      variantSelect.setAttribute('aria-label', '更換樣式風格');

      for (const [varKey, varLabel] of Object.entries(HANDOUT_VARIANTS)) {
        const option = document.createElement('option');
        option.value = varKey;
        option.textContent = varLabel;
        if (varKey === (this.currentVariant || 'report')) {
          option.selected = true;
        }
        variantSelect.append(option);
      }
      variantSelect.value = this.currentVariant || 'report';

      variantSelect.addEventListener('mousedown', event => event.stopPropagation());
      variantSelect.addEventListener('change', () => {
        const newVariant = variantSelect.value;
        const updatedText = updateDirectiveVariant(this.text, newVariant);
        if (updatedText !== this.text) {
          view.dispatch({
            changes: { from: this.from, to: this.from + this.text.length, insert: updatedText },
            annotations: isolateHistory.of('full'),
            userEvent: 'input.directive',
          });
          view.requestMeasure();
        }
      });
      toolbar.append(variantSelect);
    }

    // 3. Edit button (點擊後直接聚焦至內文展開原始 Markdown 編輯)
    const editButton = document.createElement('button');
    editButton.type = 'button';
    editButton.className = 'live-directive-edit-btn';
    editButton.title = '編輯內容 (Enter 編輯)';
    editButton.setAttribute('aria-label', '編輯內容');
    editButton.innerHTML = editIcon;

    const focusContent = () => {
      const firstLineBreak = this.text.indexOf('\n');
      const targetPos = firstLineBreak !== -1 ? this.from + firstLineBreak + 1 : this.from;
      view.dispatch({ selection: { anchor: targetPos } });
      view.focus();
    };

    editButton.addEventListener('mousedown', event => event.preventDefault());
    editButton.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      focusContent();
    });
    toolbar.append(editButton);

    root.prepend(toolbar);

    // Click anywhere on the directive body (outside interactive buttons/links/summary) to enter edit mode
    root.addEventListener('mousedown', event => {
      const target = event.target as HTMLElement;
      if (target.closest('button, select, input, textarea, a, summary, .live-directive-toolbar')) {
        return;
      }
      event.preventDefault();
      focusContent();
    });

    return root;
  }
}
