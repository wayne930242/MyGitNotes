import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyYouTubeDisplayMode, copyYouTubeUrl, readYouTubeDisplayMode, setYouTubeDisplayMode, YOUTUBE_MODE_EVENT, YOUTUBE_MODE_STORAGE_KEY } from './youtube-embed.js';

afterEach(() => vi.unstubAllGlobals());

describe('YouTube display mode preference', () => {
  it('defaults invalid storage to thumbnail and persists a selected mode', () => {
    const storage = { getItem: vi.fn(() => 'invalid'), setItem: vi.fn() };
    const embed = { dataset: {}, querySelectorAll: () => [] };
    const dispatchEvent = vi.fn();
    vi.stubGlobal('document', { querySelectorAll: () => [embed] });
    vi.stubGlobal('window', { dispatchEvent });
    vi.stubGlobal('CustomEvent', class { constructor(public type: string, public init: unknown) {} });

    expect(readYouTubeDisplayMode(storage)).toBe('thumbnail');
    setYouTubeDisplayMode('theater', storage);

    expect(storage.setItem).toHaveBeenCalledWith(YOUTUBE_MODE_STORAGE_KEY, 'theater');
    expect(embed.dataset).toEqual({ youtubeMode: 'theater' });
    expect(dispatchEvent.mock.calls[0][0].type).toBe(YOUTUBE_MODE_EVENT);
  });

  it('marks exactly the selected mode as pressed', () => {
    const buttons = ['thumbnail', 'medium', 'theater'].map(mode => ({ dataset: { youtubeModeOption: mode }, setAttribute: vi.fn() }));
    const embed = { dataset: {}, querySelectorAll: () => buttons };
    applyYouTubeDisplayMode(embed as unknown as HTMLElement, 'theater');
    expect(buttons.map(button => button.setAttribute.mock.calls[0])).toEqual([
      ['aria-pressed', 'false'], ['aria-pressed', 'false'], ['aria-pressed', 'true'],
    ]);
  });
});

describe('YouTube URL copy', () => {
  it('prefers the source URL and falls back to a canonical timestamped URL', async () => {
    const writeText = vi.fn(async () => undefined);
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
