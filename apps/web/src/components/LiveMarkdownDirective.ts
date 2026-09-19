import { EditorView, WidgetType } from '@codemirror/view';
import { isolateHistory } from '@codemirror/commands';
import {
  DIRECTIVE_TEMPLATES,
  HANDOUT_VARIANTS,
  parseDirectiveModel,
  serializeDirectiveModel,
  type DirectiveModel,
} from '../lib/directives.js';
import { renderNote } from '../lib/markdown.js';
import type { TranslationKey } from '../lib/i18n/en.js';
import { DEFAULT_YOUTUBE_LABELS, youtubeLabels } from '../lib/youtube-embed.js';

type Translate = (key: TranslationKey, params?: Record<string, string | number>) => string;

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
    const model: DirectiveModel = parseDirectiveModel(this.text);

    const root = document.createElement('div');
    root.className = 'live-md-directive live-md-rendered prose-custom';
    root.contentEditable = 'false';
    root.dataset.directiveFrom = String(this.from);
    root.dataset.directiveType = model.type;

    if (this.readOnly) {
      root.innerHTML = renderNote(this.text, this.path, undefined, this.t ? youtubeLabels(this.t) : DEFAULT_YOUTUBE_LABELS);
      return root;
    }

    const saveChanges = (updatedModel: DirectiveModel) => {
      const newText = serializeDirectiveModel(updatedModel);
      if (newText !== this.text) {
        view.dispatch({
          changes: { from: this.from, to: this.from + this.text.length, insert: newText },
          annotations: isolateHistory.of('full'),
          userEvent: 'input.directive',
        });
        view.requestMeasure();
      }
    };

    // Render Preview Mode (Default)
    const renderPreview = () => {
      root.innerHTML = '';
      root.classList?.remove('live-directive-editing');

      // 1. Build Toolbar
      const toolbar = document.createElement('div');
      toolbar.className = 'live-directive-toolbar';
      toolbar.setAttribute('role', 'toolbar');
      toolbar.setAttribute('aria-label', 'Directive 區塊操作列');

      // Format Select
      const typeSelect = document.createElement('select');
      typeSelect.className = 'live-directive-type-select';
      typeSelect.title = '更換區塊格式';
      typeSelect.setAttribute('aria-label', '更換區塊格式');
      for (const tpl of DIRECTIVE_TEMPLATES) {
        const option = document.createElement('option');
        option.value = tpl.type;
        option.textContent = tpl.label;
        if (tpl.type === model.type) option.selected = true;
        typeSelect.append(option);
      }
      typeSelect.value = model.type;
      typeSelect.addEventListener('mousedown', event => event.stopPropagation());
      typeSelect.addEventListener('change', () => {
        model.type = typeSelect.value;
        saveChanges(model);
      });
      toolbar.append(typeSelect);

      // Document style select (the handout type name remains for syntax compatibility)
      if (model.type === 'handout') {
        const variantSelect = document.createElement('select');
        variantSelect.className = 'live-directive-variant-select';
        variantSelect.title = '更換文件樣式';
        variantSelect.setAttribute('aria-label', '更換文件樣式');
        for (const [vKey, vLabel] of Object.entries(HANDOUT_VARIANTS)) {
          const option = document.createElement('option');
          option.value = vKey;
          option.textContent = vLabel;
          if (vKey === (model.attrs.variant || 'report')) option.selected = true;
          variantSelect.append(option);
        }
        variantSelect.value = model.attrs.variant || 'report';
        variantSelect.addEventListener('mousedown', event => event.stopPropagation());
        variantSelect.addEventListener('change', () => {
          model.attrs.variant = variantSelect.value;
          saveChanges(model);
        });
        toolbar.append(variantSelect);
      }

      // Title input field on toolbar for fast renaming
      const titleInput = document.createElement('input');
      titleInput.type = 'text';
      titleInput.className = 'live-directive-title-input';
      titleInput.placeholder = model.type === 'coc-stat' ? '人物名稱...' : '自訂標題...';
      titleInput.title = '自訂標題';
      titleInput.value = model.title;
      titleInput.setAttribute('aria-label', '自訂標題');

      titleInput.addEventListener('mousedown', event => event.stopPropagation());
      const commitTitle = () => {
        if (titleInput.value !== model.title) {
          model.title = titleInput.value;
          saveChanges(model);
        }
      };
      titleInput.addEventListener('blur', commitTitle);
      titleInput.addEventListener('keydown', event => {
        if (event.key === 'Enter') {
          event.preventDefault();
          commitTitle();
          titleInput.blur();
        } else if (event.key === 'Escape') {
          event.preventDefault();
          titleInput.value = model.title;
          titleInput.blur();
        }
      });
      toolbar.append(titleInput);

      // Edit body button (明確文字「編輯內文」)
      const editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.className = 'live-directive-edit-btn';
      editBtn.textContent = '編輯內文';
      editBtn.title = '開啟完整編輯表單';
      editBtn.setAttribute('aria-label', '開啟完整編輯表單');

      editBtn.addEventListener('mousedown', event => event.preventDefault());
      editBtn.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        renderEditForm();
      });
      toolbar.append(editBtn);

      // 2. Render Card Content
      const contentContainer = document.createElement('div');
      contentContainer.className = 'live-directive-preview-content';
      contentContainer.innerHTML = renderNote(this.text, this.path, undefined, this.t ? youtubeLabels(this.t) : DEFAULT_YOUTUBE_LABELS);

      // Double click to enter edit form
      contentContainer.addEventListener('dblclick', event => {
        if ((event.target as HTMLElement).closest('button, select, input, a, summary')) return;
        event.preventDefault();
        renderEditForm();
      });

      root.append(toolbar, contentContainer);
    };

    // Render Full Inline Form Editor
    const renderEditForm = () => {
      root.innerHTML = '';
      root.classList?.add('live-directive-editing');

      const panel = document.createElement('div');
      panel.className = 'live-directive-editor-panel';

      // Header
      const header = document.createElement('div');
      header.className = 'live-directive-editor-header';
      const badge = document.createElement('span');
      badge.className = 'live-directive-editor-badge';
      badge.textContent = `編輯區塊：${model.type.toUpperCase()}`;
      header.append(badge);

      // Form Row 1: Type & Title
      const row1 = document.createElement('div');
      row1.className = 'live-directive-form-row';

      const typeField = document.createElement('div');
      typeField.className = 'live-directive-form-field';
      const typeLabel = document.createElement('label');
      typeLabel.textContent = '區塊格式';
      const formTypeSelect = document.createElement('select');
      for (const tpl of DIRECTIVE_TEMPLATES) {
        const option = document.createElement('option');
        option.value = tpl.type;
        option.textContent = tpl.label;
        if (tpl.type === model.type) option.selected = true;
        formTypeSelect.append(option);
      }
      formTypeSelect.value = model.type;
      typeField.append(typeLabel, formTypeSelect);

      const titleField = document.createElement('div');
      titleField.className = 'live-directive-form-field';
      const titleLabel = document.createElement('label');
      titleLabel.textContent = model.type === 'coc-stat' ? '人物名稱 (Name)' : '區塊標題 (Title)';
      const formTitleInput = document.createElement('input');
      formTitleInput.type = 'text';
      formTitleInput.value = model.title;
      formTitleInput.placeholder = '輸入標題...';
      titleField.append(titleLabel, formTitleInput);

      row1.append(typeField, titleField);

      // Form Row 2 (document / stats compatibility fields)
      let row2: HTMLDivElement | null = null;
      let handoutIdInput: HTMLInputElement | null = null;
      let handoutKeeperInput: HTMLInputElement | null = null;
      let handoutVariantSelect: HTMLSelectElement | null = null;
      let cocRoleInput: HTMLInputElement | null = null;

      if (model.type === 'handout') {
        row2 = document.createElement('div');
        row2.className = 'live-directive-form-row';

        const idField = document.createElement('div');
        idField.className = 'live-directive-form-field';
        const idLabel = document.createElement('label');
        idLabel.textContent = '文件編號 (ID)';
        handoutIdInput = document.createElement('input');
        handoutIdInput.type = 'text';
        handoutIdInput.value = model.attrs.id || 'DOC-01';
        idField.append(idLabel, handoutIdInput);

        const variantField = document.createElement('div');
        variantField.className = 'live-directive-form-field';
        const variantLabel = document.createElement('label');
        variantLabel.textContent = '文件樣式 (Variant)';
        handoutVariantSelect = document.createElement('select');
        for (const [k, v] of Object.entries(HANDOUT_VARIANTS)) {
          const opt = document.createElement('option');
          opt.value = k;
          opt.textContent = v;
          if (k === (model.attrs.variant || 'report')) opt.selected = true;
          handoutVariantSelect.append(opt);
        }
        handoutVariantSelect.value = model.attrs.variant || 'report';
        variantField.append(variantLabel, handoutVariantSelect);

        const keeperField = document.createElement('div');
        keeperField.className = 'live-directive-form-field';
        const keeperLabel = document.createElement('label');
        keeperLabel.textContent = '編輯備註 (Editor Note)';
        handoutKeeperInput = document.createElement('input');
        handoutKeeperInput.type = 'text';
        handoutKeeperInput.value = model.attrs.keeper || '';
        handoutKeeperInput.placeholder = '例如：來源、使用時機或編輯說明...';
        keeperField.append(keeperLabel, handoutKeeperInput);

        row2.append(idField, variantField, keeperField);
      } else if (model.type === 'coc-stat') {
        row2 = document.createElement('div');
        row2.className = 'live-directive-form-row';

        const roleField = document.createElement('div');
        roleField.className = 'live-directive-form-field';
        const roleLabel = document.createElement('label');
        roleLabel.textContent = '身分／類別 (Role)';
        cocRoleInput = document.createElement('input');
        cocRoleInput.type = 'text';
        cocRoleInput.value = model.attrs.role || '';
        cocRoleInput.placeholder = '例如：研究者、講者、專案負責人...';
        roleField.append(roleLabel, cocRoleInput);

        row2.append(roleField);
      }

      // Body editor
      const bodyLabel = document.createElement('label');
      bodyLabel.className = 'live-directive-body-label';
      bodyLabel.textContent = '區塊正文內容 (支援 Markdown)';

      const bodyTextarea = document.createElement('textarea');
      bodyTextarea.className = 'live-directive-body-editor';
      bodyTextarea.value = model.body;
      bodyTextarea.placeholder = '在此輸入內容...';

      // Footer Actions
      const footer = document.createElement('div');
      footer.className = 'live-directive-editor-footer';

      const hint = document.createElement('span');
      hint.className = 'live-directive-editor-hint';
      hint.textContent = 'Enter 換行 · ⌘/Ctrl+Enter 完成儲存 · Esc 取消';

      const actions = document.createElement('div');
      actions.className = 'live-directive-editor-actions';

      const cancelBtn = document.createElement('button');
      cancelBtn.type = 'button';
      cancelBtn.className = 'live-directive-btn-cancel';
      cancelBtn.textContent = '取消';
      cancelBtn.addEventListener('click', () => renderPreview());

      const saveBtn = document.createElement('button');
      saveBtn.type = 'button';
      saveBtn.className = 'live-directive-btn-save';
      saveBtn.textContent = '完成儲存';

      const commitForm = () => {
        model.type = formTypeSelect.value;
        model.title = formTitleInput.value;
        model.body = bodyTextarea.value;
        if (handoutIdInput) model.attrs.id = handoutIdInput.value;
        if (handoutVariantSelect) model.attrs.variant = handoutVariantSelect.value;
        if (handoutKeeperInput) model.attrs.keeper = handoutKeeperInput.value;
        if (cocRoleInput) model.attrs.role = cocRoleInput.value;

        saveChanges(model);
        renderPreview();
      };

      saveBtn.addEventListener('click', commitForm);

      panel.addEventListener('keydown', event => {
        if (event.key === 'Escape') {
          event.preventDefault();
          renderPreview();
        } else if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
          event.preventDefault();
          commitForm();
        }
      });

      actions.append(cancelBtn, saveBtn);
      footer.append(hint, actions);

      panel.append(header, row1);
      if (row2) panel.append(row2);
      panel.append(bodyLabel, bodyTextarea, footer);

      root.append(panel);
      if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(() => bodyTextarea.focus?.());
      } else {
        setTimeout(() => bodyTextarea.focus?.(), 0);
      }
    };

    renderPreview();
    return root;
  }
}
