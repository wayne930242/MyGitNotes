import { useEffect } from 'react';
import { activateYouTubeEmbed, applyYouTubeDisplayMode, copyYouTubeUrl, isYouTubeDisplayMode, readYouTubeDisplayMode, rememberYouTubeDisplayMode, setYouTubeDisplayMode, YOUTUBE_MODE_EVENT, YOUTUBE_MODE_STORAGE_KEY } from './youtube-embed.js';

type ElementRef = { readonly current: HTMLElement | null };

export function useNoteYouTubeEmbed(surfaceRef: ElementRef) {
  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) return;
    surface.dataset.noteYoutubeSurface = 'true';

    const apply = (mode = readYouTubeDisplayMode()) => surface.querySelectorAll<HTMLElement>('.note-youtube-embed').forEach(embed => applyYouTubeDisplayMode(embed, mode));
    apply();
    const action = (target: EventTarget | null) => target instanceof Element ? target.closest<HTMLElement>('[data-youtube-mode-option], [data-youtube-copy], .note-youtube-poster') : null;
    const run = (target: HTMLElement) => {
      const mode = target.dataset.youtubeModeOption;
      if (isYouTubeDisplayMode(mode)) setYouTubeDisplayMode(mode); else if (target.matches('[data-youtube-copy]')) void copyYouTubeUrl(target); else activateYouTubeEmbed(target);
    };

    const onClick = (event: MouseEvent) => {
      const target = action(event.target);
      if (target && surface.contains(target)) {
        event.preventDefault();
        event.stopPropagation();
        run(target);
      }
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (!['Enter', ' '].includes(event.key)) return;
      const target = action(event.target);
      if (target && surface.contains(target)) {
        event.preventDefault();
        event.stopPropagation();
        run(target);
      }
    };
    const onMode = (event: Event) => { const mode = (event as CustomEvent).detail; if (isYouTubeDisplayMode(mode)) apply(mode); };
    const onStorage = (event: StorageEvent) => { if (event.key === YOUTUBE_MODE_STORAGE_KEY && isYouTubeDisplayMode(event.newValue)) { rememberYouTubeDisplayMode(event.newValue); apply(event.newValue); } };

    surface.addEventListener('click', onClick);
    surface.addEventListener('keydown', onKeyDown);
    window.addEventListener(YOUTUBE_MODE_EVENT, onMode);
    window.addEventListener('storage', onStorage);
    return () => {
      surface.removeEventListener('click', onClick);
      surface.removeEventListener('keydown', onKeyDown);
      window.removeEventListener(YOUTUBE_MODE_EVENT, onMode);
      window.removeEventListener('storage', onStorage);
      delete surface.dataset.noteYoutubeSurface;
    };
  }, [surfaceRef]);
}
