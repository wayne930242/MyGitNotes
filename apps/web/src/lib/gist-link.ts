/**
 * Where a published note's Gist opens: the `html_url` the Gist API returned when it was published, kept in the note's
 * `gist_url` frontmatter, so a Gist on a GitHub Enterprise site opens on that site. Frontmatter is repository content,
 * so only an HTTPS address that ends in the Gist's own id is followed; a note published before the address was
 * recorded, or one with an address that fails the check, opens on gist.github.com.
 */
export function gistLink(id: string, stored: unknown): string {
  if (typeof stored === 'string') {
    try {
      const url = new URL(stored);
      if (url.protocol === 'https:' && !url.username && !url.password && url.pathname.split('/').filter(Boolean).pop() === id) return url.href;
    } catch {
      // An address that does not parse is the same as none.
    }
  }
  return `https://gist.github.com/${encodeURIComponent(id)}`;
}
