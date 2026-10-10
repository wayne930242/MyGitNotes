import type { TranslationKey } from '../i18n/en.js';
import { type KeyText, matchesKeys, type ParsedKeys, parseKeys } from './keys.js';
import { type Browser, type KeyEnvironment, keyEnvironment, type Platform } from './platform.js';

/** Where a key acts. `global` covers every other scope, including text fields and editors. */
export type KeyScope = 'global' | 'palette' | 'help' | 'note' | 'markdown-editor' | 'code-editor' | 'link-completion' | 'outline-panel' | 'find-panel' | 'document-panel' | 'focus-tabs' | 'focus-division' | 'table' | 'directive' | 'image' | 'graph' | 'assistant-input' | 'file-list' | 'drawer' | 'compilation' | 'asset-preview';

/** Who acts on the key: the global dispatcher, a CodeMirror keymap built from this table, or a widget's own handler. */
export type KeyHandler = 'dispatcher' | 'codemirror' | 'widget';
export type ShortcutGroup = 'general' | 'goTo' | 'palette' | 'panes' | 'list' | 'editor' | 'find' | 'focus' | 'outline' | 'table' | 'graph' | 'image' | 'edition';

/** Help and palette order. */
export const SHORTCUT_GROUPS: readonly ShortcutGroup[] = ['general', 'goTo', 'palette', 'panes', 'list', 'editor', 'find', 'focus', 'outline', 'table', 'graph', 'image', 'edition'];

export interface BindingCondition {
  platforms?: readonly Platform[];
  browsers?: readonly Browser[];
  exceptBrowsers?: readonly Browser[];
  /** Scopes where the binding gives way to the focused widget (Mod+/ in the code-file editor toggles a comment). */
  exceptScopes?: readonly KeyScope[];
}

export interface KeyBinding {
  keys: KeyText;
  when?: BindingCondition;
}

export interface KeymapEntry {
  /** `palette.notes`, `editor.undo`, `table.editCell`. */
  id: string;
  group: ShortcutGroup;
  scopes: readonly KeyScope[];
  handler: KeyHandler;
  /** Every applicable binding is shown and handled; the first is the one a tooltip names. */
  bindings: readonly KeyBinding[];
  title: TranslationKey;
  description?: TranslationKey;
  /** Dispatcher entries only: capture runs before CodeMirror and focused widgets. */
  phase?: 'capture' | 'bubble';
}

type EntryOptions = Partial<Pick<KeymapEntry, 'description' | 'phase'>>;

const entry = (id: string, group: ShortcutGroup, scopes: readonly KeyScope[], handler: KeyHandler, bindings: readonly (KeyText | KeyBinding)[], options: EntryOptions = {}): KeymapEntry => ({ id, group, scopes, handler, bindings: bindings.map(binding => typeof binding === 'string' ? { keys: binding } : binding), title: `command.${id}` as TranslationKey, ...options });
const mac = (keys: KeyText): KeyBinding => ({ keys, when: { platforms: ['mac'] } });
const other = (keys: KeyText): KeyBinding => ({ keys, when: { platforms: ['other'] } });

const EDITORS: readonly KeyScope[] = ['markdown-editor', 'code-editor'];
const MARKDOWN: readonly KeyScope[] = ['markdown-editor'];
const CODE: readonly KeyScope[] = ['code-editor'];

