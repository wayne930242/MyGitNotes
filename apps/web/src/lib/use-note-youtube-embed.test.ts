import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('react', () => ({ useEffect: (effect: () => unknown) => effect() }));
import { useNoteYouTubeEmbed } from './use-note-youtube-embed.js';

afterEach(() => vi.unstubAllGlobals());

describe('useNoteYouTubeEmbed hook', () => {
  function setup() {
    let clickListener: (event: MouseEvent) => void = () => {};
    let keydownListener: (event: KeyboardEvent) => void = () => {};

    const iframeElements: any[] = [];
    vi.stubGlobal('document', {
      createElement: (tag: string) => {
        const el: any = { tagName: tag.toUpperCase(), title: '', src: '', allow: '', allowFullscreen: false, className: '' };
        if (tag === 'iframe') iframeElements.push(el);
        return el;
      },
    });

    const embed = {
      dataset: { videoId: 'dQw4w9WgXcQ', start: '45' },
      replaceChildren: vi.fn(),
    };

    const poster = {
      closest: (selector: string) => (selector === '.note-youtube-embed' ? embed : null),
    };

    class MockElement {
      closest(selector: string) {
        if (selector === '.note-youtube-poster') return poster;
        if (selector === '.note-youtube-embed') return embed;
        return null;
      }
    }
    vi.stubGlobal('Element', MockElement);

    const surface = {
      contains: (el: any) => el === poster,
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
    const { embed, iframeElements, dispatchClick } = setup();
    const event = dispatchClick(new (globalThis as any).Element());

    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(event.stopPropagation).toHaveBeenCalledOnce();
    expect(embed.replaceChildren).toHaveBeenCalledOnce();
    expect(iframeElements).toHaveLength(1);
    expect(iframeElements[0].src).toBe('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?start=45&autoplay=1&playsinline=1&rel=0');
    expect(iframeElements[0].allowFullscreen).toBe(true);
  });

  it('activates on Enter or Space keydown', () => {
    const { embed, iframeElements, dispatchKeydown } = setup();
    const event = dispatchKeydown('Enter', new (globalThis as any).Element());

    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(event.stopPropagation).toHaveBeenCalledOnce();
    expect(embed.replaceChildren).toHaveBeenCalledOnce();
    expect(iframeElements[0].src).toContain('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ');
  });

  it('ignores other keys like ArrowDown', () => {
    const { embed, dispatchKeydown } = setup();
    const event = dispatchKeydown('ArrowDown', new (globalThis as any).Element());

    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(embed.replaceChildren).not.toHaveBeenCalled();
  });
});
