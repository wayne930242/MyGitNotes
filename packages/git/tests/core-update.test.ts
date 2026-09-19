import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { runGit, stageAndCommit } from '../src/git-service.js';
import { updateCore, CoreUpdateError } from '../src/core-update.js';
import { WORKSPACE_CONFIG_FILENAME } from '@mygitnotes/core';

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

  it('refuses to run update on a branch other than core or main', async () => {
    await runGit(['checkout', '-b', 'feature'], userRepo);
    await expect(updateCore({ repoRoot: userRepo })).rejects.toMatchObject({ code: 'INVALID_BRANCH' });
  });

  it('fast-forwards a core checkout and migrates the configured workspace', async () => {
    const notes = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-notes-content-'));
    try {
      fs.writeFileSync(path.join(notes, WORKSPACE_CONFIG_FILENAME), 'workspace:\n  title: Notes\n  default_notebook: a\nnotebooks:\n  - id: a\n    title: A\n    root: notes/a\n');
      expect((await updateCore({ repoRoot: userRepo, workspaceRoot: notes })).alreadyUpToDate).toBe(true);
      fs.writeFileSync(path.join(upstreamRepo, 'NEW_FEATURE.md'), '# New Core Feature');
      await stageAndCommit(upstreamRepo, ['NEW_FEATURE.md'], 'feat: add new feature');
      const result = await updateCore({ repoRoot: userRepo, workspaceRoot: notes });
      expect(result).toMatchObject({ success: true, alreadyUpToDate: false });
      expect((await runGit(['rev-parse', 'HEAD'], userRepo)).stdout).toBe((await runGit(['rev-parse', 'HEAD'], upstreamRepo)).stdout);
      expect((await runGit(['log', '--merges', '--oneline'], userRepo)).stdout).toBe('');
      expect(fs.readFileSync(path.join(notes, WORKSPACE_CONFIG_FILENAME), 'utf8')).toMatch(/^schema_version: 1$/m);
    } finally { fs.rmSync(notes, { recursive: true, force: true }); }
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

  it('never merges Core into a content-only main', async () => {
    fs.writeFileSync(path.join(upstreamRepo, 'pnpm-workspace.yaml'), 'packages: []\n');
    await stageAndCommit(upstreamRepo, ['pnpm-workspace.yaml'], 'product marker');
    await runGit(['checkout', '--orphan', 'main'], userRepo);
    await runGit(['rm', '-r', '--cached', '.'], userRepo);
    for (const file of ['README.md', 'pnpm-workspace.yaml']) fs.rmSync(path.join(userRepo, file), { force: true });
    fs.writeFileSync(path.join(userRepo, WORKSPACE_CONFIG_FILENAME), 'schema_version: 1\nworkspace:\n  title: Notes\n  default_notebook: a\nnotebooks:\n  - id: a\n    title: A\n    root: notes/a\n');
    await stageAndCommit(userRepo, [WORKSPACE_CONFIG_FILENAME], 'content only');
    const head = (await runGit(['rev-parse', 'HEAD'], userRepo)).stdout;
    await expect(updateCore({ repoRoot: userRepo })).rejects.toMatchObject({ code: 'CONTENT_ONLY_MAIN' });
    expect((await runGit(['rev-parse', 'HEAD'], userRepo)).stdout).toBe(head);
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

  it('hints at the backfill command when merged notes are missing created/updated', async () => {
    await runGit(['checkout', '-b', 'main'], userRepo);
    fs.writeFileSync(
      path.join(userRepo, WORKSPACE_CONFIG_FILENAME),
      `schema_version: 1\nworkspace:\n  title: "My Notes"\n  default_notebook: example\nnotebooks:\n  - id: example\n    title: "Example"\n    root: notes/example\n`
    );
    fs.mkdirSync(path.join(userRepo, 'notes/example'), { recursive: true });
    fs.writeFileSync(path.join(userRepo, 'notes/example/no-timestamps.md'), '# Old note');
    fs.writeFileSync(path.join(userRepo, 'notes/example/complete.md'), '---\ncreated: "2020-01-01T00:00:00.000Z"\nupdated: "2020-01-02T00:00:00.000Z"\n---\n\nComplete note.\n');
    await stageAndCommit(userRepo, [WORKSPACE_CONFIG_FILENAME, 'notes/example/no-timestamps.md', 'notes/example/complete.md'], 'init workspace');

    fs.writeFileSync(path.join(upstreamRepo, 'NEW_FEATURE.md'), '# New Core Feature');
    await stageAndCommit(upstreamRepo, ['NEW_FEATURE.md'], 'feat: add new feature');

    const result = await updateCore({ repoRoot: userRepo });
    expect(result.notesMissingTimestamps).toBe(1);
    expect(result.message).toContain('pnpm backfill-note-timestamps');
  });

  it('gives no backfill hint when every note already has created and updated', async () => {
    await runGit(['checkout', '-b', 'main'], userRepo);
    fs.writeFileSync(
      path.join(userRepo, WORKSPACE_CONFIG_FILENAME),
      `schema_version: 1\nworkspace:\n  title: "My Notes"\n  default_notebook: example\nnotebooks:\n  - id: example\n    title: "Example"\n    root: notes/example\n`
    );
    fs.mkdirSync(path.join(userRepo, 'notes/example'), { recursive: true });
    fs.writeFileSync(path.join(userRepo, 'notes/example/complete.md'), '---\ncreated: "2020-01-01T00:00:00.000Z"\nupdated: "2020-01-02T00:00:00.000Z"\n---\n\nComplete note.\n');
    await stageAndCommit(userRepo, [WORKSPACE_CONFIG_FILENAME, 'notes/example/complete.md'], 'init workspace');

    fs.writeFileSync(path.join(upstreamRepo, 'NEW_FEATURE.md'), '# New Core Feature');
    await stageAndCommit(upstreamRepo, ['NEW_FEATURE.md'], 'feat: add new feature');

    const result = await updateCore({ repoRoot: userRepo });
    expect(result.notesMissingTimestamps).toBe(0);
    expect(result.message).not.toContain('backfill-note-timestamps');
  });

  it('preserves tracked agent settings through Core deletion, later edits and additions', async () => {
    const write = (root: string, file: string, text: string) => {
      fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
      fs.writeFileSync(path.join(root, file), text);
    };
    const files = ['AGENTS.md', '.agents/skills/範例/SKILL.md', '.codex/agents/reviewer.toml',
      'CLAUDE.md', '.claude/skills/review/SKILL.md', 'GEMINI.md', '.agent/skills/review/SKILL.md', '.github-notes-study.yaml'];
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
  }, 15000); // Two full updateCore() runs each spawn many real git subprocesses; slower under full-suite load.

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
  }, 15000); // Spawns a real node+tsx CLI process to run scripts/update-core.ts; slower under full-suite load.

  it('does not commit an update with an invalid workspace manifest', async () => {
    await runGit(['checkout','-b','main'],userRepo);
    const head = (await runGit(['rev-parse','HEAD'],userRepo)).stdout;
    fs.writeFileSync(path.join(upstreamRepo,'.github-notes.yaml'),'invalid: manifest\n');
    await stageAndCommit(upstreamRepo,['.github-notes.yaml'],'invalid fixture');
    await expect(updateCore({repoRoot:userRepo})).rejects.toThrow();
    expect((await runGit(['rev-parse','HEAD'],userRepo)).stdout).toBe(head);
  });
});
