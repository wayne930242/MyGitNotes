import { marked } from 'marked';
import DOMPurify from 'dompurify';

export function renderNote(content: string, notePath: string): string {
  const parsed = new DOMParser().parseFromString(DOMPurify.sanitize(marked.parse(content, { gfm: true, breaks: true }) as string), 'text/html');
  for (const image of parsed.querySelectorAll('img')) {
    const src = image.getAttribute('src') || '';
    if (!/^(https?:|data:|\/|#)/i.test(src)) {
      const base = new URL(`/raw-assets/${notePath.split('/').map(encodeURIComponent).join('/')}`, window.location.origin);
      const resolved = new URL(src, base);
      if (resolved.pathname.startsWith('/raw-assets/')) image.setAttribute('src', resolved.pathname);
      else image.remove();
    }
  }
  for (const link of parsed.querySelectorAll('a')) { link.setAttribute('rel', 'noopener noreferrer'); }
  return DOMPurify.sanitize(parsed.body.innerHTML);
}
