import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
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

  it('requires an explicit workspace path to be the repository root', async () => {
    await runGit(['checkout','-b','main'],userRepo);
    fs.mkdirSync(path.join(userRepo,'notes'));
    await expect(updateCore({repoRoot:path.join(userRepo,'notes')})).rejects.toMatchObject({code:'NOT_REPO_ROOT'});
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

  it('preserves tracked agent settings through Core deletion, later edits and additions', async () => {
    const write = (root: string, file: string, text: string) => {
      fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
      fs.writeFileSync(path.join(root, file), text);
    };
    const files = ['AGENTS.md', '.agents/skills/範例/SKILL.md', '.codex/agents/reviewer.toml',
      'CLAUDE.md', '.claude/skills/review/SKILL.md', 'GEMINI.md', '.agent/skills/review/SKILL.md'];
    for (const file of files) write(upstreamRepo, file, 'Core baseline\n');
    await stageAndCommit(upstreamRepo, files, 'legacy agent settings');
    await runGit(['pull', '--ff-only'], userRepo);
    await runGit(['checkout', '-b', 'main'], userRepo);
    write(userRepo, 'AGENTS.md', 'Workspace rules\n');
    await stageAndCommit(userRepo, ['AGENTS.md'], 'customize workspace rules');
    await runGit(['rm', '-r', '--', ...files], upstreamRepo);
    await runGit(['commit', '-m', 'move agent ownership to workspaces'], upstreamRepo);
    expect((await updateCore({ repoRoot: userRepo })).success).toBe(true);
    for (const file of files) {
      expect(fs.readFileSync(path.join(userRepo, file), 'utf8')).toBe(file === 'AGENTS.md' ? 'Workspace rules\n' : 'Core baseline\n');
      expect((await runGit(['ls-files', '--error-unmatch', '--', file], userRepo)).stdout).toBeTruthy();
    }
    await runGit(['rm', '--', '.codex/agents/reviewer.toml'], userRepo);
    await runGit(['commit', '-m', 'remove unused reviewer'], userRepo);
    for (const file of [...files, '.agents/skills/new/SKILL.md']) write(upstreamRepo, file, 'Unwanted Core update\n');
    write(upstreamRepo, 'feature.txt', 'Product update\n');
    await stageAndCommit(upstreamRepo, [...files, '.agents/skills/new/SKILL.md', 'feature.txt'], 'future update');
    expect((await updateCore({ repoRoot: userRepo })).success).toBe(true);
    expect(fs.readFileSync(path.join(userRepo, 'AGENTS.md'), 'utf8')).toBe('Workspace rules\n');
    expect(fs.readFileSync(path.join(userRepo, '.agents/skills/範例/SKILL.md'), 'utf8')).toBe('Core baseline\n');
    for (const file of files.slice(3)) expect(fs.readFileSync(path.join(userRepo, file), 'utf8')).toBe('Core baseline\n');
    expect(fs.existsSync(path.join(userRepo, '.codex/agents/reviewer.toml'))).toBe(false);
    expect(fs.existsSync(path.join(userRepo, '.agents/skills/new/SKILL.md'))).toBe(false);
    expect(fs.readFileSync(path.join(userRepo, 'feature.txt'), 'utf8')).toBe('Product update\n');
    expect((await runGit(['status', '--porcelain'], userRepo)).stdout).toBe('');
  });

  it('preserves ordinary product conflicts and does not commit a failed update', async () => {
    await runGit(['checkout', '-b', 'main'], userRepo);
    fs.writeFileSync(path.join(userRepo, 'README.md'), 'Workspace product edit');
    await stageAndCommit(userRepo, ['README.md'], 'local product edit');
    const head = (await runGit(['rev-parse', 'HEAD'], userRepo)).stdout;
    fs.writeFileSync(path.join(upstreamRepo, 'README.md'), 'Core product edit');
    await stageAndCommit(upstreamRepo, ['README.md'], 'upstream product edit');
    const result = await updateCore({ repoRoot: userRepo });
    expect(result.success).toBe(false);
    expect(result.conflictedFiles).toContain('README.md');
    expect((await runGit(['rev-parse', 'HEAD'], userRepo)).stdout).toBe(head);
    expect((await runGit(['rev-parse', 'MERGE_HEAD'], userRepo)).stdout).toBeTruthy();
  });

  it('migrates an old workspace using the new product CLI with an explicit workspace path', async () => {
    fs.writeFileSync(path.join(upstreamRepo, 'AGENTS.md'), '# Legacy instructions\n');
    await stageAndCommit(upstreamRepo, ['AGENTS.md'], 'legacy instructions');
    await runGit(['pull', '--ff-only'], userRepo);
    await runGit(['checkout', '-b', 'main'], userRepo);
    fs.writeFileSync(path.join(userRepo, 'AGENTS.md'), '# My workspace rules\n');
    await stageAndCommit(userRepo, ['AGENTS.md'], 'custom rules');
    await runGit(['rm', '--', 'AGENTS.md'], upstreamRepo);
    await runGit(['commit', '-m', 'workspace owns instructions'], upstreamRepo);
    const product = process.cwd();
    const productHead = (await runGit(['rev-parse','HEAD'], product)).stdout;
    const output = execFileSync(process.execPath, [path.join(product,'node_modules/tsx/dist/cli.mjs'), path.join(product,'scripts/update-core.ts'), '--workspace', userRepo], {cwd:product,encoding:'utf8',stdio:'pipe'});
    expect(output).toContain('Workspace validated successfully');
    expect(fs.readFileSync(path.join(userRepo,'AGENTS.md'),'utf8')).toBe('# My workspace rules\n');
    expect((await runGit(['ls-files','--','AGENTS.md'],userRepo)).stdout).toBe('AGENTS.md');
    expect((await runGit(['rev-parse','HEAD'], product)).stdout).toBe(productHead);
    const head = (await runGit(['rev-parse','HEAD'],userRepo)).stdout;
    expect((await updateCore({repoRoot:userRepo})).alreadyUpToDate).toBe(true);
    expect((await runGit(['rev-parse','HEAD'],userRepo)).stdout).toBe(head);
  });

  it('does not commit an update with an invalid workspace manifest', async () => {
    await runGit(['checkout','-b','main'],userRepo);
    const head = (await runGit(['rev-parse','HEAD'],userRepo)).stdout;
    fs.writeFileSync(path.join(upstreamRepo,'.github-notes.yaml'),'invalid: manifest\n');
    await stageAndCommit(upstreamRepo,['.github-notes.yaml'],'invalid fixture');
    await expect(updateCore({repoRoot:userRepo})).rejects.toThrow();
    expect((await runGit(['rev-parse','HEAD'],userRepo)).stdout).toBe(head);
  });
});
