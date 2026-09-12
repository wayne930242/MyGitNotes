import path from 'node:path';
import fs from 'node:fs';
import {
  loadWorkspaceConfig,
  readNoteFile,
  writeNoteFile,
  deleteNoteFile,
  scanNotebookNotes,
  resolveSafePath,
  sanitizeFilename,
  WorkspaceConfig,
  NoteItem,
  assetPath,
  isAssetPath,
  decodeAsset,
} from '@github-notes/core';
import {
  getGitStatus,
  stageAndCommit,
  generateCommitMessage,
  updateCore,
  runGit,
} from '@github-notes/git';
import { assertUserWorkspaceBranch, assertSafeRepoPath } from './guards.js';

export interface ToolContext {
  repoRoot: string;
}

export async function handleGetWorkspaceConfig(ctx: ToolContext) {
  const config = loadWorkspaceConfig(ctx.repoRoot);
  if (!config) {
    return {
      error: 'No .github-notes.yaml configuration file found in workspace.',
    };
  }
  return { config };
}

export async function handleListNotebooks(ctx: ToolContext) {
  const config = loadWorkspaceConfig(ctx.repoRoot);
  if (!config) {
    return { error: 'Workspace not initialized.' };
  }
  return { notebooks: config.notebooks };
}

export async function handleListNotes(
  ctx: ToolContext,
  args: { notebookId?: string }
) {
  const config = loadWorkspaceConfig(ctx.repoRoot);
  if (!config) {
    return { error: 'Workspace not initialized.' };
  }

  const notebooks = args.notebookId
    ? config.notebooks.filter((nb) => nb.id === args.notebookId)
    : config.notebooks;

  const notes: NoteItem[] = [];
  for (const nb of notebooks) {
    notes.push(...scanNotebookNotes(ctx.repoRoot, nb));
  }

  return { count: notes.length, notes };
}

export async function handleReadNote(
  ctx: ToolContext,
  args: { path: string; notebookId?: string }
) {
  assertSafeRepoPath(ctx.repoRoot, args.path);
  const notebookId = args.notebookId || 'default';
  const note = readNoteFile(ctx.repoRoot, args.path, notebookId);
  return { note };
}

export async function handleSaveNote(
  ctx: ToolContext,
  args: {
    path: string;
    content: string;
    metadata?: Record<string, unknown>;
    commitMessage?: string;
  }
) {
  // Enforce branch safety: user notes must only be saved on user workspace branch
  await assertUserWorkspaceBranch(ctx.repoRoot);
  assertSafeRepoPath(ctx.repoRoot, args.path);

  // Write the note to disk
  const saved = writeNoteFile(ctx.repoRoot, args.path, args.content, args.metadata);

  // Generate commit message if not provided
  let message = args.commitMessage;
  if (!message) {
    message = await generateCommitMessage({
      filePath: args.path,
      diff: args.content,
    });
  }

  // Create atomic Git commit
  const commitResult = await stageAndCommit(ctx.repoRoot, [args.path], message);

  return {
    success: true,
    note: saved,
    commit: commitResult,
  };
}

export async function handleDeleteNote(
  ctx: ToolContext,
  args: { path: string; commitMessage?: string }
) {
  await assertUserWorkspaceBranch(ctx.repoRoot);
  assertSafeRepoPath(ctx.repoRoot, args.path);

  deleteNoteFile(ctx.repoRoot, args.path);

  const message = args.commitMessage || `docs(notes): delete ${path.basename(args.path)}`;
  const commitResult = await stageAndCommit(ctx.repoRoot, [args.path], message);

  return {
    success: true,
    path: args.path,
    commit: commitResult,
  };
}

export async function handleListAgentResources(ctx: ToolContext) {
  const instructions: string[] = [];
  const docs: string[] = [];

  // Check root AGENTS.md
  if (fs.existsSync(path.join(ctx.repoRoot, 'AGENTS.md'))) {
    instructions.push('AGENTS.md');
  }

  // Check docs/agent/
  const agentDocsDir = path.join(ctx.repoRoot, 'docs/agent');
  if (fs.existsSync(agentDocsDir)) {
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else if (entry.isFile() && entry.name.endsWith('.md')) {
          docs.push(path.relative(ctx.repoRoot, full).replace(/\\/g, '/'));
        }
      }
    };
    walk(agentDocsDir);
  }

  return { instructions, docs };
}

export async function handleReadAgentResource(
  ctx: ToolContext,
  args: { path: string }
) {
  const safe = assertSafeRepoPath(ctx.repoRoot, args.path);
  if (!fs.existsSync(safe)) {
    return { error: `Resource not found: ${args.path}` };
  }
  const content = fs.readFileSync(safe, 'utf-8');
  return { path: args.path, content };
}

