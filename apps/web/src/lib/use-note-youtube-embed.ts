import { useEffect } from 'react';

type ElementRef = { readonly current: HTMLElement | null };

export function useNoteYouTubeEmbed(surfaceRef: ElementRef) {
  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) return;

    const activate = (button: HTMLElement) => {
      const embed = button.closest<HTMLElement>('.note-youtube-embed');
      const videoId = embed?.dataset.videoId;
      if (!embed || !videoId) return;
      const start = Number(embed.dataset.start || '0');
      const iframe = document.createElement('iframe');
      iframe.title = 'YouTube video player';
      iframe.src = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(videoId)}?start=${start}&autoplay=1&playsinline=1&rel=0`;
      iframe.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';
      iframe.allowFullscreen = true;
      iframe.className = 'note-youtube-iframe';
      embed.replaceChildren(iframe);
    };

    const onClick = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target.closest<HTMLElement>('.note-youtube-poster') : null;
      if (target && surface.contains(target)) {
        event.preventDefault();
        event.stopPropagation();
        activate(target);
      }
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (!['Enter', ' '].includes(event.key)) return;
      const target = event.target instanceof Element ? event.target.closest<HTMLElement>('.note-youtube-poster') : null;
      if (target && surface.contains(target)) {
        event.preventDefault();
        event.stopPropagation();
        activate(target);
      }
    };

    surface.addEventListener('click', onClick);
    surface.addEventListener('keydown', onKeyDown);
    return () => {
      surface.removeEventListener('click', onClick);
      surface.removeEventListener('keydown', onKeyDown);
    };
  }, [surfaceRef]);
}
