/** A deployment-owned HTTPS base URL, including an optional relative installation root; `label` names the platform in errors. */
export function normalizeHttpsSiteUrl(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Configure a ${label} HTTPS site URL.`);
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label} URL must be an absolute HTTPS URL.`);
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || /[\\\s]/.test(value) || /%2f|%5c|%2e/i.test(value)) throw new Error(`${label} URL must use HTTPS with a site path and no credentials, query or fragment.`);
  return url.href.replace(/\/+$/, '');
}
