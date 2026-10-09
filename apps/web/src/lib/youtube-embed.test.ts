import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_WORKSPACE_PREFERENCES } from '@mygitnotes/core/workspace-preferences';
import { setNotebookPreferences } from './notebook-preferences.js';
import { applyYouTubeDisplayMode, copyYouTubeUrl, readYouTubeDisplayMode, setYouTubeDisplayMode, YOUTUBE_MODE_EVENT, YOUTUBE_MODE_STORAGE_KEY, type YouTubeDisplayMode } from './youtube-embed.js';

/** Every notebook's repository sets `defaultYoutubeDisplayMode` to `mode`. */
const setDefaultYouTubeDisplayMode = (mode: YouTubeDisplayMode) => setNotebookPreferences(() => ({ ...DEFAULT_WORKSPACE_PREFERENCES, defaultYoutubeDisplayMode: mode }));

afterEach(() => {
  vi.unstubAllGlobals();
  setDefaultYouTubeDisplayMode('thumbnail');
});

describe('YouTube display mode preference', () => {
  it('applies a workspace default that arrives after the mode was first read', () => {
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {} });
    setDefaultYouTubeDisplayMode('thumbnail'); // The workspace config has not loaded yet.
    expect(readYouTubeDisplayMode()).toBe('thumbnail'); // A note surface reads it, caching the mode for the session.
    setDefaultYouTubeDisplayMode('theater'); // The config arrives with the user's preference.
    expect(readYouTubeDisplayMode()).toBe('theater');
  });

  it("gives each note its own repository's default until this device chooses a mode", () => {
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {} });
    setNotebookPreferences(notebookId => ({ ...DEFAULT_WORKSPACE_PREFERENCES, defaultYoutubeDisplayMode: notebookId === 'films~watch' ? 'theater' : 'thumbnail' }));
    // Reading one note's mode must not fix it for a note of another repository. This runs before any test chooses a mode.
    expect(readYouTubeDisplayMode('films~watch')).toBe('theater');
    expect(readYouTubeDisplayMode('notes~life')).toBe('thumbnail');
    expect(readYouTubeDisplayMode('films~watch')).toBe('theater');
  });

  it('defaults invalid storage to thumbnail and persists a selected mode', () => {
    const storage = { getItem: vi.fn(() => 'invalid'), setItem: vi.fn() };
    const embed = { dataset: {}, querySelectorAll: () => [] };
    const dispatchEvent = vi.fn();
    vi.stubGlobal('document', { querySelectorAll: () => [embed] });
    vi.stubGlobal('window', { dispatchEvent });
    vi.stubGlobal(
      'CustomEvent',
      class {
        constructor(public type: string, public init: unknown) {}
      },
    );

    expect(readYouTubeDisplayMode(undefined, storage)).toBe('thumbnail');
    setYouTubeDisplayMode('theater', storage);

    expect(storage.setItem).toHaveBeenCalledWith(YOUTUBE_MODE_STORAGE_KEY, 'theater');
    expect(embed.dataset).toEqual({ youtubeMode: 'theater' });
    expect(dispatchEvent.mock.calls[0][0].type).toBe(YOUTUBE_MODE_EVENT);
  });

  it('falls back to the workspace-configured default, not a hardcoded one, when nothing is stored', () => {
    const storage = { getItem: vi.fn(() => null) };
    expect(readYouTubeDisplayMode(undefined, storage)).toBe('thumbnail');

    setDefaultYouTubeDisplayMode('theater');
    expect(readYouTubeDisplayMode(undefined, storage)).toBe('theater');
  });

  it('keeps the selected mode in memory when storage is unavailable', () => {
    vi.stubGlobal('localStorage', {
      getItem: vi.fn(() => {
        throw new Error('blocked');
      }),
      setItem: vi.fn(() => {
        throw new Error('blocked');
      }),
    });
    vi.stubGlobal('document', { querySelectorAll: () => [] });
    vi.stubGlobal('window', { dispatchEvent: vi.fn() });
    vi.stubGlobal(
      'CustomEvent',
      class {
        constructor(public type: string, public init: unknown) {}
      },
    );

    setYouTubeDisplayMode('medium');

    expect(readYouTubeDisplayMode()).toBe('medium');
  });

  it('marks exactly the selected mode as pressed', () => {
    const buttons = ['thumbnail', 'medium', 'theater'].map(mode => ({ dataset: { youtubeModeOption: mode }, setAttribute: vi.fn() }));
    const embed = { dataset: {}, querySelectorAll: () => buttons };
    applyYouTubeDisplayMode(embed as unknown as HTMLElement, 'theater');
    expect(buttons.map(button => button.setAttribute.mock.calls[0])).toEqual([['aria-pressed', 'false'], ['aria-pressed', 'false'], ['aria-pressed', 'true']]);
  });
});

describe('YouTube URL copy', () => {
  it('prefers the source URL and falls back to a canonical timestamped URL', async () => {
    const writeText = vi.fn(async (_text: string) => undefined);
    vi.stubGlobal('window', { setTimeout: vi.fn() });
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    vi.stubGlobal('document', { querySelectorAll: () => [] });
    const button = (embed: unknown) => ({ dataset: { copyLabel: 'Copy', copiedLabel: 'Copied', copyFailedLabel: 'Failed' }, closest: (selector: string) => selector === '.note-youtube-embed' ? embed : null, setAttribute: vi.fn(), innerHTML: '', title: '', isConnected: true });
    const source = { dataset: { videoId: 'dQw4w9WgXcQ', start: '45', youtubeSourceUrl: 'https://youtu.be/dQw4w9WgXcQ?t=45' } };
    await copyYouTubeUrl(button(source) as unknown as HTMLElement);
    const canonical = { dataset: { videoId: 'dQw4w9WgXcQ', start: '45' } };
    await copyYouTubeUrl(button(canonical) as unknown as HTMLElement);
    expect(writeText.mock.calls.map(call => call[0])).toEqual(['https://youtu.be/dQw4w9WgXcQ?t=45', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=45s']);
  });
});
