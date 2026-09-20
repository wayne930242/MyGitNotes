import type { YouTubeDisplayMode } from '@mygitnotes/core';

export const YOUTUBE_MODE_STORAGE_KEY = 'github-notes:youtube-display-mode';
export const YOUTUBE_MODE_EVENT = 'github-notes:youtube-display-mode-change';
let youtubeSessionSequence = 0;
let rememberedYouTubeMode: YouTubeDisplayMode | null = null;
/** Workspace-configured default, applied when this device has not made its own choice yet. */
let configuredDefaultMode: YouTubeDisplayMode = 'thumbnail';
let activePlayer: { key: string; host: HTMLDivElement; route: string; frame: number; target: HTMLElement; surface: HTMLElement; } | null = null;

export function stopYouTubePlayback() {
  if (!activePlayer) return;
  cancelAnimationFrame(activePlayer.frame);
  activePlayer.host.remove();
  activePlayer = null;
}

export function setDefaultYouTubeDisplayMode(mode: YouTubeDisplayMode) {
  configuredDefaultMode = mode;
  // A mode remembered before this arrived was derived from the previous default, and the session
  // cache would otherwise keep serving it. A stored per-device choice still wins, so drop the
  // cache only when this device has none.
  try {
    if (globalThis.localStorage.getItem(YOUTUBE_MODE_STORAGE_KEY) === null) rememberedYouTubeMode = null;
  } catch { /* Storage unreachable: leave the cache alone rather than discard a session choice. */ }
}

export type { YouTubeDisplayMode };
export type YouTubeLabels = { play: string; player: string; modes: string; thumbnail: string; medium: string; theater: string; copy: string; copied: string; copyFailed: string; };

export const DEFAULT_YOUTUBE_LABELS: YouTubeLabels = { play: 'Play YouTube video', player: 'YouTube video player', modes: 'YouTube display mode', thumbnail: 'Thumbnail', medium: 'Medium', theater: 'Theater', copy: 'Copy video URL', copied: 'Video URL copied', copyFailed: 'Could not copy video URL' };

export function youtubeLabels(t: (key: 'youtube.play' | 'youtube.player' | 'youtube.modes' | 'youtube.thumbnail' | 'youtube.medium' | 'youtube.theater' | 'youtube.copy' | 'youtube.copied' | 'youtube.copyFailed') => string): YouTubeLabels {
  return { play: t('youtube.play'), player: t('youtube.player'), modes: t('youtube.modes'), thumbnail: t('youtube.thumbnail'), medium: t('youtube.medium'), theater: t('youtube.theater'), copy: t('youtube.copy'), copied: t('youtube.copied'), copyFailed: t('youtube.copyFailed') };
}

export function isYouTubeDisplayMode(value: unknown): value is YouTubeDisplayMode {
  return value === 'thumbnail' || value === 'medium' || value === 'theater';
}

export function readYouTubeDisplayMode(storage?: Pick<Storage, 'getItem'>): YouTubeDisplayMode {
  if (!storage && rememberedYouTubeMode) return rememberedYouTubeMode;
  try {
    const value = (storage ?? globalThis.localStorage).getItem(YOUTUBE_MODE_STORAGE_KEY);
    const mode = value === 'music' ? 'thumbnail' : isYouTubeDisplayMode(value) ? value : configuredDefaultMode;
    if (!storage) rememberedYouTubeMode = mode;
    return mode;
  } catch {
    return rememberedYouTubeMode ?? configuredDefaultMode;
  }
}

export function rememberYouTubeDisplayMode(mode: YouTubeDisplayMode) {
  rememberedYouTubeMode = mode;
}

export function applyYouTubeDisplayMode(embed: HTMLElement, mode: YouTubeDisplayMode) {
  embed.dataset.youtubeMode = mode;
  for (const button of embed.querySelectorAll<HTMLButtonElement>('[data-youtube-mode-option]')) {
    button.setAttribute('aria-pressed', String(button.dataset.youtubeModeOption === mode));
  }
}

function selectedButtons(root: ParentNode, mode: YouTubeDisplayMode) {
  for (const button of root.querySelectorAll<HTMLButtonElement>('[data-youtube-mode-option]')) button.setAttribute('aria-pressed', String(button.dataset.youtubeModeOption === mode));
}

