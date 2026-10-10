import { describe, expect, it } from 'vitest';
import { en } from '../i18n/en.js';
import { zhTW } from '../i18n/zh-TW.js';
import { bannedChordReason, chordsOf, keysId } from './keys.js';
import { bindingApplies, KEYMAP, type KeyScope, parsedBinding } from './keymap.js';
import type { Browser, KeyEnvironment, Platform } from './platform.js';

const ENVIRONMENTS: KeyEnvironment[] = (['mac', 'other'] as Platform[]).flatMap(platform => (['chrome', 'edge', 'firefox', 'safari', 'other'] as Browser[]).map(browser => ({ platform, browser })));

describe('KEYMAP', () => {
  it('has unique ids and parses every binding', () => {
    expect(new Set(KEYMAP.map(entry => entry.id)).size).toBe(KEYMAP.length);
    for (const entry of KEYMAP) {
      expect(entry.bindings.length, entry.id).toBeGreaterThan(0);
      for (const binding of entry.bindings) expect(() => parsedBinding(binding), `${entry.id} ${binding.keys}`).not.toThrow();
    }
  });

  it('names every entry in English and Traditional Chinese', () => {
    for (const entry of KEYMAP) {
      for (const key of [entry.title, entry.description].filter(key => key !== undefined)) {
        expect(en[key]?.trim(), `${entry.id} ${key}`).toBeTruthy();
        expect(zhTW[key]?.trim(), `${entry.id} ${key}`).toBeTruthy();
      }
    }
  });

  it('gives every dispatcher entry a phase and every other entry none', () => {
    for (const entry of KEYMAP) expect(entry.phase !== undefined, entry.id).toBe(entry.handler === 'dispatcher');
  });

  it('never binds two entries to the same key where their scopes overlap', () => {
    const overlaps = (a: KeyScope, b: KeyScope) => a === b || a === 'global' || b === 'global';
    for (const env of ENVIRONMENTS) {
      const pressed = KEYMAP.flatMap(entry => entry.bindings.filter(binding => bindingApplies(binding, env)).map(binding => ({ entry, binding, id: keysId(parsedBinding(binding)) })));
      for (const [index, a] of pressed.entries()) {
        for (const b of pressed.slice(index + 1)) {
          if (a.entry === b.entry || a.id !== b.id) continue;
          const shared = a.entry.scopes.some(scope => b.entry.scopes.some(other => overlaps(scope, other) && !a.binding.when?.exceptScopes?.includes(other) && !b.binding.when?.exceptScopes?.includes(scope)));
          expect(shared, `${a.entry.id} and ${b.entry.id} both take ${a.id} on ${env.platform}/${env.browser}`).toBe(false);
        }
      }
    }
  });

  it('never takes a browser-reserved, AltGr or Option-letter chord for the app itself', () => {
    // CodeMirror's own defaults are CodeMirror's choices; the dispatcher and the widgets are the app's.
    for (const entry of KEYMAP.filter(entry => entry.handler !== 'codemirror')) {
      for (const env of ENVIRONMENTS) {
        for (const binding of entry.bindings.filter(binding => bindingApplies(binding, env))) {
          for (const chord of chordsOf(parsedBinding(binding))) expect(bannedChordReason(chord, env.platform), `${entry.id} ${binding.keys} on ${env.platform}`).toBeNull();
        }
      }
    }
  });

  it('gives every applicable environment at least one binding for each global key', () => {
    for (const entry of KEYMAP.filter(entry => entry.scopes.includes('global'))) {
      for (const env of ENVIRONMENTS) expect(entry.bindings.some(binding => bindingApplies(binding, env)), `${entry.id} on ${env.platform}/${env.browser}`).toBe(true);
    }
  });
});
