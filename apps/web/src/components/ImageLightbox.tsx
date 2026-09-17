import React, { useState, useEffect } from 'react';
import { X } from 'lucide-react';

interface LightboxState {
  src: string;
  alt: string;
}

export const ImageLightbox: React.FC = () => {
  const [activeImage, setActiveImage] = useState<LightboxState | null>(null);

  useEffect(() => {
    const handleGlobalClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target || target.tagName.toLowerCase() !== 'img') return;

      // Only trigger for images inside Markdown rendering contexts
      const inMarkdown = target.closest(
        '.prose-custom, .live-md-rendered, [data-markdown-view], .markdown-preview, .screen-markdown, .note-r2-image'
      );
      if (!inMarkdown) return;

      // Exclude interactive poster buttons or control icons
      if (target.closest('button.screen-image-button, .note-youtube-poster, .editor-notice')) return;

      const img = target as HTMLImageElement;
      const src = img.currentSrc || img.src;
      if (!src) return;

      event.preventDefault();
      event.stopPropagation();

      setActiveImage({
        src,
        alt: img.alt || img.title || '',
      });
    };

    // Capture click before other listeners
    document.addEventListener('click', handleGlobalClick, true);
    return () => document.removeEventListener('click', handleGlobalClick, true);
  }, []);

  useEffect(() => {
    if (!activeImage) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setActiveImage(null);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeImage]);

  if (!activeImage) return null;

  return (
    <div
      className="image-lightbox-overlay fixed inset-0 z-[9999] bg-slate-950/85 backdrop-blur-md flex items-center justify-center p-4 sm:p-8 animate-fadeIn select-none"
      onClick={() => setActiveImage(null)}
      role="dialog"
      aria-modal="true"
      aria-label="Image preview lightbox"
    >
      <button
        type="button"
        onClick={() => setActiveImage(null)}
        className="absolute top-4 right-4 p-2.5 rounded-full bg-black/50 hover:bg-black/80 text-white/80 hover:text-white transition-colors z-10 focus:outline-none focus:ring-2 focus:ring-white/50"
        aria-label="Close lightbox"
      >
        <X className="w-6 h-6" />
      </button>

      <div
        className="relative max-w-full max-h-full flex flex-col items-center justify-center"
        onClick={(e) => e.stopPropagation()}
      >
        <img
          src={activeImage.src}
          alt={activeImage.alt}
          className="max-w-[92vw] max-h-[85vh] object-contain rounded-lg shadow-2xl transition-transform"
        />
        {activeImage.alt && (
          <p className="mt-3 text-xs sm:text-sm text-slate-200 font-medium px-4 py-1.5 bg-black/60 rounded-full backdrop-blur-sm max-w-xl text-center truncate pointer-events-none">
            {activeImage.alt}
          </p>
        )}
      </div>
    </div>
  );
};
