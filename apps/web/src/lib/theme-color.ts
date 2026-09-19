// Canvas APIs cannot read CSS custom properties, so graph painting resolves token
// expressions to concrete colours here. Results are cached per active theme.
let probe: HTMLElement | undefined;
let cacheKey = '';
const cache = new Map<string, string>();

export function themeColor(css: string): string {
  const root = document.documentElement;
  const key = `${root.getAttribute('data-theme')}:${root.getAttribute('data-theme-mode')}`;
  if (key !== cacheKey) {
    cache.clear();
    cacheKey = key;
  }
  const cached = cache.get(css);
  if (cached) return cached;
  if (!probe) {
    probe = document.createElement('span');
    probe.style.display = 'none';
    document.body.appendChild(probe);
  }
  probe.style.color = css;
  const resolved = getComputedStyle(probe).color;
  cache.set(css, resolved);
  return resolved;
}

/** A token at partial opacity, for canvas strokes and fills. */
export const tokenAlpha = (token: string, percent: number) => `color-mix(in srgb, var(--color-${token}) ${percent}%, transparent)`;