export function setYouTubeDisplayMode(mode: YouTubeDisplayMode, storage?: Pick<Storage, 'setItem'>) {
  rememberYouTubeDisplayMode(mode);
  try {
    (storage ?? globalThis.localStorage).setItem(YOUTUBE_MODE_STORAGE_KEY, mode);
  } catch { /* Keep the in-page preference. */ }
  document.querySelectorAll<HTMLElement>('.note-youtube-embed').forEach(embed => applyYouTubeDisplayMode(embed, mode));
  if (activePlayer) selectedButtons(activePlayer.host, mode);
  window.dispatchEvent(new CustomEvent(YOUTUBE_MODE_EVENT, { detail: mode }));
}

export function createYouTubeIframe(videoId: string, start: number, title: string): HTMLIFrameElement {
  const iframe = document.createElement('iframe');
  iframe.title = title;
  iframe.src = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(videoId)}?start=${start}&autoplay=1&playsinline=1&rel=0`;
  iframe.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';
  iframe.allowFullscreen = true;
  iframe.className = 'note-youtube-iframe';
  return iframe;
}

const escapeAttribute = (value: string) => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function youtubeEmbedMarkup(videoId: string, labels: YouTubeLabels = DEFAULT_YOUTUBE_LABELS) {
  const button = (mode: YouTubeDisplayMode, label: string) => `<button type="button" data-youtube-mode-option="${mode}" title="${escapeAttribute(label)}" aria-label="${escapeAttribute(label)}">${escapeAttribute(label)}</button>`;
  return `<div class="note-youtube-mode-control" role="group" aria-label="${escapeAttribute(labels.modes)}">${button('thumbnail', labels.thumbnail)}${button('medium', labels.medium)}${button('theater', labels.theater)}<button type="button" class="note-youtube-copy" data-youtube-copy aria-label="${escapeAttribute(labels.copy)}" title="${escapeAttribute(labels.copy)}" data-copy-label="${escapeAttribute(labels.copy)}" data-copied-label="${escapeAttribute(labels.copied)}" data-copy-failed-label="${escapeAttribute(labels.copyFailed)}">${copyIcon}</button></div><button type="button" class="note-youtube-poster" aria-label="${escapeAttribute(labels.play)}" data-youtube-player-label="${escapeAttribute(labels.player)}"><img src="https://img.youtube.com/vi/${encodeURIComponent(videoId)}/hqdefault.jpg" alt="" loading="lazy"><span class="note-youtube-play-btn" aria-hidden="true"><svg width="48" height="48" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"></path></svg></span></button>`;
}

const copyIcon = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>';
const copiedIcon = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m5 12 4 4L19 6"></path></svg>';
const failedIcon = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 9v4M12 17h.01"></path><path d="M10.3 2.9 1.8 17a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 2.9a2 2 0 0 0-3.4 0Z"></path></svg>';

export async function copyYouTubeUrl(button: HTMLElement) {
  const embed = button.closest<HTMLElement>('.note-youtube-embed');
  const host = button.closest<HTMLElement>('.note-youtube-persistent-player');
  const source = embed ?? host;
  const videoId = source?.dataset.videoId || host?.dataset.videoId || '';
  const start = Number(source?.dataset.start || host?.dataset.start || '0');
  const url = source?.dataset.youtubeSourceUrl || host?.dataset.youtubeSourceUrl || `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}${start ? `&t=${start}s` : ''}`;
  const ok = await copyToClipboard(url);
  const label = button.dataset[ok ? 'copiedLabel' : 'copyFailedLabel'] || '';
  button.dataset.copyState = ok ? 'copied' : 'error';
  button.innerHTML = ok ? copiedIcon : failedIcon;
  button.setAttribute('aria-label', label);
  button.title = label;
  window.setTimeout(() => {
    if (!button.isConnected) return;
    button.dataset.copyState = 'idle';
    button.innerHTML = copyIcon;
    const idle = button.dataset.copyLabel || '';
    button.setAttribute('aria-label', idle);
    button.title = idle;
  }, 2000);
  return ok;
}

function bindYouTubeToolbar(toolbar: HTMLElement) {
  if (toolbar.dataset.youtubeBound) return;
  toolbar.dataset.youtubeBound = 'true';
  toolbar.addEventListener('click', event => {
    const target = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-youtube-mode-option], [data-youtube-copy]') : null;
    if (!target) return;
    event.preventDefault();
    event.stopPropagation();
    const mode = target.dataset.youtubeModeOption;
    if (isYouTubeDisplayMode(mode)) setYouTubeDisplayMode(mode);
    else void copyYouTubeUrl(target);
  });
}

