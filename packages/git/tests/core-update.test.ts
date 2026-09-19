import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { runGit, stageAndCommit } from '../src/git-service.js';
import { updateCore } from '../src/core-update.js';

describe('Core Update Engine Rules', () => {
  let upstreamRepo: string;
  let userRepo: string;

  beforeEach(async () => {
    // 1. Create upstream repository with core branch
    upstreamRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-notes-upstream-'));
    await runGit(['init', '-b', 'core'], upstreamRepo);
    await runGit(['config', 'user.name', 'Core Team'], upstreamRepo);
    await runGit(['config', 'user.email', 'core@example.com'], upstreamRepo);

    fs.writeFileSync(path.join(upstreamRepo, 'README.md'), '# Product Core v1');
    await stageAndCommit(upstreamRepo, ['README.md'], 'initial core commit');

    // 2. Clone into userRepo, which checks out core
    userRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-notes-user-'));
    await runGit(['clone', upstreamRepo, userRepo], os.tmpdir());
    await runGit(['config', 'user.name', 'User'], userRepo);
    await runGit(['config', 'user.email', 'user@example.com'], userRepo);
  });

  afterEach(() => {
    if (fs.existsSync(upstreamRepo)) fs.rmSync(upstreamRepo, { recursive: true, force: true });
    if (fs.existsSync(userRepo)) fs.rmSync(userRepo, { recursive: true, force: true });
  });

  it('refuses to run update on a branch other than core', async () => {
    await runGit(['checkout', '-b', 'feature'], userRepo);
    await expect(updateCore({ repoRoot: userRepo })).rejects.toMatchObject({ code: 'INVALID_BRANCH' });
  });

  it('fast-forwards a core checkout and leaves workspace migration to the new Core', async () => {
    expect((await updateCore({ repoRoot: userRepo })).alreadyUpToDate).toBe(true);
    fs.writeFileSync(path.join(upstreamRepo, 'NEW_FEATURE.md'), '# New Core Feature');
    await stageAndCommit(upstreamRepo, ['NEW_FEATURE.md'], 'feat: add new feature');
    const result = await updateCore({ repoRoot: userRepo });
    expect(result).toMatchObject({ success: true, alreadyUpToDate: false });
    expect(result.message).toContain('pnpm migrate-workspace');
    expect((await runGit(['rev-parse', 'HEAD'], userRepo)).stdout).toBe((await runGit(['rev-parse', 'HEAD'], upstreamRepo)).stdout);
    expect((await runGit(['log', '--merges', '--oneline'], userRepo)).stdout).toBe('');
  });

  it('refuses to fast-forward a core checkout with local commits', async () => {
    fs.writeFileSync(path.join(userRepo, 'LOCAL.md'), 'local');
    await stageAndCommit(userRepo, ['LOCAL.md'], 'local core commit');
    fs.writeFileSync(path.join(upstreamRepo, 'NEW_FEATURE.md'), '# New Core Feature');
    await stageAndCommit(upstreamRepo, ['NEW_FEATURE.md'], 'feat: add new feature');
    const head = (await runGit(['rev-parse', 'HEAD'], userRepo)).stdout;
    await expect(updateCore({ repoRoot: userRepo })).rejects.toMatchObject({ code: 'CORE_DIVERGED' });
    expect((await runGit(['rev-parse', 'HEAD'], userRepo)).stdout).toBe(head);
  });

  it('refuses main and points a product-carrying main at convert-workspace', async () => {
    await runGit(['checkout', '-b', 'main'], userRepo);
    const head = (await runGit(['rev-parse', 'HEAD'], userRepo)).stdout;
    await expect(updateCore({ repoRoot: userRepo })).rejects.toMatchObject({ code: 'INVALID_BRANCH', message: expect.stringContaining('pnpm convert-workspace') });
    expect((await runGit(['rev-parse', 'HEAD'], userRepo)).stdout).toBe(head);
  });

  it('requires an explicit checkout path to be the repository root', async () => {
    fs.mkdirSync(path.join(userRepo, 'notes'));
    await expect(updateCore({ repoRoot: path.join(userRepo, 'notes') })).rejects.toMatchObject({ code: 'NOT_REPO_ROOT' });
  });

  it('refuses to run update if working tree is dirty without auto-stashing', async () => {
    fs.writeFileSync(path.join(userRepo, 'dirty-note.md'), 'uncommitted content');
    await expect(updateCore({ repoRoot: userRepo })).rejects.toThrow(/Working tree has uncommitted modifications.*Auto-stash is strictly prohibited/);
  });
});
