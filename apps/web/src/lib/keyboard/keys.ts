import type { KeyEnvironment, Platform } from './platform.js';

/** `Mod+Shift+P`, `F6`, `?`, `[`, or a sequence `g n`. `Mod` is Meta on macOS, Control elsewhere. */
export type KeyText = string;

export interface Chord {
  /** Normalized: a lower-case letter, a digit, punctuation, or a named key (`f6`, `escape`, `enter`, `arrowup`, `space`). */
  key: string;
  /** Physical fallback for letters, digits and unshifted punctuation (`KeyK`, `Slash`), filled by `parseKeys`. */
  code?: string;
  mod: boolean;
  shift: boolean;
  alt: boolean;
  /** Literal Control; on macOS a different key from Mod, elsewhere the same key. */
  ctrl: boolean;
}

export type ParsedKeys = { kind: 'chord'; chord: Chord; } | { kind: 'sequence'; chords: readonly Chord[]; };

export class KeyTextError extends Error {
  constructor(text: string, reason: string) {
    super(`Invalid key text "${text}": ${reason}`);
    this.name = 'KeyTextError';
  }
}

const NAMED_KEYS = ['escape', 'enter', 'tab', 'space', 'backspace', 'delete', 'home', 'end', 'pageup', 'pagedown', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', ...Array.from({ length: 12 }, (_, index) => `f${index + 1}`)];
const PUNCTUATION_CODES: Record<string, string> = { '/': 'Slash', '\\': 'Backslash', '[': 'BracketLeft', ']': 'BracketRight', ',': 'Comma', '.': 'Period', ';': 'Semicolon', "'": 'Quote', '`': 'Backquote', '-': 'Minus', '=': 'Equal' };
const LETTER = /^[a-z]$/;
const DIGIT = /^[0-9]$/;

function codeFor(key: string): string | undefined {
  if (LETTER.test(key)) return `Key${key.toUpperCase()}`;
  if (DIGIT.test(key)) return `Digit${key}`;
  return PUNCTUATION_CODES[key];
}

function parseChord(text: string, whole: string): Chord {
  if (!text) throw new KeyTextError(whole, 'empty chord');
  // A trailing `+` is the plus key itself: `+`, `Mod++`.
  const parts = text === '+' ? ['+'] : text.endsWith('++') ? [...text.slice(0, -2).split('+'), '+'] : text.split('+');
  const name = parts.pop()!;
  const chord: Chord = { key: '', mod: false, shift: false, alt: false, ctrl: false };
  for (const modifier of parts) {
    const flag = ({ Mod: 'mod', Shift: 'shift', Alt: 'alt', Ctrl: 'ctrl' } as const)[modifier];
    if (!flag) throw new KeyTextError(whole, `unknown modifier "${modifier}"`);
    if (chord[flag]) throw new KeyTextError(whole, `repeated modifier "${modifier}"`);
    chord[flag] = true;
  }
  if (name.length === 1) {
    if (/\s/.test(name)) throw new KeyTextError(whole, 'whitespace key');
    chord.key = name.toLowerCase();
  } else if (NAMED_KEYS.includes(name.toLowerCase())) chord.key = name.toLowerCase();
  else throw new KeyTextError(whole, `unknown key "${name}"`);
  const code = codeFor(chord.key);
  if (code) chord.code = code;
  return chord;
}

/** Parses key text; a space separates the chords of a sequence. Throws `KeyTextError` on malformed text. */
export function parseKeys(text: KeyText): ParsedKeys {
  const chords = text.trim().split(/\s+/).map(part => parseChord(part, text));
  return chords.length === 1 ? { kind: 'chord', chord: chords[0] } : { kind: 'sequence', chords };
}

export function chordsOf(keys: ParsedKeys): readonly Chord[] {
  return keys.kind === 'chord' ? [keys.chord] : keys.chords;
}

/** A stable identity for conflict checks: the same physical press gives the same id. */
export function chordId(chord: Chord): string {
  return [chord.ctrl && 'ctrl', chord.mod && 'mod', chord.shift && 'shift', chord.alt && 'alt', chord.key].filter(Boolean).join('+');
}

export function keysId(keys: ParsedKeys): string {
  return chordsOf(keys).map(chordId).join(' ');
}

/** Keys whose `event.key` is printable ASCII: letters, digits and punctuation. */
const isAsciiCharacter = (key: string) => key.length === 1 && key >= '!' && key <= '~';

/**
 * Letters and punctuation compare `event.key`, so a layout's own characters work; letters case-insensitively, since
 * macOS reports the lower-case letter with Shift held and Linux the upper-case one. A chord with a modifier falls back
 * to `event.code` when `event.key` is not ASCII (an IME's `Process`, `Unidentified`, another script, an Option
 * character). Shift is ignored for punctuation that does not ask for it, since the layout may need Shift to type it.
 */
export function matchesChord(event: KeyboardEvent, chord: Chord, env: KeyEnvironment): boolean {
  if (env.platform === 'mac') {
    if (event.metaKey !== chord.mod || event.ctrlKey !== chord.ctrl) return false;
  } else if (event.metaKey || event.ctrlKey !== (chord.mod || chord.ctrl)) return false;
  if (event.altKey !== chord.alt) return false;
  const key = event.key ?? '';
  if (NAMED_KEYS.includes(chord.key)) return event.shiftKey === chord.shift && (chord.key === 'space' ? key === ' ' : key.toLowerCase() === chord.key);
  const modified = chord.mod || chord.ctrl || chord.alt;
  if (LETTER.test(chord.key) || DIGIT.test(chord.key)) {
    if (event.shiftKey !== chord.shift) return false;
    if (isAsciiCharacter(key) && (LETTER.test(key.toLowerCase()) || DIGIT.test(key))) return key.toLowerCase() === chord.key;
    return modified && Boolean(chord.code) && event.code === chord.code;
  }
  if (chord.shift && !event.shiftKey) return false;
  if (key === chord.key) return true;
  return modified && !isAsciiCharacter(key) && Boolean(chord.code) && event.code === chord.code;
}

export function matchesKeys(event: KeyboardEvent, keys: ParsedKeys, env: KeyEnvironment): boolean {
  return keys.kind === 'chord' && matchesChord(event, keys.chord, env);
}

const NAMED_LABELS: Record<string, string> = { escape: 'Esc', enter: 'Enter', tab: 'Tab', space: 'Space', home: 'Home', end: 'End', pageup: 'Page Up', pagedown: 'Page Down', arrowup: '↑', arrowdown: '↓', arrowleft: '←', arrowright: '→' };

function keyLabel(key: string, platform: Platform): string {
  if (key === 'backspace') return platform === 'mac' ? '⌫' : 'Backspace';
  if (key === 'delete') return platform === 'mac' ? '⌦' : 'Delete';
  if (/^f\d+$/.test(key)) return key.toUpperCase();
  return NAMED_LABELS[key] ?? key.toUpperCase();
}

function chordLabel(chord: Chord, env: KeyEnvironment): string {
  const key = keyLabel(chord.key, env.platform);
  if (env.platform === 'mac') return `${chord.ctrl ? '⌃' : ''}${chord.mod ? '⌘' : ''}${chord.shift ? '⇧' : ''}${chord.alt ? '⌥' : ''}${key}`;
  return [(chord.mod || chord.ctrl) && 'Ctrl', chord.shift && 'Shift', chord.alt && 'Alt', key].filter(Boolean).join('+');
}

/** One label per chord: `['⌘⇧P']` or `['Ctrl+Shift+P']` or `['G', 'N']`. */
export function formatKeys(keys: ParsedKeys, env: KeyEnvironment): readonly string[] {
  return chordsOf(keys).map(chord => chordLabel(chord, env));
}

/** The keys as one line of text, the chords of a sequence joined by `then` (「接著」). */
export function describeKeys(keys: ParsedKeys, env: KeyEnvironment, then: string): string {
  return formatKeys(keys, env).join(` ${then} `);
}

/** UI Events key values, which both `aria-keyshortcuts` and CodeMirror key names use. */
const KEY_VALUES: Record<string, string> = { escape: 'Escape', enter: 'Enter', tab: 'Tab', space: 'Space', backspace: 'Backspace', delete: 'Delete', home: 'Home', end: 'End', pageup: 'PageUp', pagedown: 'PageDown', arrowup: 'ArrowUp', arrowdown: 'ArrowDown', arrowleft: 'ArrowLeft', arrowright: 'ArrowRight' };

/** The `aria-keyshortcuts` value (`Meta+Shift+F`, `Control+Shift+F`); undefined for sequences, which ARIA cannot express. */
export function ariaKeyShortcuts(keys: ParsedKeys, env: KeyEnvironment): string | undefined {
  if (keys.kind !== 'chord') return undefined;
  const { chord } = keys;
  const key = KEY_VALUES[chord.key] ?? chord.key.toUpperCase();
  const control = env.platform === 'mac' ? chord.ctrl : chord.mod || chord.ctrl;
  return [control && 'Control', env.platform === 'mac' && chord.mod && 'Meta', chord.shift && 'Shift', chord.alt && 'Alt', key].filter(Boolean).join('+');
}

/** CodeMirror's key name (`Mod-Shift-p`, `Ctrl-ArrowLeft`). Throws for sequences, which CodeMirror keymaps do not take. */
export function toCodeMirrorKey(keys: ParsedKeys): string {
  if (keys.kind !== 'chord') throw new KeyTextError(keysId(keys), 'CodeMirror keymaps take single chords');
  const { chord } = keys;
  const key = KEY_VALUES[chord.key] ?? (/^f\d+$/.test(chord.key) ? chord.key.toUpperCase() : chord.key);
  return [chord.ctrl && 'Ctrl', chord.mod && 'Mod', chord.shift && 'Shift', chord.alt && 'Alt', key].filter(Boolean).join('-');
}

/** No Mod, Ctrl or Alt in any chord: the keys the Settings switch and the "outside text fields" rule govern. */
export function isSingleKey(keys: ParsedKeys): boolean {
  return chordsOf(keys).every(chord => !chord.mod && !chord.ctrl && !chord.alt);
}

/**
 * Why the app must never take this chord on `platform`, or null. Browsers keep the tab and window chords
 * (`Mod+T/W/N/Q/L/R`, `Mod+Shift+T/N`, `Ctrl+Tab`, `Mod+1…9`); Ctrl+Alt is AltGr on Windows and Linux layouts; a bare
 * Option+letter types a character on macOS.
 */
export function bannedChordReason(chord: Chord, platform: Platform): string | null {
  const command = platform === 'mac' ? chord.mod : chord.mod || chord.ctrl;
  if (command && !chord.alt && !chord.shift && 'twnqlr'.includes(chord.key) && LETTER.test(chord.key)) return 'browser tab and window chord';
  if (command && chord.shift && !chord.alt && (chord.key === 't' || chord.key === 'n')) return 'browser reopen-tab and private-window chord';
  if ((chord.ctrl || (platform !== 'mac' && chord.mod)) && chord.key === 'tab') return 'browser tab switching';
  if (command && /^[1-9]$/.test(chord.key)) return 'browser tab selection';
  if (platform !== 'mac' && (chord.mod || chord.ctrl) && chord.alt && chord.key.length === 1) return 'Ctrl+Alt is AltGr';
  if (platform === 'mac' && chord.alt && !chord.mod && !chord.ctrl && LETTER.test(chord.key)) return 'Option+letter types a character';
  return null;
}
