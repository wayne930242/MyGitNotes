import { Marked } from 'marked';
import markedCjkFriendly from 'marked-cjk-friendly';
import DOMPurify from 'dompurify';
import { parseYouTubeUrl } from '@mygitnotes/core/screen-page';
import { parseR2Reference, r2AssetUrl, r2PreviewType } from '@mygitnotes/core/r2-references';
import { headingSlug, resolveWorkspaceHref } from './workspace-links.js';
import { stripMdxImports, transformDirectives, transformMdxComponents } from './directives.js';
import { DEFAULT_YOUTUBE_LABELS, type YouTubeDisplayMode, type YouTubeLabels } from './youtube-embed.js';

// CommonMark cannot close emphasis when a full-width punctuation mark sits before the delimiter and
// a CJK character after it, so `**二口女（ふたくちおんな）**意象` renders as literal asterisks.
const md = new Marked(markedCjkFriendly());

export const DOMPURIFY_DIRECTIVE_CONFIG = { ADD_TAGS: ['iframe', 'details', 'summary', 'aside', 'section', 'article', 'header', 'footer', 'figure', 'figcaption', 'abbr', 'svg', 'path', 'circle', 'cite'], ADD_ATTR: ['allow', 'allowfullscreen', 'loading', 'data-video-id', 'data-start', 'data-youtube-mode', 'data-youtube-mode-option', 'data-youtube-session', 'data-youtube-source-url', 'data-youtube-copy', 'data-copy-label', 'data-copied-label', 'data-copy-failed-label', 'controls', 'preload', 'data-type', 'data-variant', 'data-stat', 'data-cols', 'data-col-span', 'data-direction', 'data-arrow', 'data-icon', 'data-qrcode', 'data-size', 'data-component-name', 'data-lucide', 'data-slide-index', 'data-vertical', 'data-label', 'data-card-type', 'open', 'aria-label', 'aria-hidden', 'style', 'viewBox', 'fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin'] };

