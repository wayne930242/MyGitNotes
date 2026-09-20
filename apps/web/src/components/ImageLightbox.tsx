import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ExternalLink, Maximize, Minus, Plus, X } from 'lucide-react';
import { useTranslation } from '../lib/i18n/index.js';
import './image-lightbox.css';
import { LoadingStatus } from './LoadingStatus.js';

type ImageSource = { src: string; alt: string; };
type Point = { x: number; y: number; };
const clampZoom = (scale: number, fit: number) => Math.max(0.05, Math.min(Math.max(8, fit * 4), scale));

function ImagePreview({ image, onClose }: { image: ImageSource; onClose: () => void; }) {
  const { t } = useTranslation();
  const dialog = useRef<HTMLDialogElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [bounds, setBounds] = useState({ width: 0, height: 0 });
  const [zoom, setZoom] = useState<number | null>(null);
  const [position, setPosition] = useState<Point>({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [failed, setFailed] = useState(false);
  const pointers = useRef(new Map<number, Point>());
  const moved = useRef(false);
  const backdropPress = useRef(false);
  const fit = size.width && bounds.width ? Math.min(bounds.width / size.width, bounds.height / size.height) : 1;
  const scale = zoom ?? fit;
  const ready = size.width > 0 && !failed;
  const reset = useCallback(() => {
    setZoom(null);
    setPosition({ x: 0, y: 0 });
  }, []);
  const changeZoom = useCallback((factor: number) => {
    setZoom(value => clampZoom((value ?? fit) * factor, fit));
  }, [fit]);

  useEffect(() => {
    const modal = dialog.current!;
    const previousFocus = document.activeElement as HTMLElement | null;
    modal.showModal();
    modal.querySelector<HTMLButtonElement>('button')?.focus();
    return () => {
      modal.close();
      previousFocus?.focus({ preventScroll: true });
    };
  }, []);

  useEffect(() => {
    const element = stage.current!;
    const observer = new ResizeObserver(([entry]) => {
      setBounds({ width: Math.max(1, entry.contentRect.width - 32), height: Math.max(1, entry.contentRect.height - 32) });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const element = stage.current!;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      if (ready) changeZoom(Math.exp(-Math.max(-100, Math.min(100, event.deltaY)) * 0.003));
    };
    element.addEventListener('wheel', wheel, { passive: false });
    return () => element.removeEventListener('wheel', wheel);
  }, [changeZoom, ready]);

  // Keep part of the image in view after zooming or resizing.
  const offset = { x: Math.max(-Math.max(0, (size.width * scale - bounds.width) / 2), Math.min(position.x, Math.max(0, (size.width * scale - bounds.width) / 2))), y: Math.max(-Math.max(0, (size.height * scale - bounds.height) / 2), Math.min(position.y, Math.max(0, (size.height * scale - bounds.height) / 2))) };

  return createPortal(
    <dialog
      ref={dialog}
      className='image-lightbox'
      aria-label={t('lightbox.title')}
      onCancel={event => {
        event.preventDefault();
        onClose();
      }}
      onKeyDown={event => {
        event.stopPropagation();
        if (event.key === 'Escape') {
          event.preventDefault();
          onClose();
        } else if (ready && ['+', '=', '-', '0', '1'].includes(event.key)) {
          event.preventDefault();
          if (event.key === '0') reset();
          else if (event.key === '1') {
            setZoom(1);
            setPosition({ x: 0, y: 0 });
          } else changeZoom(event.key === '-' ? 1 / 1.25 : 1.25);
        }
      }}
    >
      <header className='image-lightbox-header'>
        <div className='image-lightbox-title'>
          <strong>{image.alt || t('lightbox.title')}</strong>
          {ready && <span>{size.width}{' × '}{size.height}</span>}
        </div>
        <a href={image.src} target='_blank' rel='noopener noreferrer' aria-label={t('lightbox.original')} title={t('lightbox.original')}>
          <ExternalLink size={18} />
        </a>
        <button type='button' autoFocus onClick={onClose} aria-label={t('lightbox.close')} title={t('lightbox.close')}>
          <X size={22} />
        </button>
      </header>
      <div
        ref={stage}
        className='image-lightbox-stage'
        data-dragging={dragging}
        onClick={event => {
          if (event.target === event.currentTarget && backdropPress.current && !moved.current) onClose();
        }}
        onDoubleClick={() => {
          if (!ready || backdropPress.current) return;
          if (zoom === null) setZoom(Math.max(1, fit * 2));
          else reset();
        }}
        onPointerDown={event => {
          if (event.button !== 0 || !ready) return;
          moved.current = false;
          backdropPress.current = event.target === event.currentTarget;
          pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
          event.currentTarget.setPointerCapture(event.pointerId);
          setDragging(true);
        }}
        onPointerMove={event => {
          const previous = pointers.current.get(event.pointerId);
          if (!previous) return;
          const next = { x: event.clientX, y: event.clientY };
          const other = [...pointers.current.entries()].find(([id]) => id !== event.pointerId)?.[1];
          const dx = next.x - previous.x, dy = next.y - previous.y;
          if (Math.abs(dx) + Math.abs(dy) > 2) moved.current = true;
          if (other) {
            const before = Math.hypot(previous.x - other.x, previous.y - other.y);
            if (before > 0) changeZoom(Math.hypot(next.x - other.x, next.y - other.y) / before);
          } else setPosition({ x: offset.x + dx, y: offset.y + dy });
          pointers.current.set(event.pointerId, next);
        }}
        onPointerUp={event => {
          pointers.current.delete(event.pointerId);
          setDragging(pointers.current.size > 0);
        }}
        onPointerCancel={event => {
          pointers.current.delete(event.pointerId);
          setDragging(false);
        }}
      >
        {!ready && (failed ? <p role='status'>{t('lightbox.error')}</p> : <LoadingStatus>{t('lightbox.loading')}</LoadingStatus>)}
        {!failed && <img src={image.src} alt={image.alt} draggable={false} onLoad={event => setSize({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })} onError={() => setFailed(true)} style={{ width: ready ? size.width * scale : undefined, height: ready ? size.height * scale : undefined, visibility: ready ? 'visible' : 'hidden', transform: `translate(${offset.x}px, ${offset.y}px)` }} />}
      </div>
      <footer className='image-lightbox-footer'>
        <div className='image-lightbox-controls' role='group' aria-label={t('lightbox.title')}>
          <button type='button' disabled={!ready || scale <= .05} onClick={() => changeZoom(1 / 1.25)} aria-label={t('lightbox.zoomOut')} title={t('lightbox.zoomOut')}>
            <Minus size={18} />
          </button>
          <button
            type='button'
            className='image-lightbox-scale'
            disabled={!ready}
            onClick={() => {
              setZoom(1);
              setPosition({ x: 0, y: 0 });
            }}
            title={t('lightbox.actual')}
            aria-label={t('lightbox.actual')}
          >
            {ready ? `${Math.round(scale * 100)}%` : '—'}
          </button>
          <button type='button' disabled={!ready || scale >= Math.max(8, fit * 4)} onClick={() => changeZoom(1.25)} aria-label={t('lightbox.zoomIn')} title={t('lightbox.zoomIn')}>
            <Plus size={18} />
          </button>
          <span className='image-lightbox-divider' />
          <button type='button' disabled={!ready} onClick={reset} aria-label={t('lightbox.fit')} title={t('lightbox.fit')} aria-pressed={zoom === null}>
            <Maximize size={18} />
          </button>
        </div>
        <p className='image-lightbox-help'>{t('lightbox.help')}</p>
      </footer>
    </dialog>,
    document.body,
  );
}

export function ImageLightbox() {
  const [image, setImage] = useState<ImageSource | null>(null);
  useEffect(() => {
    const open = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof HTMLImageElement)) return;
      if (!target.closest('.prose-custom, .live-md-rendered, [data-markdown-view], .markdown-preview, .screen-markdown, .note-r2-image')) return;
      if (target.closest('button.screen-image-button, .note-youtube-poster, .editor-notice')) return;
      const src = target.currentSrc || target.src;
      if (!src) return;
      event.preventDefault();
      event.stopPropagation();
      setImage({ src, alt: target.alt || target.title || '' });
    };
    document.addEventListener('click', open, true);
    return () => document.removeEventListener('click', open, true);
  }, []);
  return image ? <ImagePreview image={image} onClose={() => setImage(null)} /> : null;
}