export async function handleListAssets(
  ctx: ToolContext,
  args: { notebookId: string }
) {
  const config = loadWorkspaceConfig(ctx.repoRoot);
  if (!config) return { error: 'Workspace not configured' };

  const nb = config.notebooks.find((n) => n.id === args.notebookId);
  if (!nb) return { error: `Notebook '${args.notebookId}' not found` };

  const assetDir = path.join(ctx.repoRoot, nb.root, nb.assets || 'assets');
  if (!fs.existsSync(assetDir)) {
    return { assets: [] };
  }

  const files = fs
    .readdirSync(assetDir, { withFileTypes: true })
    .filter((e) => e.isFile() && !e.name.startsWith('.'))
    .map((e) => {
      const rel = path.relative(ctx.repoRoot, path.join(assetDir, e.name)).replace(/\\/g, '/');
      return {
        name: e.name,
        path: rel,
        markdownRef: `![${e.name}](${nb.assets || 'assets'}/${e.name})`,
      };
    });

  return { assets: files };
}

export async function handleAddAsset(
  ctx: ToolContext,
  args: {
    notebookId: string;
    filename: string;
    base64Content: string;
    directory?: string;
  }
) {
  await assertUserWorkspaceBranch(ctx.repoRoot);
  const config = loadWorkspaceConfig(ctx.repoRoot);
  if (!config) return { error: 'Workspace not configured' };

  const nb = config.notebooks.find((n) => n.id === args.notebookId);
  if (!nb) return { error: `Notebook '${args.notebookId}' not found` };

  let filename = args.filename;
  let directory = (args.directory || '').trim().replace(/^\/+|\/+$/g, '');
  if (!directory && filename.includes('/')) {
    const parts = filename.split('/');
    filename = parts.pop() || '';
    directory = parts.join('/');
  } else if (filename.includes('/')) {
    filename = path.posix.basename(filename);
  }

  const relPath = assetPath(nb, directory, filename);
  const safeFilename = path.posix.basename(relPath);
  const targetPath = resolveSafePath(ctx.repoRoot, relPath);
  const buffer = decodeAsset(args.base64Content);

  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, buffer);

  const markdownRel = relPath.slice(nb.root.length + 1);
  const commit = await stageAndCommit(
    ctx.repoRoot,
    [relPath],
    `chore(assets): add asset ${safeFilename}`
  );

  return {
    success: true,
    filename: safeFilename,
    path: relPath,
    markdownRef: `![${safeFilename}](${markdownRel})`,
    commit,
  };
}

export async function handleDeleteAsset(
  ctx: ToolContext,
  args: { path: string; commitMessage?: string }
) {
  await assertUserWorkspaceBranch(ctx.repoRoot);
  assertSafeRepoPath(ctx.repoRoot, args.path);

  const config = loadWorkspaceConfig(ctx.repoRoot);
  if (!config) return { error: 'Workspace not configured' };

  if (!config.notebooks.some((nb) => isAssetPath(args.path, nb))) {
    return { error: 'Path is not a workspace asset.' };
  }

  const safePath = resolveSafePath(ctx.repoRoot, args.path);
  if (fs.existsSync(safePath)) {
    fs.unlinkSync(safePath);
  }

  const message = args.commitMessage || `chore(assets): delete ${path.basename(args.path)}`;
  const commitResult = await stageAndCommit(ctx.repoRoot, [args.path], message);

  return {
    success: true,
    path: args.path,
    commit: commitResult,
  };
}

export async function handleGetGitStatus(ctx: ToolContext) {
  const status = await getGitStatus(ctx.repoRoot);
  return { status };
}

export async function handleGitCommit(
  ctx: ToolContext,
  args: { files: string[]; message: string }
) {
  for (const f of args.files) {
    assertSafeRepoPath(ctx.repoRoot, f);
  }
  const result = await stageAndCommit(ctx.repoRoot, args.files, args.message);
  return { success: true, commit: result };
}

export async function handleCheckCoreUpdate(ctx: ToolContext) {
  try {
    const { stdout: remotes } = await runGit(['remote'], ctx.repoRoot);
    const remote = remotes.includes('upstream') ? 'upstream' : 'origin';
    await runGit(['fetch', remote, 'core'], ctx.repoRoot);

    const { stdout: currentHash } = await runGit(['rev-parse', 'HEAD'], ctx.repoRoot);
    const { stdout: coreHash } = await runGit(['rev-parse', `${remote}/core`], ctx.repoRoot);

    let isUpToDate = false;
    try {
      await runGit(['merge-base', '--is-ancestor', `${remote}/core`, 'HEAD'], ctx.repoRoot);
      isUpToDate = true;
    } catch {
      isUpToDate = false;
    }

    return {
      remoteUsed: remote,
      currentHash,
      coreHash,
      isUpToDate,
    };
  } catch (err: unknown) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

export async function handleUpdateCore(
  ctx: ToolContext,
  args: { autoPush?: boolean }
) {
  const result = await updateCore({
    repoRoot: ctx.repoRoot,
    autoPush: args.autoPush,
  });
  return { result };
}
