import { afterEach, describe, expect, it, vi } from 'vitest';
import { getSavedPanelState, PANEL_OPEN_STORAGE_KEY, PANEL_TOOL_STORAGE_KEY, savePanelState } from './panel-state.js';

afterEach(() => vi.unstubAllGlobals());

const TOOL_IDS = ['calendar', 'todo', 'find', 'outline', 'frontmatter', 'assets', 'git'] as const;

describe('panel state persistence', () => {
  it('defaults to closed with the todo tool when nothing is stored', () => {
    const storage = new Map<string, string>();
    vi.stubGlobal('window', { localStorage: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) } });
    expect(getSavedPanelState(TOOL_IDS)).toEqual({ open: false, tool: 'todo' });
  });

  it('round-trips a saved open state and tool', () => {
    const storage = new Map<string, string>();
    vi.stubGlobal('window', { localStorage: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) } });
    savePanelState({ open: true, tool: 'calendar' });
    expect(getSavedPanelState(TOOL_IDS)).toEqual({ open: true, tool: 'calendar' });
  });

  it('falls back to the default tool when the stored tool is no longer valid', () => {
    const storage = new Map<string, string>([[PANEL_TOOL_STORAGE_KEY, 'deleted-tool'], [PANEL_OPEN_STORAGE_KEY, 'true']]);
    vi.stubGlobal('window', { localStorage: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) } });
    expect(getSavedPanelState(TOOL_IDS)).toEqual({ open: true, tool: 'todo' });
  });
});