export function renderNote(content: string, notePath: string, tableLabel = 'Horizontally scrollable table (Alt + wheel)', youtubeLabels: YouTubeLabels = DEFAULT_YOUTUBE_LABELS): string {
  const isMdx = /\.mdx$/i.test(notePath);
  let preprocessed = content;
  if (isMdx) {
    preprocessed = stripMdxImports(preprocessed);
  }

  preprocessed = transformDirectives(preprocessed, source => md.parse(source, { gfm: true, breaks: true }) as string);

  if (isMdx || /<(?:YouTubeEmbed|YouTube|ProtectedContent|Card|Tag|Badge|[A-Z][a-zA-Z0-9_-]*)\b/.test(preprocessed)) {
    preprocessed = transformMdxComponents(preprocessed);
  }

  const rawHtml = md.parse(preprocessed, { gfm: true, breaks: true }) as string;
  const parsed = new DOMParser().parseFromString(DOMPurify.sanitize(rawHtml, DOMPURIFY_DIRECTIVE_CONFIG), 'text/html');
  for (const table of parsed.querySelectorAll('table')) {
    const scroller = parsed.createElement('div');
    scroller.className = 'markdown-table-scroll';
    scroller.tabIndex = 0;
    scroller.setAttribute('role', 'region');
    scroller.setAttribute('aria-label', tableLabel);
    table.replaceWith(scroller);
    scroller.append(table);
  }
  for (const image of parsed.querySelectorAll('img')) {
    const src = image.getAttribute('src') || '';
    const r2Key = parseR2Reference(src);
    if (r2Key !== null) {
      image.replaceWith(r2Preview(parsed, r2Key, notePath, image.getAttribute('alt') || ''));
      continue;
    }
    const target = resolveWorkspaceHref(src, notePath);
    if (target && target.kind !== 'external') {
      image.dataset.workspaceLink = src;
      image.dataset.sourcePath = notePath;
      image.tabIndex = 0;
      image.setAttribute('role', 'button');
    }
    if (target?.kind === 'path') image.setAttribute('src', `/raw-assets/${target.path.split('/').map(encodeURIComponent).join('/')}`);
    else if (!target && !/^data:image\//i.test(src)) image.remove();
  }
  for (const heading of parsed.querySelectorAll<HTMLElement>('h1,h2,h3,h4,h5,h6')) heading.dataset.headingSlug = headingSlug(heading.textContent || '');
  for (const p of parsed.querySelectorAll('p')) {
    if (p.children.length === 1 && p.children[0].tagName.toLowerCase() === 'a') {
      const anchor = p.children[0] as HTMLAnchorElement;
      const href = anchor.getAttribute('href') || '';
      const video = parseYouTubeUrl(href);
      if (video && (p.textContent || '').trim() === (anchor.textContent || '').trim()) {
        const embed = parsed.createElement('div');
        embed.className = 'note-youtube-embed';
        embed.dataset.videoId = video.videoId;
        embed.dataset.start = String(video.start);
        embed.dataset.youtubeSourceUrl = href;
        p.replaceWith(embed);
      }
    }
  }
  const youtubeEmbeds = [...parsed.querySelectorAll<HTMLElement>('div')].filter(element => element.className.split(/\s+/).includes('note-youtube-embed'));
  for (const [index, embed] of youtubeEmbeds.entries()) {
    embed.dataset.youtubeSession = `${notePath}:${index}:${embed.dataset.videoId}:${embed.dataset.start}`;
    embed.dataset.youtubeMode = 'thumbnail';
    const toolbar = parsed.createElement('div');
    toolbar.className = 'note-youtube-mode-control';
    toolbar.setAttribute('role', 'group');
    toolbar.setAttribute('aria-label', youtubeLabels.modes);
    for (const [mode, label] of [['thumbnail', youtubeLabels.thumbnail], ['medium', youtubeLabels.medium], ['theater', youtubeLabels.theater]] as [YouTubeDisplayMode, string][]) {
      const control = parsed.createElement('button');
      control.setAttribute('type', 'button');
      control.dataset.youtubeModeOption = mode;
      control.textContent = label;
      control.setAttribute('title', label);
      control.setAttribute('aria-label', label);
      control.setAttribute('aria-pressed', String(mode === 'thumbnail'));
      toolbar.append(control);
    }
    const copy = parsed.createElement('button');
    copy.setAttribute('type', 'button');
    copy.className = 'note-youtube-copy';
    copy.dataset.youtubeCopy = '';
    copy.dataset.copyLabel = youtubeLabels.copy;
    copy.dataset.copiedLabel = youtubeLabels.copied;
    copy.dataset.copyFailedLabel = youtubeLabels.copyFailed;
    copy.setAttribute('aria-label', youtubeLabels.copy);
    copy.setAttribute('title', youtubeLabels.copy);
    copy.innerHTML = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>';
    toolbar.append(copy);
    const poster = parsed.createElement('button');
    poster.setAttribute('type', 'button');
    poster.className = 'note-youtube-poster';
    poster.setAttribute('aria-label', youtubeLabels.play);
    poster.dataset.youtubePlayerLabel = youtubeLabels.player;
    const image = parsed.createElement('img');
    image.setAttribute('src', `https://img.youtube.com/vi/${encodeURIComponent(embed.dataset.videoId || '')}/hqdefault.jpg`);
    image.setAttribute('alt', '');
    image.setAttribute('loading', 'lazy');
    const play = parsed.createElement('span');
    play.className = 'note-youtube-play-btn';
    play.setAttribute('aria-hidden', 'true');
    play.innerHTML = '<svg width="48" height="48" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"></path></svg>';
    poster.append(image);
    poster.append(play);
    embed.append(toolbar);
    embed.append(poster);
  }
  for (const link of parsed.querySelectorAll('a')) {
    const href = link.getAttribute('href') || '';
    if (href.startsWith('/r2-assets/')) continue;
    const r2Key = parseR2Reference(href);
    if (r2Key !== null) {
      link.setAttribute('href', r2AssetUrl(r2Key, notePath));
      link.setAttribute('target', '_blank');
      link.setAttribute('rel', 'noopener noreferrer');
      continue;
    }
    const target = resolveWorkspaceHref(href, notePath, undefined, typeof window !== 'undefined' ? window.location.origin : undefined);
    if (!target) {
      link.removeAttribute('href');
      continue;
    }
    link.dataset.workspaceLink = href;
    link.dataset.sourcePath = notePath;
    link.setAttribute('rel', 'noopener noreferrer');
    if (target.kind === 'external') link.setAttribute('target', '_blank');
  }
  return DOMPurify.sanitize(parsed.body.innerHTML, DOMPURIFY_DIRECTIVE_CONFIG);
}

function r2Preview(doc: Document, key: string, notePath: string, label: string): HTMLElement {
  const url = r2AssetUrl(key, notePath);
  const { kind } = r2PreviewType(key);
  const name = label || key.split('/').pop() || key;
  const figure = doc.createElement('figure');
  figure.className = `note-r2-asset note-r2-${kind}`;
  if (kind === 'file') {
    const link = doc.createElement('a');
    link.className = 'note-r2-file-link';
    link.setAttribute('href', url);
    link.setAttribute('target', '_blank');
    link.setAttribute('rel', 'noopener noreferrer');
    const icon = doc.createElement('span');
    icon.className = 'note-r2-file-icon';
    icon.textContent = '📎';
    const text = doc.createElement('span');
    text.className = 'note-r2-file-name';
    text.textContent = name;
    const badge = doc.createElement('span');
    badge.className = 'note-r2-file-badge';
    badge.textContent = 'R2';
    link.append(icon);
    link.append(text);
    link.append(badge);
    figure.append(link);
    return figure;
  }
  const media = doc.createElement(kind === 'pdf' ? 'iframe' : kind === 'image' ? 'img' : kind);
  media.setAttribute('src', url);
  if (kind === 'pdf') {
    media.setAttribute('title', name);
    media.setAttribute('loading', 'lazy');
  } else if (kind === 'image') {
    media.setAttribute('alt', label);
    media.setAttribute('loading', 'lazy');
  } else {
    media.setAttribute('controls', '');
    media.setAttribute('preload', 'metadata');
  }
  const caption = doc.createElement('figcaption');
  const open = doc.createElement('a');
  open.setAttribute('href', url);
  open.setAttribute('target', '_blank');
  open.setAttribute('rel', 'noopener noreferrer');
  open.textContent = name;
  const extIcon = doc.createElement('span');
  extIcon.className = 'note-r2-ext-icon';
  extIcon.textContent = ' ↗';
  open.append(extIcon);
  caption.append(open);
  figure.append(media);
  figure.append(caption);
  return figure;
}
