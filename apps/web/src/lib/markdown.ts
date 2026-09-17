import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { parseYouTubeUrl } from '@mygitnotes/core/screen-page';
import { parseR2Reference, r2AssetUrl, r2PreviewType } from '@mygitnotes/core/r2-references';
import { headingSlug, resolveWorkspaceHref } from './workspace-links.js';
import { stripMdxImports, transformDirectives, transformMdxComponents } from './directives.js';

export const DOMPURIFY_DIRECTIVE_CONFIG = {
  ADD_TAGS: [
    'iframe',
    'details',
    'summary',
    'aside',
    'section',
    'article',
    'header',
    'footer',
    'figure',
    'figcaption',
    'abbr',
    'svg',
    'path',
    'circle',
    'cite'
  ],
  ADD_ATTR: [
    'allow',
    'allowfullscreen',
    'loading',
    'data-video-id',
    'data-start',
    'controls',
    'preload',
    'data-type',
    'data-variant',
    'data-stat',
    'data-cols',
    'data-col-span',
    'data-direction',
    'data-arrow',
    'data-icon',
    'data-qrcode',
    'data-size',
    'data-component-name',
    'data-lucide',
    'data-slide-index',
    'data-vertical',
    'data-label',
    'data-card-type',
    'open',
    'aria-label',
    'aria-hidden',
    'style',
    'viewBox',
    'fill',
    'stroke',
    'stroke-width',
    'stroke-linecap',
    'stroke-linejoin'
  ]
};

export function renderNote(content: string, notePath: string, tableLabel = 'Horizontally scrollable table (Alt + wheel)'): string {
  const isMdx = /\.mdx$/i.test(notePath);
  let preprocessed = content;
  if (isMdx) {
    preprocessed = stripMdxImports(preprocessed);
  }

  preprocessed = transformDirectives(preprocessed, md => marked.parse(md, { gfm: true, breaks: true }) as string);

  if (isMdx || /<(?:YouTubeEmbed|YouTube|ProtectedContent|Card|Tag|Badge|[A-Z][a-zA-Z0-9_-]*)\b/.test(preprocessed)) {
    preprocessed = transformMdxComponents(preprocessed);
  }

  const rawHtml = marked.parse(preprocessed, { gfm: true, breaks: true }) as string;
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
    if (r2Key !== null) { image.replaceWith(r2Preview(parsed, r2Key, notePath, image.getAttribute('alt') || '')); continue; }
    const target = resolveWorkspaceHref(src, notePath);
    if (target && target.kind !== 'external') {
      image.dataset.workspaceLink = src; image.dataset.sourcePath = notePath;
      image.tabIndex = 0; image.setAttribute('role', 'button');
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
        embed.innerHTML = `<button type="button" class="note-youtube-poster" aria-label="Play YouTube video"><img src="https://img.youtube.com/vi/${encodeURIComponent(video.videoId)}/hqdefault.jpg" alt="" loading="lazy" /><span class="note-youtube-play-btn" aria-hidden="true"><svg width="48" height="48" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg></span></button>`;
        p.replaceWith(embed);
      }
    }
  }
  for (const link of parsed.querySelectorAll('a')) {
    const href = link.getAttribute('href') || '';
    if (href.startsWith('/r2-assets/')) continue;
    const r2Key = parseR2Reference(href);
    if (r2Key !== null) {
      link.setAttribute('href', r2AssetUrl(r2Key, notePath)); link.setAttribute('target', '_blank'); link.setAttribute('rel', 'noopener noreferrer');
      continue;
    }
    const target = resolveWorkspaceHref(href, notePath);
    if (!target) { link.removeAttribute('href'); continue; }
    link.dataset.workspaceLink = href; link.dataset.sourcePath = notePath;
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
    link.setAttribute('href', url); link.setAttribute('target', '_blank'); link.setAttribute('rel', 'noopener noreferrer');
    const icon = doc.createElement('span');
    icon.className = 'note-r2-file-icon';
    icon.textContent = '📎';
    const text = doc.createElement('span');
    text.className = 'note-r2-file-name';
    text.textContent = name;
    const badge = doc.createElement('span');
    badge.className = 'note-r2-file-badge';
    badge.textContent = 'R2';
    link.append(icon); link.append(text); link.append(badge);
    figure.append(link);
    return figure;
  }
  const media = doc.createElement(kind === 'pdf' ? 'iframe' : kind === 'image' ? 'img' : kind);
  media.setAttribute('src', url);
  if (kind === 'pdf') { media.setAttribute('title', name); media.setAttribute('loading', 'lazy'); }
  else if (kind === 'image') { media.setAttribute('alt', label); media.setAttribute('loading', 'lazy'); }
  else { media.setAttribute('controls', ''); media.setAttribute('preload', 'metadata'); }
  const caption = doc.createElement('figcaption');
  const open = doc.createElement('a');
  open.setAttribute('href', url); open.setAttribute('target', '_blank'); open.setAttribute('rel', 'noopener noreferrer');
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
