import { hydrateMermaid, renderMermaidBlocks, createMermaidBlock, currentAppearance } from './mermaid.js';

export interface MermaidEditorLabels {
  title: string;
  source: string;
  preview: string;
  save: string;
  cancel: string;
  error: string;
}

export interface MermaidEditorOptions {
  source: string;
  labels: MermaidEditorLabels;
  /** Returns a message to keep the dialog open with the write refused. */
  onSave: (source: string) => string | void;
  /** Runs after the dialog closes, whether the diagram was saved or not. */
  onClose: () => void;
}

const PREVIEW_DELAY_MS = 250;

/** A split view for one diagram: source on one side, a live preview with readable render errors on the other. */
export function openMermaidEditor({ source, labels, onSave, onClose }: MermaidEditorOptions): void {
  const overlay = document.createElement('div');
  overlay.className = 'mermaid-editor-overlay viewport-overlay';
  const dialog = document.createElement('div');
  dialog.className = 'mermaid-editor ui-dialog';
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-label', labels.title);

  const header = document.createElement('header');
  const title = document.createElement('h2');
  title.textContent = labels.title;
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'ui-button';
  cancel.textContent = labels.cancel;
  const save = document.createElement('button');
  save.type = 'button';
  save.className = 'ui-button ui-button-primary';
  save.textContent = labels.save;
  header.append(title, cancel, save);

  const body = document.createElement('div');
  body.className = 'mermaid-editor-body';
  const sourcePane = document.createElement('label');
  sourcePane.className = 'mermaid-editor-pane';
  const sourceHeading = document.createElement('span');
  sourceHeading.textContent = labels.source;
  const textarea = document.createElement('textarea');
  textarea.className = 'mermaid-editor-source';
  textarea.spellcheck = false;
  textarea.value = source;
  sourcePane.append(sourceHeading, textarea);
  const previewPane = document.createElement('section');
  previewPane.className = 'mermaid-editor-pane';
  previewPane.setAttribute('aria-label', labels.preview);
  const previewHeading = document.createElement('span');
  previewHeading.textContent = labels.preview;
  const preview = document.createElement('div');
  preview.className = 'mermaid-editor-preview prose-custom';
  const block = createMermaidBlock(source);
  preview.append(block);
  previewPane.append(previewHeading, preview);
  body.append(sourcePane, previewPane);
  const notice = document.createElement('p');
  notice.className = 'mermaid-editor-notice';
  notice.setAttribute('role', 'alert');
  notice.hidden = true;
  dialog.append(header, notice, body);
  overlay.append(dialog);

  const options = { errorLabel: labels.error };
  const stopWatching = hydrateMermaid(preview, options);
  let timer: ReturnType<typeof setTimeout> | undefined;
  textarea.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      block.dataset.mermaidSource = textarea.value;
      void renderMermaidBlocks(preview, currentAppearance(), options);
    }, PREVIEW_DELAY_MS);
  });

  const close = () => {
    clearTimeout(timer);
    stopWatching();
    document.removeEventListener('keydown', onKeyDown, true);
    overlay.remove();
    onClose();
  };
  const commit = () => {
    const refusal = onSave(textarea.value);
    if (refusal) {
      notice.textContent = refusal;
      notice.hidden = false;
      return;
    }
    close();
  };
  function onKeyDown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close();
    } else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      event.stopPropagation();
      commit();
    }
  }
  cancel.addEventListener('click', close);
  save.addEventListener('click', commit);
  overlay.addEventListener('mousedown', event => {
    if (event.target === overlay) close();
  });
  document.addEventListener('keydown', onKeyDown, true);
  document.body.append(overlay);
  textarea.focus();
}
