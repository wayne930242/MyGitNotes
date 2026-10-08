import { normalizeHttpsSiteUrl } from './site-url.js';

export const GITHUB_COM = 'https://github.com';

/** The GitHub site a deployment names: absent for github.com, which every default path keeps meaning. */
export function normalizeGitHubUrl(value: unknown): string | undefined {
  const url = normalizeHttpsSiteUrl(value, 'GitHub');
  return url === GITHUB_COM ? undefined : url;
}

/** Where one GitHub site keeps its web pages and APIs: github.com, a data-residency `*.ghe.com` site, or a GitHub Enterprise Server. */
export interface GitHubSite {
  /** The site's web root, without a trailing slash. */
  web: string;
  /** REST API root. */
  api: string;
  graphql: string;
  enterprise: boolean;
  /** Whether an archive download may follow a redirect to `location`. */
  archiveAllowed(location: URL): boolean;
  /** The page that installs the GitHub App `slug` for an account. */
  installUrl(slug: string): string;
}

/** The site named by a source's `url`; github.com when there is none. */
export function githubSite(url?: string): GitHubSite {
  if (!url || url === GITHUB_COM) {
    return { web: GITHUB_COM, api: 'https://api.github.com', graphql: 'https://api.github.com/graphql', enterprise: false, archiveAllowed: location => location.protocol === 'https:' && location.hostname === 'codeload.github.com' && !location.port && !location.username && !location.password, installUrl: slug => `${GITHUB_COM}/apps/${encodeURIComponent(slug)}/installations/new` };
  }
  const site = new URL(url);
  const residency = site.hostname.endsWith('.ghe.com');
  return {
    web: url,
    api: residency ? `https://api.${site.hostname}` : `${url}/api/v3`,
    graphql: residency ? `https://api.${site.hostname}/graphql` : `${url}/api/graphql`,
    enterprise: true,
    // The site's own codeload only: a `/codeload/` path on its host, or the `codeload.` subdomain of subdomain isolation,
    // on the port the site itself is configured with.
    archiveAllowed: location => location.protocol === 'https:' && location.port === site.port && !location.username && !location.password && (location.hostname === `codeload.${site.hostname}` || location.hostname === site.hostname && location.pathname.startsWith('/codeload/')),
    installUrl: slug => `${url}/github-apps/${encodeURIComponent(slug)}/installations/new`,
  };
}
