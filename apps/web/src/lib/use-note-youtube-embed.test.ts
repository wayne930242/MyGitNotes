import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('react', () => ({ useEffect: (effect: () => unknown) => effect() }));
import { useNoteYouTubeEmbed } from './use-note-youtube-embed.js';
import { stopYouTubePlayback } from './youtube-embed.js';

afterEach(() => { stopYouTubePlayback(); vi.unstubAllGlobals(); });

describe('useNoteYouTubeEmbed hook', () => {
  function setup() {
    let clickListener: (event: MouseEvent) => void = () => {};
    let keydownListener: (event: KeyboardEvent) => void = () => {};

    const iframeElements: any[] = [];
    const bodyAppend = vi.fn();
    vi.stubGlobal('document', {
      body: { append: bodyAppend, getBoundingClientRect: () => ({ left: 0, top: 0 }) },
      querySelectorAll: () => [embed],
      createElement: (tag: string) => {
        const el: any = { tagName: tag.toUpperCase(), title: '', src: '', allow: '', allowFullscreen: false, className: '', dataset: {}, style: {}, append: vi.fn(), remove: vi.fn() };
        if (tag === 'iframe') iframeElements.push(el);
        return el;
      },
    });

    const embed = {
      isConnected: true,
      dataset: { videoId: 'dQw4w9WgXcQ', start: '45', youtubeMode: 'thumbnail', youtubeSession: `test-${Math.random()}` },
      replaceChildren: vi.fn(),
      querySelectorAll: () => [],
      querySelector: () => null,
      closest: () => null,
      getBoundingClientRect: () => ({ left: 10, top: 20, width: 360, height: 203 }),
    };

    const poster = {
      dataset: { youtubePlayerLabel: 'YouTube video player' },
      closest: (selector: string) => (selector === '.note-youtube-embed' ? embed : null),
      matches: () => false,
    };

    class MockElement {
      closest(selector: string) {
        if (selector.includes('.note-youtube-poster')) return poster;
        if (selector === '.note-youtube-embed') return embed;
        return null;
      }
    }
    vi.stubGlobal('Element', MockElement);
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn() });
    vi.stubGlobal('CustomEvent', class { constructor(public type: string, public init: unknown) {} });
    vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn() });
    vi.stubGlobal('location', { pathname: '/notes/test' });
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());

    const surface = {
      dataset: {},
      contains: (el: any) => el === poster,
      querySelectorAll: () => [embed],
      addEventListener: (event: string, fn: any) => {
        if (event === 'click') clickListener = fn;
        if (event === 'keydown') keydownListener = fn;
      },
      removeEventListener: vi.fn(),
    };

    useNoteYouTubeEmbed({ current: surface as unknown as HTMLElement });

    return {
      embed,
      poster,
      iframeElements,
      bodyAppend,
      dispatchClick: (target: any) => {
        const event = {
          target,
          preventDefault: vi.fn(),
          stopPropagation: vi.fn(),
        } as unknown as MouseEvent;
        clickListener(event);
        return event;
      },
      dispatchKeydown: (key: string, target: any) => {
        const event = {
          key,
          target,
          preventDefault: vi.fn(),
          stopPropagation: vi.fn(),
        } as unknown as KeyboardEvent;
        keydownListener(event);
        return event;
      },
    };
  }

  it('activates and replaces poster with iframe on click', () => {
    const { bodyAppend, iframeElements, dispatchClick } = setup();
    const event = dispatchClick(new (globalThis as any).Element());

    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(event.stopPropagation).toHaveBeenCalledOnce();
    expect(bodyAppend).toHaveBeenCalledOnce();
    expect(iframeElements).toHaveLength(1);
    expect(iframeElements[0].src).toBe('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?start=45&autoplay=1&playsinline=1&rel=0');
    expect(iframeElements[0].allowFullscreen).toBe(true);
  });

  it('activates on Enter or Space keydown', () => {
    const { bodyAppend, iframeElements, dispatchKeydown } = setup();
    const event = dispatchKeydown('Enter', new (globalThis as any).Element());

    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(event.stopPropagation).toHaveBeenCalledOnce();
    expect(bodyAppend).toHaveBeenCalledOnce();
    expect(iframeElements[0].src).toContain('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ');
  });

  it('ignores other keys like ArrowDown', () => {
    const { embed, dispatchKeydown } = setup();
    const event = dispatchKeydown('ArrowDown', new (globalThis as any).Element());

    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(embed.replaceChildren).not.toHaveBeenCalled();
  });
});