/** Every key the app handles. Help, tooltips, `aria-keyshortcuts`, the dispatcher and the editors' CodeMirror keymaps read it. */
export const KEYMAP: readonly KeymapEntry[] = [
  // General
  entry('help.open', 'general', ['global'], 'dispatcher', [{ keys: 'Mod+/', when: { exceptScopes: ['code-editor'] } }], { phase: 'capture', description: 'command.help.open.describe' }),
  entry('help.close', 'general', ['help'], 'widget', ['Escape']),
  entry('drawer.close', 'panes', ['drawer'], 'widget', ['Escape']),
  entry('compilation.close', 'general', ['compilation'], 'widget', ['Escape']),
  entry('files.open', 'list', ['file-list'], 'widget', ['Enter']),
  // Quick open
  entry('palette.notes', 'palette', ['global'], 'dispatcher', ['Mod+Shift+F'], { phase: 'capture', description: 'command.palette.notes.describe' }),
  entry('palette.commands', 'palette', ['global'], 'dispatcher', ['Mod+Shift+P'], { phase: 'capture', description: 'command.palette.commands.describe' }),
  entry('palette.commandMode', 'palette', ['palette'], 'widget', ['>', '/']),
  entry('palette.move', 'palette', ['palette'], 'widget', ['ArrowUp', 'ArrowDown']),
  entry('palette.run', 'palette', ['palette'], 'widget', ['Enter']),
  entry('palette.close', 'palette', ['palette'], 'widget', ['Escape']),
  // Note editor: the leader and the note's tools
  entry('editor.leader', 'editor', ['note'], 'widget', ['Mod+Shift+E'], { description: 'command.editor.leader.describe' }),
  entry('note.closePanel', 'editor', ['note'], 'widget', ['Escape']),
  entry('format.bold', 'editor', MARKDOWN, 'codemirror', ['Mod+B']),
  entry('format.italic', 'editor', MARKDOWN, 'codemirror', ['Mod+I']),
  entry('format.underline', 'editor', MARKDOWN, 'codemirror', ['Mod+U']),
  entry('editor.undo', 'editor', EDITORS, 'codemirror', ['Mod+Z']),
  entry('editor.redo', 'editor', EDITORS, 'codemirror', [mac('Mod+Shift+Z'), other('Mod+Y'), other('Mod+Shift+Z')]),
  entry('editor.undoSelection', 'editor', CODE, 'codemirror', ['Mod+U']),
  entry('editor.redoSelection', 'editor', CODE, 'codemirror', [mac('Mod+Shift+U'), other('Alt+U')]),
  entry('editor.textNavigation', 'editor', EDITORS, 'codemirror', ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown']),
  entry('editor.syntaxLeft', 'editor', EDITORS, 'codemirror', [mac('Ctrl+ArrowLeft'), other('Alt+ArrowLeft')]),
  entry('editor.syntaxRight', 'editor', EDITORS, 'codemirror', [mac('Ctrl+ArrowRight'), other('Alt+ArrowRight')]),
  entry('editor.moveLineUp', 'editor', EDITORS, 'codemirror', ['Alt+ArrowUp']),
  entry('editor.moveLineDown', 'editor', EDITORS, 'codemirror', ['Alt+ArrowDown']),
  entry('editor.copyLineUp', 'editor', EDITORS, 'codemirror', ['Shift+Alt+ArrowUp']),
  entry('editor.copyLineDown', 'editor', EDITORS, 'codemirror', ['Shift+Alt+ArrowDown']),
  entry('editor.addCursorAbove', 'editor', EDITORS, 'codemirror', ['Mod+Alt+ArrowUp']),
  entry('editor.addCursorBelow', 'editor', EDITORS, 'codemirror', ['Mod+Alt+ArrowDown']),
  entry('editor.simplifySelection', 'editor', EDITORS, 'codemirror', ['Escape']),
  entry('editor.insertBlankLine', 'editor', EDITORS, 'codemirror', ['Mod+Enter']),
  entry('editor.selectLine', 'editor', EDITORS, 'codemirror', [mac('Ctrl+L'), other('Alt+L')]),
  entry('editor.selectParent', 'editor', CODE, 'codemirror', ['Mod+I']),
  entry('editor.indentLess', 'editor', EDITORS, 'codemirror', ['Mod+[']),
  entry('editor.indentMore', 'editor', EDITORS, 'codemirror', ['Mod+]']),
  entry('editor.indentSelection', 'editor', EDITORS, 'codemirror', ['Mod+Alt+\\']),
  entry('editor.indentTab', 'editor', CODE, 'codemirror', ['Tab']),
  entry('editor.outdentTab', 'editor', CODE, 'codemirror', ['Shift+Tab']),
  entry('editor.deleteLine', 'editor', EDITORS, 'codemirror', ['Mod+Shift+K']),
  entry('editor.matchingBracket', 'editor', EDITORS, 'codemirror', ['Mod+Shift+\\']),
  entry('editor.toggleLineComment', 'editor', CODE, 'codemirror', ['Mod+/']),
  entry('editor.toggleComment', 'editor', EDITORS, 'codemirror', [mac('Ctrl+Shift+A'), other('Shift+Alt+A')]),
  entry('editor.tabFocusMode', 'editor', EDITORS, 'codemirror', [mac('Shift+Alt+M'), other('Ctrl+M')]),
  entry('completion.start', 'editor', MARKDOWN, 'codemirror', ['Ctrl+Space', mac('Alt+`'), mac('Alt+I')]),
  entry('completion.move', 'editor', ['link-completion'], 'codemirror', ['ArrowUp', 'ArrowDown']),
  entry('completion.page', 'editor', ['link-completion'], 'codemirror', ['PageUp', 'PageDown']),
  entry('completion.accept', 'editor', ['link-completion'], 'codemirror', ['Enter']),
  entry('completion.close', 'editor', ['link-completion'], 'codemirror', ['Escape']),
  entry('directive.save', 'editor', ['directive'], 'widget', ['Mod+Enter']),
  entry('directive.cancel', 'editor', ['directive'], 'widget', ['Escape']),
  // Find
  entry('editor.leaderFind', 'find', ['note'], 'widget', ['Mod+Shift+E F']),
  entry('find.next', 'find', ['find-panel'], 'widget', ['Enter']),
  entry('find.previous', 'find', ['find-panel'], 'widget', ['Shift+Enter']),
  // Panes and panels
  entry('documentTabs.move', 'panes', ['document-panel'], 'widget', ['ArrowLeft', 'ArrowRight', 'Home', 'End']),
  entry('assistant.send', 'panes', ['assistant-input'], 'widget', ['Enter']),
  entry('assistant.newline', 'panes', ['assistant-input'], 'widget', ['Shift+Enter']),
  entry('assistant.complete', 'panes', ['assistant-input'], 'widget', ['Tab']),
  entry('assistant.menu', 'panes', ['assistant-input'], 'widget', ['ArrowUp', 'ArrowDown']),
  entry('assistant.dismiss', 'panes', ['assistant-input'], 'widget', ['Escape']),
  // Focus
  entry('focusTabs.move', 'focus', ['focus-tabs'], 'widget', ['ArrowLeft', 'ArrowRight', 'Home', 'End']),
  entry('focusTabs.close', 'focus', ['focus-tabs'], 'widget', ['Delete']),
  entry('focusDivision.move', 'focus', ['focus-division'], 'widget', ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']),
  // Outline
  entry('editor.leaderOutline', 'outline', ['note'], 'widget', ['Mod+Shift+E /']),
  entry('outlinePanel.next', 'outline', ['outline-panel'], 'widget', ['J', 'ArrowDown']),
  entry('outlinePanel.previous', 'outline', ['outline-panel'], 'widget', ['K', 'ArrowUp']),
  entry('outlinePanel.jump', 'outline', ['outline-panel'], 'widget', ['Enter']),
  entry('outline.sibling', 'outline', MARKDOWN, 'codemirror', ['Enter']),
  entry('outline.annotation', 'outline', MARKDOWN, 'codemirror', ['Shift+Enter']),
  entry('outline.indent', 'outline', MARKDOWN, 'codemirror', ['Tab']),
  entry('outline.outdent', 'outline', MARKDOWN, 'codemirror', ['Shift+Tab']),
  // Table
  entry('table.crossBoundary', 'table', MARKDOWN, 'codemirror', ['Backspace', 'Delete']),
  entry('table.editCell', 'table', ['table'], 'widget', ['Enter', 'F2']),
  entry('table.save', 'table', ['table'], 'widget', ['Mod+Enter']),
  entry('table.cancel', 'table', ['table'], 'widget', ['Escape']),
  entry('table.nextCell', 'table', ['table'], 'widget', ['Tab']),
  entry('table.previousCell', 'table', ['table'], 'widget', ['Shift+Tab']),
  entry('table.undo', 'table', ['table'], 'widget', ['Mod+Z']),
  entry('table.redo', 'table', ['table'], 'widget', ['Mod+Shift+Z']),
  // Graph
  entry('graph.toggleExpand', 'graph', ['graph'], 'widget', ['Enter']),
  entry('graph.closeFilters', 'graph', ['graph'], 'widget', ['Escape']),
  // Image viewer and file preview
  entry('image.close', 'image', ['image'], 'widget', ['Escape']),
  entry('image.zoomIn', 'image', ['image'], 'widget', ['+', '=']),
  entry('image.zoomOut', 'image', ['image'], 'widget', ['-']),
  entry('image.fit', 'image', ['image'], 'widget', ['0']),
  entry('image.actualSize', 'image', ['image'], 'widget', ['1']),
  entry('assetPreview.close', 'image', ['asset-preview'], 'widget', ['Escape']),
];

const BY_ID = new Map(KEYMAP.map(item => [item.id, item]));
const PARSED = new Map(KEYMAP.flatMap(item => item.bindings).map(binding => [binding, parseKeys(binding.keys)]));

export class UnknownKeymapEntryError extends Error {
  constructor(id: string) {
    super(`No keymap entry "${id}"`);
    this.name = 'UnknownKeymapEntryError';
  }
}

export function keymapEntry(id: string): KeymapEntry {
  const found = BY_ID.get(id);
  if (!found) throw new UnknownKeymapEntryError(id);
  return found;
}

export function hasKeymapEntry(id: string): boolean {
  return BY_ID.has(id);
}

/** Whether `binding` exists in `env`; scope exceptions are a matter of where focus is and are checked by the caller. */
export function bindingApplies(binding: KeyBinding, env: KeyEnvironment): boolean {
  const when = binding.when;
  if (!when) return true;
  if (when.platforms && !when.platforms.includes(env.platform)) return false;
  if (when.browsers && !when.browsers.includes(env.browser)) return false;
  return !when.exceptBrowsers?.includes(env.browser);
}

export function parsedBinding(binding: KeyBinding): ParsedKeys {
  return PARSED.get(binding) ?? parseKeys(binding.keys);
}

/** The entry's bindings in `env`, in table order. */
export function bindingsFor(item: KeymapEntry, env: KeyEnvironment = keyEnvironment): readonly ParsedKeys[] {
  return item.bindings.filter(binding => bindingApplies(binding, env)).map(parsedBinding);
}

/** Whether `event` presses one of the entry's single-chord bindings; widgets read their keys through this. */
export function matchesCommand(event: KeyboardEvent, id: string, env: KeyEnvironment = keyEnvironment): boolean {
  return bindingsFor(keymapEntry(id), env).some(keys => matchesKeys(event, keys, env));
}
