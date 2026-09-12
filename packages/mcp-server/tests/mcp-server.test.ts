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
  handleMkdir,
  handleGetFolderMetadata,
  handleUpdateFolderMetadata,
  handleListFolders,
  handleReadAgentResource,
  handleUpdateCore,
} from '../src/tools.js';
import { localTools } from '../src/local-tools.js';
import { createMCPServer } from '../src/server.js';
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

  it('supports mkdir with metadata, get_folder_metadata, and update_folder_metadata with atomic commits', async () => {
    // Current branch is 'core'
    await expect(
      handleMkdir(
        { repoRoot: testRepo },
        {
          path: 'notes/example/projects',
          title: 'Projects',
          order: 1,
        }
      )
    ).rejects.toThrow(/User content modifications are restricted to workspace branch/);

    // Switch to main
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

    // 1. mkdir with metadata
    const mkdirRes = await handleMkdir(
      { repoRoot: testRepo },
      {
        path: 'notes/example/projects/backend',
        title: 'Backend Services',
        order: 2,
        description: 'Microservices and backend APIs',
      }
    );
    expect(mkdirRes.success).toBe(true);
    expect(mkdirRes.folder.title).toBe('Backend Services');
    expect(mkdirRes.folder.order).toBe(2);
    expect(mkdirRes.folder.description).toBe('Microservices and backend APIs');
    expect(mkdirRes.commit.commitHash).toBeDefined();

    // Verify _dir.yml on disk
    const dirYmlPath = path.join(testRepo, 'notes/example/projects/backend/_dir.yml');
    expect(fs.existsSync(dirYmlPath)).toBe(true);
    const rawYaml = fs.readFileSync(dirYmlPath, 'utf8');
    expect(rawYaml).toContain('title: Backend Services');
    expect(rawYaml).toContain('order: 2');
    expect(rawYaml).toContain('description: Microservices and backend APIs');

    // Reject duplicate mkdir without overwrite
    const dupRes = await handleMkdir(
      { repoRoot: testRepo },
      {
        path: 'notes/example/projects/backend',
        title: 'Backend Services',
      }
    );
    expect(dupRes.error).toMatch(/already exists/);

    // 2. get_folder_metadata
    const getRes = await handleGetFolderMetadata(
      { repoRoot: testRepo },
      { path: 'notes/example/projects/backend' }
    );
    expect(getRes.folder.title).toBe('Backend Services');
    expect(getRes.folder.order).toBe(2);
    expect(getRes.folder.description).toBe('Microservices and backend APIs');

    // 3. update_folder_metadata
    const updateRes = await handleUpdateFolderMetadata(
      { repoRoot: testRepo },
      {
        path: 'notes/example/projects/backend',
        order: 10,
        description: 'Updated backend description',
      }
    );
    expect(updateRes.success).toBe(true);
    expect(updateRes.folder.title).toBe('Backend Services');
    expect(updateRes.folder.order).toBe(10);
    expect(updateRes.folder.description).toBe('Updated backend description');
    expect(updateRes.commit.commitHash).toBeDefined();

    // Verify git log
    const { stdout: log } = await runGit(['log', '-1', '--oneline'], testRepo);
    expect(log).toMatch(/chore\(metadata\): update folder metadata for backend/);

    // 4. list_folders
    const listRes = await handleListFolders({ repoRoot: testRepo });
    expect(listRes.folders.some((f) => f.path === 'projects/backend' && f.order === 10)).toBe(true);
  });

  it('exposes exactly 18 consolidated tools and absorbs redundant endpoints', async () => {
    expect(localTools.length).toBe(18);

    const toolNames = localTools.map((t) => t.name);
    // 18 primary tools
    const expected = [
      'list_folders',
      'get_workspace_config',
      'list_notebooks',
      'list_notes',
      'read_note',
      'save_note',
      'delete_note',
      'read_agent_resource',
      'list_assets',
      'add_asset',
      'delete_asset',
      'get_git_status',
      'git_commit',
      'update_core',
      'search_notes',
      'replace_notes',
      'get_statuses',
      'mkdir',
    ];
    expect(toolNames.sort()).toEqual(expected.sort());

    // Redundant absorbed endpoints are not in the exposed list
    const absorbed = [
      'get_note_metadata',
      'update_note_metadata',
      'get_folder_metadata',
      'update_folder_metadata',
      'list_agent_resources',
      'check_core_update',
    ];
    for (const name of absorbed) {
      expect(toolNames).not.toContain(name);
    }
  });

  it('supports consolidated operations: metadataOnly in read_note, omitted content in save_note, path in list_folders, checkOnly in update_core', async () => {
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

    // 1. save_note initial content
    await handleSaveNote(
      { repoRoot: testRepo },
      {
        path: 'notes/example/sample.md',
        content: '# Sample Note Body\nSome text.',
        metadata: { title: 'Sample Note', status: 'inbox', tags: ['alpha'] },
      }
    );

    // 2. read_note with metadataOnly: true
    const metaOnly = (await handleReadNote(
      { repoRoot: testRepo },
      { path: 'notes/example/sample.md', metadataOnly: true }
    )) as any;
    expect(metaOnly.title).toBe('Sample Note');
    expect(metaOnly.status).toBe('inbox');
    expect(metaOnly.tags).toEqual(['alpha']);
    expect(metaOnly.availableStatuses).toBeDefined();
    expect(metaOnly.content).toBeUndefined();

    // 3. save_note with omitted content (updates frontmatter only)
    const updateRes = (await handleSaveNote(
      { repoRoot: testRepo },
      {
        path: 'notes/example/sample.md',
        status: 'working',
        tags: ['alpha', 'beta'],
        title: 'Updated Sample Title',
      }
    )) as any;
    expect(updateRes.success).toBe(true);
    expect(updateRes.note.title).toBe('Updated Sample Title');
    expect(updateRes.note.status).toBe('working');
    expect(updateRes.note.tags).toEqual(['alpha', 'beta']);

    // Verify content remained intact
    const fullNote = (await handleReadNote(
      { repoRoot: testRepo },
      { path: 'notes/example/sample.md' }
    )) as any;
    expect(fullNote.note.content.trim()).toBe('# Sample Note Body\nSome text.');

    // 4. list_folders with path
    await handleMkdir(
      { repoRoot: testRepo },
      { path: 'notes/example/docs', title: 'Documentation', order: 1 }
    );
    const singleFolder = (await handleListFolders(
      { repoRoot: testRepo },
      { path: 'notes/example/docs' }
    )) as any;
    expect(singleFolder.folder.title).toBe('Documentation');
    expect(singleFolder.folder.order).toBe(1);

    // 5. read_agent_resource without path -> lists resources
    const resources = (await handleReadAgentResource({ repoRoot: testRepo })) as any;
    expect(resources.instructions).toContain('AGENTS.md');

    // 6. update_core with checkOnly: true
    const checkRes = (await handleUpdateCore({ repoRoot: testRepo }, { checkOnly: true })) as any;
    expect(checkRes.error || checkRes.currentHash).toBeDefined();
  });

  it('supports legacy tool calls through MCPServer dispatch for backward compatibility', async () => {
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

    // Save a note
    await handleSaveNote(
      { repoRoot: testRepo },
      {
        path: 'notes/example/test.md',
        content: '# Legacy Test',
        metadata: { title: 'Legacy Note', status: 'inbox' },
      }
    );

    const server = createMCPServer(testRepo);
    // Legacy call: get_note_metadata
    const getMetaReq = {
      method: 'tools/call',
      params: {
        name: 'get_note_metadata',
        arguments: { path: 'notes/example/test.md' },
      },
    };
    const handler = (server as any)._requestHandlers.get('tools/call');
    expect(handler).toBeDefined();

    const metaResult = await handler(getMetaReq);
    expect(metaResult.isError).toBeFalsy();
    expect(metaResult.structuredContent.title).toBe('Legacy Note');
    expect(metaResult.structuredContent.status).toBe('inbox');

    // Legacy call: list_agent_resources
    const listResReq = {
      method: 'tools/call',
      params: {
        name: 'list_agent_resources',
        arguments: {},
      },
    };
    const listResResult = await handler(listResReq);
    expect(listResResult.isError).toBeFalsy();
    expect(listResResult.structuredContent.instructions).toContain('AGENTS.md');
  });
});

