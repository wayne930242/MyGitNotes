import { addCursorAbove, addCursorBelow, copyLineDown, copyLineUp, cursorMatchingBracket, cursorSyntaxLeft, cursorSyntaxRight, deleteLine, indentLess, indentMore, indentSelection, insertBlankLine, moveLineDown, moveLineUp, redo, redoSelection, selectLine, selectParentSyntax, selectSyntaxLeft, selectSyntaxRight, simplifySelection, standardKeymap, toggleBlockComment, toggleComment, toggleTabFocusMode, undo, undoSelection } from '@codemirror/commands';
import { type Command, type KeyBinding, keymap } from '@codemirror/view';
import { toCodeMirrorKey } from '../../lib/keyboard/keys.js';
import { bindingsFor, keymapEntry, type KeyScope } from '../../lib/keyboard/keymap.js';
import { type KeyEnvironment, keyEnvironment } from '../../lib/keyboard/platform.js';

/** The CodeMirror command a KEYMAP entry runs; `shift` runs when Shift is added to the entry's key. */
export interface CodeMirrorCommand {
  run: Command;
  shift?: Command;
  preventDefault?: boolean;
}

export class CodeMirrorKeymapError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CodeMirrorKeymapError';
  }
}

/** Installs each paired entry's bindings for `env`; an id that is not a CodeMirror entry of `scope` is a table error. */
export function codeMirrorBindings(scope: KeyScope, commands: Readonly<Record<string, CodeMirrorCommand>>, env: KeyEnvironment = keyEnvironment): KeyBinding[] {
  return Object.entries(commands).flatMap(([id, command]) => {
    const entry = keymapEntry(id);
    if (entry.handler !== 'codemirror' || !entry.scopes.includes(scope)) throw new CodeMirrorKeymapError(`"${id}" is not a CodeMirror key of ${scope}`);
    return bindingsFor(entry, env).map(keys => ({ key: toCodeMirrorKey(keys), ...command }));
  });
}

/** CodeMirror's editing commands both editors share; the Markdown editor binds Mod-/ to help and Mod-i, Mod-u to formatting instead. */
const SHARED: Readonly<Record<string, CodeMirrorCommand>> = { 'editor.undo': { run: undo, preventDefault: true }, 'editor.redo': { run: redo, preventDefault: true }, 'editor.syntaxLeft': { run: cursorSyntaxLeft, shift: selectSyntaxLeft }, 'editor.syntaxRight': { run: cursorSyntaxRight, shift: selectSyntaxRight }, 'editor.moveLineUp': { run: moveLineUp }, 'editor.moveLineDown': { run: moveLineDown }, 'editor.copyLineUp': { run: copyLineUp }, 'editor.copyLineDown': { run: copyLineDown }, 'editor.addCursorAbove': { run: addCursorAbove }, 'editor.addCursorBelow': { run: addCursorBelow }, 'editor.simplifySelection': { run: simplifySelection }, 'editor.insertBlankLine': { run: insertBlankLine }, 'editor.selectLine': { run: selectLine }, 'editor.indentLess': { run: indentLess }, 'editor.indentMore': { run: indentMore }, 'editor.indentSelection': { run: indentSelection }, 'editor.deleteLine': { run: deleteLine }, 'editor.matchingBracket': { run: cursorMatchingBracket }, 'editor.toggleComment': { run: toggleBlockComment }, 'editor.tabFocusMode': { run: toggleTabFocusMode } };

const CODE_ONLY: Readonly<Record<string, CodeMirrorCommand>> = { 'editor.undoSelection': { run: undoSelection, preventDefault: true }, 'editor.redoSelection': { run: redoSelection, preventDefault: true }, 'editor.selectParent': { run: selectParentSyntax, preventDefault: true }, 'editor.toggleLineComment': { run: toggleComment }, 'editor.indentTab': { run: indentMore }, 'editor.outdentTab': { run: indentLess } };

// Both keymaps end with `standardKeymap` (cursor motion, selection, Enter, Backspace, select all), installed whole and
// documented by the `editor.textNavigation` entry.

/** The Markdown editor's editing keys, in place of CodeMirror's `defaultKeymap` and `historyKeymap`. */
export const markdownEditorKeymap = (env: KeyEnvironment = keyEnvironment) => keymap.of([...codeMirrorBindings('markdown-editor', SHARED, env), ...standardKeymap]);

/** The code-file editor's keys: the shared ones plus Mod-/ line comments, Tab indentation and selection history. */
export const codeEditorKeymap = (env: KeyEnvironment = keyEnvironment) => keymap.of([...codeMirrorBindings('code-editor', { ...SHARED, ...CODE_ONLY }, env), ...standardKeymap]);
