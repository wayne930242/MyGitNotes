export type Platform = 'mac' | 'other';
export type Browser = 'chrome' | 'edge' | 'firefox' | 'safari' | 'other';

/** The platform and browser every key label, binding condition and match is computed for. */
export interface KeyEnvironment {
  platform: Platform;
  browser: Browser;
}

interface UserAgentData {
  platform?: string;
  brands?: readonly { brand: string; }[];
}

/** The fields detection reads, so a test can pass a plain object instead of a whole `Navigator`. */
export interface NavigatorLike {
  platform?: string;
  userAgent?: string;
  userAgentData?: UserAgentData;
}

const APPLE = /mac|iphone|ipad|ipod/i;

function detectBrowser(nav: NavigatorLike): Browser {
  const brands = nav.userAgentData?.brands?.map(item => item.brand) ?? [];
  if (brands.includes('Microsoft Edge')) return 'edge';
  if (brands.includes('Google Chrome') || brands.includes('Chromium')) return 'chrome';
  const agent = nav.userAgent ?? '';
  if (/Edg\//.test(agent)) return 'edge';
  if (/Firefox\//.test(agent)) return 'firefox';
  if (/(Chrome|CriOS|Chromium)\//.test(agent)) return 'chrome';
  if (/Safari\//.test(agent)) return 'safari';
  return 'other';
}

/** Read once at startup: `navigator.userAgentData?.platform`, then `navigator.platform`; browser from `userAgentData.brands`, then the UA string. */
export function detectKeyEnvironment(nav: NavigatorLike | null = typeof navigator === 'undefined' ? null : navigator as NavigatorLike): KeyEnvironment {
  if (!nav) return { platform: 'other', browser: 'other' };
  const platform = nav.userAgentData?.platform || nav.platform || '';
  return { platform: APPLE.test(platform) ? 'mac' : 'other', browser: detectBrowser(nav) };
}

export const keyEnvironment: KeyEnvironment = detectKeyEnvironment();
