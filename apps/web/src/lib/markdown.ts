import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { parseYouTubeUrl } from '@github-notes/core/screen-page';
import { headingSlug, resolveWorkspaceHref } from './workspace-links.js';

export function renderNote(content: string, notePath: string, tableLabel = 'Horizontally scrollable table (Alt + wheel)'): string {
  const parsed = new DOMParser().parseFromString(DOMPurify.sanitize(marked.parse(content, { gfm: true, breaks: true }) as string), 'text/html');
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
    const target = resolveWorkspaceHref(href, notePath);
    if (!target) { link.removeAttribute('href'); continue; }
    link.dataset.workspaceLink = href; link.dataset.sourcePath = notePath;
    link.setAttribute('rel', 'noopener noreferrer');
    if (target.kind === 'external') link.setAttribute('target', '_blank');
  }
  return DOMPurify.sanitize(parsed.body.innerHTML, {
    ADD_TAGS: ['iframe'],
    ADD_ATTR: ['allow', 'allowfullscreen', 'loading', 'data-video-id', 'data-start']
  });
}
