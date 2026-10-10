import { expect, it } from 'vitest';
import { detectKeyEnvironment } from './platform.js';

it('prefers userAgentData, then navigator.platform, for the platform', () => {
  expect(detectKeyEnvironment({ userAgentData: { platform: 'macOS', brands: [{ brand: 'Google Chrome' }] }, platform: 'Linux x86_64' })).toEqual({ platform: 'mac', browser: 'chrome' });
  expect(detectKeyEnvironment({ platform: 'MacIntel', userAgent: 'Mozilla/5.0 (Macintosh) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.0 Safari/605.1.15' })).toEqual({ platform: 'mac', browser: 'safari' });
  expect(detectKeyEnvironment({ platform: 'iPad' }).platform).toBe('mac');
  expect(detectKeyEnvironment({ platform: 'Win32', userAgent: 'Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0 Safari/537.36 Edg/155.0' })).toEqual({ platform: 'other', browser: 'edge' });
  expect(detectKeyEnvironment({ platform: 'Linux x86_64', userAgent: 'Mozilla/5.0 (X11; Linux x86_64; rv:157.0) Gecko/20100101 Firefox/157.0' })).toEqual({ platform: 'other', browser: 'firefox' });
  expect(detectKeyEnvironment(null)).toEqual({ platform: 'other', browser: 'other' });
});
