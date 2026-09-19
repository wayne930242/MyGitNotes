import { describe, expect, it } from 'vitest';
import { isNotebookR2Key, parseR2Reference, presignR2Object, presignR2Upload, r2NotebookPrefix, r2ReferenceKeys, r2SettingsFromEnv, rewriteR2References } from '../src/index.js';

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

  it('percent-encodes a single quote in the RFC 5987 filename', async () => {
    const url = new URL(await presignR2Object({ accountId: 'acc', accessKeyId: 'AK', secretAccessKey: 'SK', bucket: 'private' }, "User's Guide.pdf"));
    expect(url.searchParams.get('response-content-disposition')).toContain("filename*=UTF-8''User%27s%20Guide.pdf");
  });
});

describe('R2 management helpers', () => {
  it('scopes keys to a notebook prefix and rejects keys outside it', () => {
    expect(r2NotebookPrefix('ex')).toBe('ex/');
    expect(isNotebookR2Key('ex/a/b.pdf', 'ex')).toBe(true);
    expect(isNotebookR2Key('other/b.pdf', 'ex')).toBe(false);
    expect(isNotebookR2Key('ex/../other/b.pdf', 'ex')).toBe(false);
    expect(isNotebookR2Key('ex', 'ex')).toBe(false);
  });

  it('rewrites every reference form the scanner detects and leaves other keys untouched', () => {
    const markdown = '![Rules](<r2:ex/old/Core Rules.pdf>)\n[clip](r2:ex/old/a%20b.mp4) [keep](r2:ex/keep.pdf)\n\n[map]: r2:ex/old/map.webp\n\n<img src="r2:ex/old/d.png">';
    const next = rewriteR2References(markdown, { 'ex/old/Core Rules.pdf': 'ex/new/Core Rules.pdf', 'ex/old/a b.mp4': 'ex/new/a b.mp4', 'ex/old/map.webp': 'ex/new/map.webp', 'ex/old/d.png': 'ex/new/d.png' });
    expect(next).toBe('![Rules](<r2:ex/new/Core Rules.pdf>)\n[clip](r2:ex/new/a%20b.mp4) [keep](r2:ex/keep.pdf)\n\n[map]: r2:ex/new/map.webp\n\n<img src="r2:ex/new/d.png">');
    expect(r2ReferenceKeys(next).sort()).toEqual(['ex/keep.pdf', 'ex/new/Core Rules.pdf', 'ex/new/a b.mp4', 'ex/new/d.png', 'ex/new/map.webp']);
    expect(rewriteR2References('no refs', { a: 'b' })).toBe('no refs');
  });

  it('uses a configured endpoint for presigned uploads', async () => {
    const url = new URL(await presignR2Upload({ accountId: 'acc', accessKeyId: 'AK', secretAccessKey: 'SK', bucket: 'private', endpoint: 'http://127.0.0.1:9000' }, 'ex/a b.pdf'));
    expect(url.origin + url.pathname).toBe('http://127.0.0.1:9000/private/ex/a%20b.pdf');
    expect(url.searchParams.get('X-Amz-Signature')).toMatch(/^[a-f0-9]{64}$/);
    expect(r2SettingsFromEnv({ MYGITNOTES_R2_ACCOUNT_ID: 'a', MYGITNOTES_R2_ACCESS_KEY_ID: 'b', MYGITNOTES_R2_SECRET_ACCESS_KEY: 'c', MYGITNOTES_R2_BUCKET: 'd', MYGITNOTES_R2_ENDPOINT: 'http://127.0.0.1:9000/' })?.endpoint).toBe('http://127.0.0.1:9000');
  });
});
