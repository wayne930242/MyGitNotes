// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { ariaKeyShortcuts, bannedChordReason, describeKeys, formatKeys, isSingleKey, KeyTextError, matchesChord, matchesKeys, parseKeys, toCodeMirrorKey } from './keys.js';
import type { KeyEnvironment } from './platform.js';

const MAC: KeyEnvironment = { platform: 'mac', browser: 'chrome' };
const LINUX: KeyEnvironment = { platform: 'other', browser: 'firefox' };
const key = (init: KeyboardEventInit) => new KeyboardEvent('keydown', init);
const chord = (text: string) => {
  const parsed = parseKeys(text);
  if (parsed.kind !== 'chord') throw new Error('not a chord');
  return parsed.chord;
};

describe('parseKeys', () => {
  it('parses chords, named keys, punctuation and sequences', () => {
    expect(parseKeys('Mod+Shift+P')).toEqual({ kind: 'chord', chord: { key: 'p', code: 'KeyP', mod: true, shift: true, alt: false, ctrl: false } });
    expect(chord('F6')).toMatchObject({ key: 'f6', mod: false });
    expect(chord('?')).toEqual({ key: '?', mod: false, shift: false, alt: false, ctrl: false });
    expect(chord('Mod+/')).toMatchObject({ key: '/', code: 'Slash', mod: true });
    expect(chord('+')).toMatchObject({ key: '+' });
    expect(chord('Mod++')).toMatchObject({ key: '+', mod: true });
    expect(parseKeys('g n')).toMatchObject({ kind: 'sequence', chords: [{ key: 'g' }, { key: 'n' }] });
    expect(parseKeys('Mod+Shift+E /')).toMatchObject({ kind: 'sequence', chords: [{ key: 'e', mod: true, shift: true }, { key: '/' }] });
  });

  it('rejects malformed text', () => {
    expect(() => parseKeys('Hyper+K')).toThrow(KeyTextError);
    expect(() => parseKeys('Mod+Mod+K')).toThrow(KeyTextError);
    expect(() => parseKeys('Mod+Banana')).toThrow(KeyTextError);
  });
});

describe('matchesChord', () => {
  it('reads Mod as Command on macOS and Control elsewhere', () => {
    const palette = chord('Mod+Shift+P');
    expect(matchesChord(key({ key: 'p', metaKey: true, shiftKey: true }), palette, MAC)).toBe(true);
    expect(matchesChord(key({ key: 'p', ctrlKey: true, shiftKey: true }), palette, MAC)).toBe(false);
    expect(matchesChord(key({ key: 'P', ctrlKey: true, shiftKey: true }), palette, LINUX)).toBe(true);
    expect(matchesChord(key({ key: 'P', metaKey: true, ctrlKey: true, shiftKey: true }), palette, LINUX)).toBe(false);
  });

  it('matches letters case-insensitively: macOS reports the lower-case letter with Shift held, Linux the upper-case one', () => {
    const notes = chord('Mod+Shift+F');
    expect(matchesChord(key({ key: 'f', code: 'KeyF', metaKey: true, shiftKey: true }), notes, MAC)).toBe(true);
    expect(matchesChord(key({ key: 'F', code: 'KeyF', ctrlKey: true, shiftKey: true }), notes, LINUX)).toBe(true);
    expect(matchesChord(key({ key: 'f', code: 'KeyF', ctrlKey: true }), notes, LINUX)).toBe(false);
  });

  it('falls back to the physical key when an IME or another script hides the letter', () => {
    const palette = chord('Mod+K');
    expect(matchesChord(key({ key: 'Process', code: 'KeyK', metaKey: true }), palette, MAC)).toBe(true);
    expect(matchesChord(key({ key: 'л', code: 'KeyK', ctrlKey: true }), palette, LINUX)).toBe(true);
    // An ASCII letter in another place wins over the code: AZERTY's A sits on KeyQ.
    expect(matchesChord(key({ key: 'a', code: 'KeyQ', ctrlKey: true }), chord('Mod+Q'), LINUX)).toBe(false);
    // Without a modifier there is no fallback: a bare key is the character typed.
    expect(matchesChord(key({ key: 'Process', code: 'KeyN' }), chord('N'), LINUX)).toBe(false);
  });

  it('ignores Shift for punctuation that needs it, and uses the code for Mod+/ under an IME', () => {
    expect(matchesChord(key({ key: '?', shiftKey: true }), chord('?'), LINUX)).toBe(true);
    expect(matchesChord(key({ key: '/', shiftKey: true, ctrlKey: true }), chord('Mod+/'), LINUX)).toBe(true);
    expect(matchesChord(key({ key: '?', shiftKey: true, ctrlKey: true }), chord('Mod+/'), LINUX)).toBe(false);
    expect(matchesChord(key({ key: 'Process', code: 'Slash', metaKey: true }), chord('Mod+/'), MAC)).toBe(true);
  });

  it('requires the exact Shift and Alt state for letters and named keys', () => {
    expect(matchesChord(key({ key: 'F6', shiftKey: true }), chord('F6'), LINUX)).toBe(false);
    expect(matchesChord(key({ key: 'F6', shiftKey: true }), chord('Shift+F6'), LINUX)).toBe(true);
    expect(matchesChord(key({ key: 'e', metaKey: true, shiftKey: true, altKey: true }), chord('Mod+Shift+E'), MAC)).toBe(false);
    expect(matchesChord(key({ key: ' ', ctrlKey: true }), chord('Ctrl+Space'), MAC)).toBe(true);
  });

  it('never matches a sequence as one chord', () => {
    expect(matchesKeys(key({ key: 'g' }), parseKeys('g n'), LINUX)).toBe(false);
  });
});

