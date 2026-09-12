import { useEffect } from 'react';

// Mobile browsers can resize the visual viewport without resizing CSS vh/dvh
// when the keyboard opens. Ignore pinch zoom so zoomed content stays pannable.
export function useVisualViewport() {
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const update = () => {
      if (Math.abs(viewport.scale - 1) > 0.01) return;
      const style = document.documentElement.style;
      style.setProperty('--visual-height', `${viewport.height}px`);
      style.setProperty('--visual-top', `${viewport.offsetTop}px`);
    };
    update();
    viewport.addEventListener('resize', update);
    viewport.addEventListener('scroll', update);
    return () => {
      viewport.removeEventListener('resize', update);
      viewport.removeEventListener('scroll', update);
      document.documentElement.style.removeProperty('--visual-height');
      document.documentElement.style.removeProperty('--visual-top');
    };
  }, []);
}
