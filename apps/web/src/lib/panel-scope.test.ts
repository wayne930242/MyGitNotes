import { afterEach, describe, expect, it, vi } from 'vitest';
import { effectivePanelScope, getSavedPanelScope, savePanelScope } from './panel-scope.js';

describe('panel scope persistence', () => {
  afterEach(() => vi.unstubAllGlobals());

  function stubStorage(): Map<string, string> {
    const storage = new Map<string, string>();
    vi.stubGlobal('window', { localStorage: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) } });
    return storage;
  }

  it('defaults to current when nothing is stored', () => {
    stubStorage();
    expect(getSavedPanelScope('test-key')).toBe('current');
  });

  it('round-trips a saved scope', () => {
    stubStorage();
    savePanelScope('test-key', 'folder');
    expect(getSavedPanelScope('test-key')).toBe('folder');
  });

  it('keeps separate keys independent', () => {
    stubStorage();
    savePanelScope('key-a', 'all');
    savePanelScope('key-b', 'folder');
    expect(getSavedPanelScope('key-a')).toBe('all');
    expect(getSavedPanelScope('key-b')).toBe('folder');
  });

  it('falls back to current when the stored value is no longer valid', () => {
    const storage = new Map<string, string>();
    vi.stubGlobal('window', { localStorage: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) } });
    storage.set('test-key', 'notebook');
    expect(getSavedPanelScope('test-key')).toBe('current');
  });
});

describe('effectivePanelScope', () => {
  it('keeps folder scope when a folder is being browsed', () => {
    expect(effectivePanelScope('folder', 'notes/example')).toBe('folder');
  });

  it('falls back to current when folder scope is stored but no folder is browsed', () => {
    expect(effectivePanelScope('folder', undefined)).toBe('current');
  });

  it('leaves current and all scopes unaffected by the current folder', () => {
    expect(effectivePanelScope('current', undefined)).toBe('current');
    expect(effectivePanelScope('all', undefined)).toBe('all');
    expect(effectivePanelScope('all', 'notes/example')).toBe('all');
  });
});