describe('formatting', () => {
  it('shows macOS glyphs without separators and words with + elsewhere', () => {
    expect(formatKeys(parseKeys('Mod+Shift+P'), MAC)).toEqual(['⌘⇧P']);
    expect(formatKeys(parseKeys('Mod+Shift+P'), LINUX)).toEqual(['Ctrl+Shift+P']);
    expect(formatKeys(parseKeys('Shift+Alt+ArrowUp'), MAC)).toEqual(['⇧⌥↑']);
    expect(formatKeys(parseKeys('Shift+Alt+ArrowUp'), LINUX)).toEqual(['Shift+Alt+↑']);
    expect(formatKeys(parseKeys('Ctrl+ArrowLeft'), MAC)).toEqual(['⌃←']);
    expect(formatKeys(parseKeys('Escape'), MAC)).toEqual(['Esc']);
    expect(formatKeys(parseKeys('g n'), LINUX)).toEqual(['G', 'N']);
    expect(describeKeys(parseKeys('Mod+Shift+E F'), MAC, 'then')).toBe('⌘⇧E then F');
  });

  it('gives aria-keyshortcuts for single chords only', () => {
    expect(ariaKeyShortcuts(parseKeys('Mod+Shift+F'), MAC)).toBe('Meta+Shift+F');
    expect(ariaKeyShortcuts(parseKeys('Mod+Shift+F'), LINUX)).toBe('Control+Shift+F');
    expect(ariaKeyShortcuts(parseKeys('Mod+/'), LINUX)).toBe('Control+/');
    expect(ariaKeyShortcuts(parseKeys('g n'), LINUX)).toBeUndefined();
  });

  it('names keys the way CodeMirror keymaps do', () => {
    expect(toCodeMirrorKey(parseKeys('Mod+Shift+K'))).toBe('Mod-Shift-k');
    expect(toCodeMirrorKey(parseKeys('Ctrl+ArrowLeft'))).toBe('Ctrl-ArrowLeft');
    expect(toCodeMirrorKey(parseKeys('Mod+Alt+\\'))).toBe('Mod-Alt-\\');
    expect(toCodeMirrorKey(parseKeys('Ctrl+Space'))).toBe('Ctrl-Space');
    expect(() => toCodeMirrorKey(parseKeys('g n'))).toThrow(KeyTextError);
  });

  it('tells single keys from chords', () => {
    expect(isSingleKey(parseKeys('?'))).toBe(true);
    expect(isSingleKey(parseKeys('g n'))).toBe(true);
    expect(isSingleKey(parseKeys('Mod+/'))).toBe(false);
  });
});

describe('bannedChordReason', () => {
  it.each(['Mod+T', 'Mod+W', 'Mod+N', 'Mod+Q', 'Mod+L', 'Mod+R', 'Mod+Shift+T', 'Mod+Shift+N', 'Mod+1', 'Mod+9'])('rejects %s on every platform', text => {
    expect(bannedChordReason(chord(text), 'mac')).not.toBeNull();
    expect(bannedChordReason(chord(text), 'other')).not.toBeNull();
  });

  it('rejects Ctrl+Tab, AltGr chords on Windows and Linux, and Option+letter on macOS', () => {
    expect(bannedChordReason(chord('Ctrl+Tab'), 'mac')).not.toBeNull();
    expect(bannedChordReason(chord('Mod+Tab'), 'other')).not.toBeNull();
    expect(bannedChordReason(chord('Mod+Alt+K'), 'other')).not.toBeNull();
    expect(bannedChordReason(chord('Mod+Alt+K'), 'mac')).toBeNull();
    expect(bannedChordReason(chord('Alt+K'), 'mac')).not.toBeNull();
    expect(bannedChordReason(chord('Alt+K'), 'other')).toBeNull();
  });

  it('allows the chords the app takes', () => {
    for (const text of ['Mod+K', 'Mod+P', 'Mod+Shift+P', 'Mod+Shift+F', 'Mod+/', 'F1', 'F6', 'Mod+F6', 'Mod+Shift+E', '?']) {
      expect(bannedChordReason(chord(text), 'mac')).toBeNull();
      expect(bannedChordReason(chord(text), 'other')).toBeNull();
    }
  });
});