export function populateYouTubeEmbed(embed: HTMLElement, labels: YouTubeLabels = DEFAULT_YOUTUBE_LABELS) {
  embed.dataset.youtubeSession ||= `youtube-${++youtubeSessionSequence}`;
  const videoId = embed.dataset.videoId || '';
  embed.innerHTML = youtubeEmbedMarkup(videoId, labels);
  const toolbar = embed.querySelector<HTMLElement>('.note-youtube-mode-control')!;
  bindYouTubeToolbar(toolbar);

  const poster = embed.querySelector<HTMLButtonElement>('.note-youtube-poster')!;
  const image = poster.querySelector<HTMLImageElement>('img')!;
  applyYouTubeDisplayMode(embed, readYouTubeDisplayMode());
  return { poster, image };
}

// The player mounts inside whichever of these owns the target right now, instead of
// `document.body`, so it inherits that ancestor's stacking context: contained beneath a
// dialog opened over the note (a sibling stacking context at the same or a higher z-index)
// instead of racing it on a single global z-index.
function playerMountRoot(target: HTMLElement): HTMLElement {
  return target.closest<HTMLElement>('.note-overlay') ?? target.closest<HTMLElement>('.app-shell') ?? document.body;
}

export function activateYouTubeEmbed(poster: HTMLElement) {
  const embed = poster.closest<HTMLElement>('.note-youtube-embed');
  const videoId = embed?.dataset.videoId;
  if (!embed || !videoId) return;
  const start = Number(embed.dataset.start || '0');
  const playerLabel = poster.dataset.youtubePlayerLabel || DEFAULT_YOUTUBE_LABELS.player;
  const key = embed.dataset.youtubeSession!;
  const surface = embed.closest<HTMLElement>('[data-note-youtube-surface]') ?? embed.parentElement ?? document.body;
  if (activePlayer?.key === key && activePlayer.surface === surface) return;
  stopYouTubePlayback();
  const host = document.createElement('div');
  host.className = 'note-youtube-persistent-player';
  host.dataset.youtubeSession = key;
  host.dataset.videoId = videoId;
  host.dataset.start = String(start);
  host.dataset.youtubeSourceUrl = embed.dataset.youtubeSourceUrl || '';
  const toolbar = embed.querySelector('.note-youtube-mode-control');
  if (toolbar) {
    bindYouTubeToolbar(toolbar as HTMLElement);
    host.append(toolbar);
  }
  host.append(createYouTubeIframe(videoId, start, playerLabel));
  embed.dataset.youtubePlaying = 'true';
  const player = { key, host, route: location.pathname, frame: 0, target: embed, surface };
  activePlayer = player;
  const position = () => {
    if (activePlayer !== player) return;
    if (location.pathname !== player.route) {
      host.remove();
      activePlayer = null;
      return;
    }
    const target = player.target.isConnected ? player.target : [...player.surface.querySelectorAll<HTMLElement>('.note-youtube-embed')].find(candidate => candidate.dataset.youtubeSession === key);
    if (target) {
      player.target = target;
      // Re-picked every frame: reparenting here (instead of once at activation) keeps the
      // host correctly layered when the note itself moves surfaces, e.g. zooming in or out
      // while the video plays.
      const root = playerMountRoot(target);
      if (host.parentElement !== root) root.append(host);
      const rootBox = root.getBoundingClientRect();
      const box = target.getBoundingClientRect();
      host.style.transform = `translate(${box.left - rootBox.left}px, ${box.top - rootBox.top}px)`;
      host.style.width = `${box.width}px`;
      host.style.height = `${box.height}px`;
      let top = 0;
      let left = 0;
      let right = window.innerWidth;
      let bottom = window.innerHeight;
      for (let ancestor = target.parentElement; ancestor && ancestor !== document.body; ancestor = ancestor.parentElement) {
        const style = getComputedStyle(ancestor);
        if (/(auto|scroll|hidden|clip)/.test(`${style.overflow} ${style.overflowX} ${style.overflowY}`)) {
          const clip = ancestor.getBoundingClientRect();
          top = Math.max(top, clip.top);
          left = Math.max(left, clip.left);
          right = Math.min(right, clip.right);
          bottom = Math.min(bottom, clip.bottom);
        }
      }
      const visible = box.right > left && box.left < right && box.bottom > top && box.top < bottom;
      host.style.clipPath = visible ? `inset(${Math.max(0, top - box.top)}px ${Math.max(0, box.right - right)}px ${Math.max(0, box.bottom - bottom)}px ${Math.max(0, left - box.left)}px)` : 'inset(100%)';
      host.style.visibility = visible ? 'visible' : 'hidden';
      target.dataset.youtubePlaying = 'true';
    } else {
      host.style.transform = 'translate(-10000px, -10000px)';
      host.style.visibility = 'hidden';
    }
    player.frame = requestAnimationFrame(position);
  };
  position();
}
import { copyToClipboard } from './clipboard.js';
