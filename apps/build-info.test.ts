import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readBuildInfo } from './build-info.mjs';

const roots: string[] = [];
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'product-version-'));
  roots.push(root);
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ version: '1.2.3' }));
  return root;
}
afterEach(() => roots.splice(0).forEach(root => fs.rmSync(root, { recursive: true, force: true })));
describe('product build identity', () => {
  it('resolves Vercel metadata without a git checkout', () => {
    expect(readBuildInfo({ root: fixture(), env: { VERCEL_GIT_COMMIT_SHA: 'abcdef0123456789' } })).toEqual({ version: '1.2.3', sha: 'abcdef0', released: false });
  });
  it('makes missing provenance explicit', () => {
    expect(readBuildInfo({ root: fixture(), env: {} })).toEqual({ version: '1.2.3', sha: 'unknown', released: false });
  });
  it('accepts the matching tag and rejects a mismatched tagged CI build', () => {
    const root = fixture();
    expect(readBuildInfo({ root, env: { GITHUB_REF_TYPE: 'tag', GITHUB_REF_NAME: 'v1.2.3' } }).released).toBe(true);
    expect(() => readBuildInfo({ root, env: { GITHUB_REF: 'refs/tags/v9.0.0' } })).toThrow('Release version mismatch');
  });
  it('prefers the explicit release HEAD over the workflow triggering SHA', () => {
    expect(readBuildInfo({ root: fixture(), env: { MYGITNOTES_BUILD_SHA: 'abcdef0123456789', GITHUB_SHA: '123456789abcdef0', MYGITNOTES_BUILD_TAG: 'v1.2.3' } })).toEqual({ version: '1.2.3', sha: 'abcdef0', released: true });
  });
});
