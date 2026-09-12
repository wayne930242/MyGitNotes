import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { runGit, stageAndCommit } from '../src/git-service.js';
import { updateCore, CoreUpdateError } from '../src/core-update.js';
import { WORKSPACE_CONFIG_FILENAME } from '@github-notes/core';

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

    // 2. Clone into userRepo and switch to main
    userRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-notes-user-'));
    await runGit(['clone', upstreamRepo, userRepo], os.tmpdir());
    await runGit(['config', 'user.name', 'User'], userRepo);
    await runGit(['config', 'user.email', 'user@example.com'], userRepo);
  });

  afterEach(() => {
    if (fs.existsSync(upstreamRepo)) fs.rmSync(upstreamRepo, { recursive: true, force: true });
    if (fs.existsSync(userRepo)) fs.rmSync(userRepo, { recursive: true, force: true });
  });

  it('refuses to run update if active branch is not main', async () => {
    // Current branch is core
    await expect(updateCore({ repoRoot: userRepo })).rejects.toThrow(
      /Core updates can only be merged into the user workspace branch 'main'/
    );
  });

  it('refuses to run update if working tree is dirty without auto-stashing', async () => {
    // Checkout main
    await runGit(['checkout', '-b', 'main'], userRepo);

    // Create .github-notes.yaml
    fs.writeFileSync(
      path.join(userRepo, WORKSPACE_CONFIG_FILENAME),
      `schema_version: 1\nworkspace:\n  title: "My Notes"\n  default_notebook: example\nnotebooks:\n  - id: example\n    title: "Example"\n    root: notes/example\n`
    );
    await stageAndCommit(userRepo, [WORKSPACE_CONFIG_FILENAME], 'init workspace');

    // Make dirty change
    fs.writeFileSync(path.join(userRepo, 'dirty-note.md'), 'uncommitted content');

    await expect(updateCore({ repoRoot: userRepo })).rejects.toThrow(
      /Working tree has uncommitted modifications.*Auto-stash is strictly prohibited/
    );
  });

  it('successfully merges new Core updates into main non-destructively', async () => {
    // Set up user workspace on main
    await runGit(['checkout', '-b', 'main'], userRepo);
    fs.writeFileSync(
      path.join(userRepo, WORKSPACE_CONFIG_FILENAME),
      `schema_version: 1\nworkspace:\n  title: "My Notes"\n  default_notebook: example\nnotebooks:\n  - id: example\n    title: "Example"\n    root: notes/example\n`
    );
    fs.mkdirSync(path.join(userRepo, 'notes/example'), { recursive: true });
    fs.writeFileSync(path.join(userRepo, 'notes/example/user-note.md'), '# My Personal Note');
    await stageAndCommit(userRepo, [WORKSPACE_CONFIG_FILENAME, 'notes/example/user-note.md'], 'init workspace');

    // Add new release in upstream core
    fs.writeFileSync(path.join(upstreamRepo, 'NEW_FEATURE.md'), '# New Core Feature');
    await stageAndCommit(upstreamRepo, ['NEW_FEATURE.md'], 'feat: add new feature');

    // Run updateCore on userRepo
    const result = await updateCore({ repoRoot: userRepo });
    expect(result.success).toBe(true);
    expect(result.alreadyUpToDate).toBe(false);

    // Verify upstream file is present AND user's note is completely intact!
    expect(fs.existsSync(path.join(userRepo, 'NEW_FEATURE.md'))).toBe(true);
    expect(fs.readFileSync(path.join(userRepo, 'notes/example/user-note.md'), 'utf-8')).toBe(
      '# My Personal Note'
    );
  });
});
