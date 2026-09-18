import { it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { nonDeployPaths } from './vercel-sparse-non-deploy-paths.mjs';

const listFile = '.github/vercel-sparse-paths.txt';

it('fails when the sparse path list or workflow filter misses a product path', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'github-notes-sparse-paths-'));
  const check = () => execFileSync(process.execPath, [path.resolve('scripts/check-vercel-sparse-paths.mjs'), '--core'], {cwd:root,stdio:'pipe'});
  const git = (...args: string[]) => execFileSync('git', args, {cwd:root,stdio:'pipe'}).toString();
  const edit = (file: string, from: string, to: string) => fs.writeFileSync(path.join(root, file), fs.readFileSync(path.join(root, file), 'utf8').replace(from, to));
  try {
    execFileSync('git', ['worktree', 'add', '--detach', root, 'HEAD'], {stdio:'pipe'});
    for (const file of [listFile, '.github/workflows/deploy-vercel-sparse.yml', 'scripts/check-vercel-sparse-paths.mjs', 'scripts/vercel-sparse-non-deploy-paths.mjs']) fs.copyFileSync(file, path.join(root, file));
    // In a workspace repo, HEAD also carries content/agent top-level paths Core never tracks;
    // strip anything the fixture's own copied list doesn't own so the fixture always looks like Core.
    const listedTopLevel = fs.readFileSync(path.join(root, listFile), 'utf8').split('\n').map(line => line.trim()).filter(line => line && !line.startsWith('#')).map(entry => entry.split('/')[0]);
    const allowedTopLevel = new Set([...nonDeployPaths, ...listedTopLevel]);
    const topLevel = new Set(git('ls-files', '-z').split('\0').filter(Boolean).map(file => file.split('/')[0]));
    for (const entry of topLevel) if (!allowedTopLevel.has(entry)) fs.rmSync(path.join(root, entry), {recursive:true, force:true});
    git('add', '.');
    expect(() => check()).not.toThrow();
    edit(listFile, 'apps\n', '');
    expect(() => check()).toThrow(/'apps'/);
    edit(listFile, 'api\n', 'api\napps\n');
    edit('.github/workflows/deploy-vercel-sparse.yml', "      - 'apps/**'\n", '');
    expect(() => check()).toThrow(/push paths/);
    edit('.github/workflows/deploy-vercel-sparse.yml', "      - 'api/**'\n", "      - 'api/**'\n      - 'apps/**'\n");
    edit(listFile, 'scripts/lib\n', '');
    edit('.github/workflows/deploy-vercel-sparse.yml', "      - 'scripts/lib/**'\n", '');
    expect(() => check()).toThrow(/workspace-agent-merge\.mjs', outside/);
  } finally {
    execFileSync('git', ['worktree', 'remove', '--force', root], {stdio:'pipe'});
  }
});
