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
  handleSearchNotes,
  handleReplaceNotes,
  handleGetStatuses,
  handleGetNoteMetadata,
  handleUpdateNoteMetadata,
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

  it('supports search_notes with plain text and regular expressions', async () => {
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

    // Create test notes
    await handleSaveNote(
      { repoRoot: testRepo },
      {
        path: 'notes/example/user-guide.md',
        content: '# Guide\nContact: support@example.com for help.\nRef: TICKET-1234 on 2026-09-12.',
        metadata: { title: 'User Guide', status: 'inbox' },
      }
    );

    // 1. Literal search
    const litSearch = await handleSearchNotes(
      { repoRoot: testRepo },
      { query: 'support@example.com' }
    );
    expect(litSearch.totalMatches).toBe(1);
    expect(litSearch.matches[0].path).toBe('notes/example/user-guide.md');
    expect(litSearch.matches[0].line).toBe(7);

    // 2. Regex search
    const regexSearch = await handleSearchNotes(
      { repoRoot: testRepo },
      { query: 'TICKET-\\d+', isRegex: true }
    );
    expect(regexSearch.totalMatches).toBe(1);
    expect(regexSearch.matches[0].matches).toContain('TICKET-1234');
    expect(regexSearch.matches[0].line).toBe(8);
  });

  it('supports replace_notes with dryRun and regex replacement with commit', async () => {
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

    await handleSaveNote(
      { repoRoot: testRepo },
      {
        path: 'notes/example/todo.md',
        content: '# Tasks\nFix ISSUE-101 and ISSUE-102.',
        metadata: { title: 'Todo', status: 'working' },
      }
    );

    // 1. Dry run
    const dryRunRes = await handleReplaceNotes(
      { repoRoot: testRepo },
      {
        find: 'ISSUE-(\\d+)',
        replace: 'BUG-$1',
        isRegex: true,
        dryRun: true,
      }
    );
    expect(dryRunRes.dryRun).toBe(true);
    expect(dryRunRes.totalReplacements).toBe(2);
    expect(dryRunRes.changedFiles).toContain('notes/example/todo.md');
    expect(dryRunRes.commit).toBeUndefined();

    // Verify file unchanged
    const unmod = await handleReadNote({ repoRoot: testRepo }, { path: 'notes/example/todo.md' });
    expect(unmod.note.content).toContain('ISSUE-101');

    // 2. Real replacement
    const liveRes = await handleReplaceNotes(
      { repoRoot: testRepo },
      {
        find: 'ISSUE-(\\d+)',
        replace: 'BUG-$1',
        isRegex: true,
      }
    );
    expect(liveRes.success).toBe(true);
    expect(liveRes.totalReplacements).toBe(2);
    expect(liveRes.commit?.commitHash).toBeDefined();

    // Verify file updated
    const mod = await handleReadNote({ repoRoot: testRepo }, { path: 'notes/example/todo.md' });
    expect(mod.note.content).toContain('Fix BUG-101 and BUG-102.');
  });

  it('supports get_statuses, get_note_metadata, and update_note_metadata with validation', async () => {
    await runGit(['checkout', '-b', 'main'], testRepo);
    const configContent = `schema_version: 1
workspace:
  title: "Test Workspace"
  default_notebook: example
notebooks:
  - id: example
    title: "Example Notebook"
    root: notes/example
    statuses:
      - inbox
      - working
      - review
      - done
      - archived
`;
    fs.writeFileSync(path.join(testRepo, WORKSPACE_CONFIG_FILENAME), configContent);
    await stageAndCommit(testRepo, [WORKSPACE_CONFIG_FILENAME], 'add workspace config');

    await handleSaveNote(
      { repoRoot: testRepo },
      {
        path: 'notes/example/feature.md',
        content: '# Feature Planning\nDetailed specification...',
        metadata: { title: 'Feature Planning', status: 'inbox', tags: ['v1'] },
      }
    );

    // 1. Get statuses
    const statusesRes = await handleGetStatuses({ repoRoot: testRepo }, { notebookId: 'example' });
    expect(statusesRes.notebooks[0].configuredStatuses).toEqual(['inbox', 'working', 'review', 'done', 'archived']);
    expect(statusesRes.notebooks[0].allStatuses).toContain('review');

    // 2. Fast get metadata
    const metaRes = await handleGetNoteMetadata({ repoRoot: testRepo }, { path: 'notes/example/feature.md' });
    expect(metaRes.status).toBe('inbox');
    expect(metaRes.tags).toEqual(['v1']);
    expect(metaRes.availableStatuses).toContain('review');

    // 3. Fast update metadata
    const updateRes = await handleUpdateNoteMetadata(
      { repoRoot: testRepo },
      {
        path: 'notes/example/feature.md',
        status: 'done',
        tags: ['v1', 'shipped'],
      }
    );
    expect(updateRes.success).toBe(true);
    expect(updateRes.note.status).toBe('done');
    expect(updateRes.note.tags).toEqual(['v1', 'shipped']);
    expect(updateRes.note.content).toContain('Detailed specification...');
    expect(updateRes.availableStatuses).toContain('done');
    expect(updateRes.commit.commitHash).toBeDefined();

    // Verify git log
    const { stdout: log } = await runGit(['log', '-1', '--oneline'], testRepo);
    expect(log).toMatch(/chore\(metadata\): set status to done for feature\.md/);
  });
});
