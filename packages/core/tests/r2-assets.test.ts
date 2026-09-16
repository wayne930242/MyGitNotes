import { describe, expect, it } from 'vitest';
import { parseR2Reference, presignR2Object, r2ReferenceKeys, r2SettingsFromEnv } from '../src/index.js';

describe('R2 references', () => {
  it('extracts keys from Markdown images and links, including angle-bracket and encoded keys', () => {
    const markdown = '![Rules](<r2:trpg/Tales from the old west/Core.pdf>)\n[clip](r2:media/a%20b.mp4) [web](https://r2.dev/x) `r2:ignored`';
    expect(r2ReferenceKeys(markdown)).toEqual(['trpg/Tales from the old west/Core.pdf', 'media/a b.mp4']);
  });

  it('extracts keys from reference-style link definitions and raw HTML src/href attributes', () => {
    const markdown = '[download][map]\n\n[map]: r2:maps/region.webp\n\n<img src="r2:diagram.png">\n<a href="r2:report.pdf">Report</a>';
    expect(r2ReferenceKeys(markdown)).toEqual(['maps/region.webp', 'diagram.png', 'report.pdf']);
  });

  it('rejects references that could escape the configured bucket', () => {
    expect(parseR2Reference('r2:../secret.pdf')).toBeNull();
    expect(parseR2Reference('r2:/etc/passwd')).toBeNull();
    expect(parseR2Reference('r2:a/../../b.pdf')).toBeNull();
    expect(parseR2Reference('r2:sub%2F..%2F..%2Fother-bucket/secret.pdf')).toBeNull();
    expect(r2ReferenceKeys('[bad](r2:../secret.pdf)')).toEqual([]);
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

  it('rejects presigning a key that could escape the configured bucket', async () => {
    const settings = { accountId: 'acc', accessKeyId: 'AK', secretAccessKey: 'SK', bucket: 'private' };
    await expect(presignR2Object(settings, 'sub/../../other-bucket/secret.pdf')).rejects.toThrow(/path traversal/i);
    await expect(presignR2Object(settings, '/etc/passwd')).rejects.toThrow(/path traversal/i);
  });

  it("percent-encodes a single quote in the RFC 5987 filename", async () => {
    const url = new URL(await presignR2Object({ accountId: 'acc', accessKeyId: 'AK', secretAccessKey: 'SK', bucket: 'private' }, "User's Guide.pdf"));
    expect(url.searchParams.get('response-content-disposition')).toContain("filename*=UTF-8''User%27s%20Guide.pdf");
  });
});
