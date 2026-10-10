import type { KeyScope } from './keymap.js';

const EDITABLE = 'input, textarea, select, [role="combobox"], [role="textbox"], [contenteditable]:not([contenteditable="false"]), .cm-content';

/** Focus is in a text field: an input, textarea, select, combobox, textbox, contenteditable or a CodeMirror editor. */
export function isEditableTarget(target: EventTarget | null): boolean {
  return typeof Element !== 'undefined' && target instanceof Element && Boolean(target.closest(EDITABLE));
}

export interface KeyContext {
  inText: boolean;
  /** The focused widget's scope, from the nearest `data-key-scope`; the editors mark their content with it. */
  scope: KeyScope | null;
}

export function readKeyContext(event: KeyboardEvent): KeyContext {
  const target = typeof Element !== 'undefined' && event.target instanceof Element ? event.target : null;
  return { inText: isEditableTarget(target), scope: (target?.closest('[data-key-scope]')?.getAttribute('data-key-scope') ?? null) as KeyScope | null };
}
