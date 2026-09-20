import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// This lives under `apps/` rather than `scripts/` because the Vercel sparse checkout lists `apps`
// and treats `scripts` as a non-deploy path, and `apps/web/vite.config.ts` imports it at build time.
export const productRoot = fileURLToPath(new URL('../', import.meta.url));

export function readBuildInfo({ root = productRoot, env = process.env } = {}) {
  const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
  const git = (...args) => {
    try {
      return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    } catch {
      return '';
    }
  };
  const sha = env.MYGITNOTES_BUILD_SHA || env.VERCEL_GIT_COMMIT_SHA || env.GITHUB_SHA || git('rev-parse', 'HEAD');
  const refTag = env.GITHUB_REF_TYPE === 'tag' ? env.GITHUB_REF_NAME : env.GITHUB_REF?.startsWith('refs/tags/') ? env.GITHUB_REF.slice(10) : '';
  const tags = [env.MYGITNOTES_BUILD_TAG, refTag, ...(sha ? git('tag', '--points-at', sha).split('\n').filter(tag => /^v\d/.test(tag)) : [])].filter(Boolean);
  for (const tag of tags) {
    if (tag !== `v${version}`) throw new Error(`Release version mismatch: package.json is ${version}, tag is ${tag}`);
  }
  if (sha && !/^[a-f0-9]{7,40}$/i.test(sha)) throw new Error('Build commit SHA must be a hexadecimal Git object ID');
  return { version, sha: sha ? sha.slice(0, 7) : 'unknown', released: tags.length > 0 };
}
