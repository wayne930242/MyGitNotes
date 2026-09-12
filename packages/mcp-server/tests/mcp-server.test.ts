import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { runGit, stageAndCommit } from '@github-notes/git';
import { WORKSPACE_CONFIG_FILENAME } from '@github-notes/core';
import {
  handleGetWorkspaceConfig,
  handleListNotes,
  handleSaveNote,
  handleReadNote,
  handleAddAsset,
  handleDeleteAsset,
  handleListAssets,
} from '../src/tools.js';
import { assertUserWorkspaceBranch } from '../src/guards.js';

describe('MCP Server Safe Tools & Boundaries', () => {
  let testRepo: string;

  beforeEach(async () => {
    testRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-notes-mcp-test-'));
    await runGit(['init', '-b', 'core'], testRepo);
    await runGit(['config', 'user.name', 'Test User'], testRepo);
    await runGit(['config', 'user.email', 'test@example.com'], testRepo);

    // Initial core commit
    fs.writeFileSync(path.join(testRepo, 'AGENTS.md'), '# Agent Instructions');
    await stageAndCommit(testRepo, ['AGENTS.md'], 'initial core commit');
  });

  afterEach(() => {
    if (fs.existsSync(testRepo)) {
      fs.rmSync(testRepo, { recursive: true, force: true });
    }
  });

  it('rejects user note mutation on the core branch', async () => {
    // Current branch is 'core'
    await expect(
      handleSaveNote(
        { repoRoot: testRepo },
        {
          path: 'notes/example/note.md',
          content: '# Test Note',
        }
      )
    ).rejects.toThrow(/User content modifications are restricted to workspace branch/);
  });

  it('rejects path traversal attempts', async () => {
    // Switch to main
    await runGit(['checkout', '-b', 'main'], testRepo);

    await expect(
      handleSaveNote(
        { repoRoot: testRepo },
        {
          path: '../outside.md',
          content: '# Escaped Content',
        }
      )
    ).rejects.toThrow(/escapes repository root/);
  });

  it('allows safe note creation and creates atomic commit on main branch', async () => {
    // Setup workspace on main
    await runGit(['checkout', '-b', 'main'], testRepo);

    const configContent = `schema_version: 1
workspace:
  title: "Test Workspace"
  default_notebook: example
notebooks:
  - id: example
    title: "Example Notebook"
    root: notes/example
`;
    fs.writeFileSync(path.join(testRepo, WORKSPACE_CONFIG_FILENAME), configContent);
    await stageAndCommit(testRepo, [WORKSPACE_CONFIG_FILENAME], 'add workspace config');

    // Save a note via MCP handler
    const saveResult = await handleSaveNote(
      { repoRoot: testRepo },
      {
        path: 'notes/example/my-note.md',
        content: 'This is my first note content.',
        metadata: {
          id: 'my-note',
          title: 'My First Note',
          status: 'todo',
          tags: ['first', 'test'],
          custom_extra_key: 'preserved',
        },
      }
    );

    expect(saveResult.success).toBe(true);
    expect(saveResult.note.title).toBe('My First Note');
    expect(saveResult.commit.commitHash).toBeDefined();

    // Verify read back
    const readResult = await handleReadNote(
      { repoRoot: testRepo },
      { path: 'notes/example/my-note.md' }
    );
    expect(readResult.note.metadata.custom_extra_key).toBe('preserved');
    expect(readResult.note.tags).toEqual(['first', 'test']);

    // Verify git log has the commit
    const { stdout: log } = await runGit(['log', '-1', '--oneline'], testRepo);
    expect(log).toMatch(/minor-mod|my-note/);
  });

  it('reads workspace configuration properly', async () => {
    await runGit(['checkout', '-b', 'main'], testRepo);
    fs.writeFileSync(
      path.join(testRepo, WORKSPACE_CONFIG_FILENAME),
      `schema_version: 1\nworkspace:\n  title: "MCP Notes"\n  default_notebook: ex\nnotebooks:\n  - id: ex\n    title: "Ex"\n    root: notes/ex\n`
    );
    const res = await handleGetWorkspaceConfig({ repoRoot: testRepo });
    expect(res.config?.workspace.title).toBe('MCP Notes');
  });

  it('rejects asset mutation on the core branch', async () => {
    // Current branch is 'core'
    await expect(
      handleAddAsset(
        { repoRoot: testRepo },
        {
          notebookId: 'example',
          filename: 'test.png',
          base64Content: Buffer.from('dummy').toString('base64'),
        }
      )
    ).rejects.toThrow(/User content modifications are restricted to workspace branch/);

    await expect(
      handleDeleteAsset(
        { repoRoot: testRepo },
        { path: 'notes/example/assets/test.png' }
      )
    ).rejects.toThrow(/User content modifications are restricted to workspace branch/);
  });

  it('adds an asset to a specific subfolder and deletes it with atomic commits', async () => {
    await runGit(['checkout', '-b', 'main'], testRepo);
    const configContent = `schema_version: 1
workspace:
  title: "Test Workspace"
  default_notebook: example
notebooks:
  - id: example
    title: "Example Notebook"
    root: notes/example
    assets: assets
`;
    fs.writeFileSync(path.join(testRepo, WORKSPACE_CONFIG_FILENAME), configContent);
    await stageAndCommit(testRepo, [WORKSPACE_CONFIG_FILENAME], 'add workspace config');

    // 1. Add asset with subfolder directory: 'images/sub'
    const dummyData = Buffer.from('sample png image data').toString('base64');
    const addResult = await handleAddAsset(
      { repoRoot: testRepo },
      {
        notebookId: 'example',
        filename: 'photo.png',
        directory: 'images/sub',
        base64Content: dummyData,
      }
    );

    expect(addResult.success).toBe(true);
    expect(addResult.path).toBe('notes/example/assets/images/sub/photo.png');
    expect(addResult.markdownRef).toBe('![photo.png](assets/images/sub/photo.png)');
    expect(fs.existsSync(path.join(testRepo, 'notes/example/assets/images/sub/photo.png'))).toBe(true);

    // 2. Reject deletion of non-asset path
    const nonAssetDelete = await handleDeleteAsset(
      { repoRoot: testRepo },
      { path: 'notes/example/note.md' }
    );
    expect(nonAssetDelete.error).toMatch(/not a workspace asset/);

    // 3. Delete the asset
    const deleteResult = await handleDeleteAsset(
      { repoRoot: testRepo },
      { path: 'notes/example/assets/images/sub/photo.png' }
    );

    expect(deleteResult.success).toBe(true);
    expect(deleteResult.path).toBe('notes/example/assets/images/sub/photo.png');
    expect(fs.existsSync(path.join(testRepo, 'notes/example/assets/images/sub/photo.png'))).toBe(false);

    // Verify git log contains both commits
    const { stdout: log } = await runGit(['log', '-2', '--oneline'], testRepo);
    expect(log).toMatch(/chore\(assets\): delete photo\.png/);
    expect(log).toMatch(/chore\(assets\): add asset photo\.png/);
  });
});
