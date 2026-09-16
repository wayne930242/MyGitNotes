import { describe, expect, it } from 'vitest';
import { presignR2Object, r2ReferenceKeys, r2SettingsFromEnv } from '../src/index.js';

describe('R2 references', () => {
  it('extracts keys from Markdown images and links, including angle-bracket and encoded keys', () => {
    const markdown = '![Rules](<r2:trpg/Tales from the old west/Core.pdf>)\n[clip](r2:media/a%20b.mp4) [web](https://r2.dev/x) `r2:ignored`';
    expect(r2ReferenceKeys(markdown)).toEqual(['trpg/Tales from the old west/Core.pdf', 'media/a b.mp4']);
  });

  it('requires every R2 setting before enabling storage', () => {
    expect(r2SettingsFromEnv({ MYGITNOTES_R2_ACCOUNT_ID: 'acc', MYGITNOTES_R2_BUCKET: 'b' })).toBeNull();
  });

  it('presigns a short-lived inline GET for previewable objects', async () => {
    const url = new URL(await presignR2Object({ accountId: 'acc', accessKeyId: 'AK', secretAccessKey: 'SK', bucket: 'private' }, 'a b/Core.pdf'));
    expect(url.origin + url.pathname).toBe('https://acc.r2.cloudflarestorage.com/private/a%20b/Core.pdf');
    expect(url.searchParams.get('X-Amz-Expires')).toBe('300');
    expect(url.searchParams.get('X-Amz-Signature')).toMatch(/^[a-f0-9]{64}$/);
    expect(url.searchParams.get('response-content-type')).toBe('application/pdf');
    expect(url.searchParams.get('response-content-disposition')).toMatch(/^inline;/);
    expect(url.toString()).not.toContain('SK');
  });
});
