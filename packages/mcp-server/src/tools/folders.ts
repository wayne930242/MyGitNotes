import path from 'node:path';
import fs from 'node:fs';
import {
  loadWorkspaceConfig,
  scanNotebookFolders,
  resolveSafePath,
  writeFolderConfig,
  getFolderItem,
  isNotebookContent,
  FolderMetadata,
} from '@github-notes/core';
import { stageAndCommit, runGit } from '@github-notes/git';
import { assertUserWorkspaceBranch, assertSafeRepoPath } from '../guards.js';
import type { ToolContext } from './context.js';

export async function handleListFolders(
  ctx: ToolContext,
  args?: { path?: string; notebookId?: string }
) {
  if (args?.path) {
    return handleGetFolderMetadata(ctx, { path: args.path });
  }
  const config = loadWorkspaceConfig(ctx.repoRoot);
  if (!config) return { folders: [] };
  const notebooks = args?.notebookId
    ? config.notebooks.filter((nb) => nb.id === args.notebookId)
    : config.notebooks;
  const folders = notebooks.flatMap((nb) => scanNotebookFolders(ctx.repoRoot, nb));
  return { folders };
}

export async function handleGetFolderMetadata(
  ctx: ToolContext,
  args: { path: string }
) {
  assertSafeRepoPath(ctx.repoRoot, args.path);
  const normalizedRel = args.path.replace(/\\/g, '/').replace(/\/(_dir\.yml)?$/, '');
  const folder = getFolderItem(ctx.repoRoot, normalizedRel);
  if (!folder) {
    return { error: `Folder not found or invalid: ${args.path}` };
  }
  return {
    path: normalizedRel,
    folder,
  };
}

export async function handleMkdir(
  ctx: ToolContext,
  args: {
    path: string;
    title?: string;
    order?: number;
    description?: string;
    metadata?: Record<string, unknown>;
    overwrite?: boolean;
    commitMessage?: string;
  }
) {
  await assertUserWorkspaceBranch(ctx.repoRoot);
  assertSafeRepoPath(ctx.repoRoot, args.path);

  const config = loadWorkspaceConfig(ctx.repoRoot);
  if (!config) {
    return { error: 'Workspace not configured' };
  }

  const normalizedRel = args.path.replace(/\\/g, '/').replace(/\/(_dir\.yml)?$/, '');
  const nb = config.notebooks.find((n) => normalizedRel === n.root || normalizedRel.startsWith(`${n.root}/`));
  if (!nb) {
    return { error: `Path must be inside a configured notebook: ${args.path}` };
  }

  const relInNb = normalizedRel === nb.root ? '' : normalizedRel.slice(nb.root.length + 1);
  if (relInNb && !isNotebookContent(relInNb, nb)) {
    return { error: `Path is not valid notebook content: ${args.path}` };
  }

  const fullFolder = resolveSafePath(ctx.repoRoot, normalizedRel);
  const exists = fs.existsSync(fullFolder);
  if (exists && !args.overwrite) {
    return { error: `Target folder already exists: ${args.path}. Set overwrite: true to update metadata.` };
  }

  const title = args.title !== undefined ? args.title : (exists ? undefined : path.basename(normalizedRel));
  const meta: FolderMetadata = {
    ...(args.metadata || {}),
  };
  if (title !== undefined) meta.title = title;
  if (args.order !== undefined) meta.order = args.order;
  if (args.description !== undefined) meta.description = args.description;

  const { folder, dirFileRel } = writeFolderConfig(ctx.repoRoot, normalizedRel, meta);

  const message =
    args.commitMessage ||
    (exists
      ? `chore(metadata): update folder metadata for ${path.basename(normalizedRel)}`
      : `docs(folders): create ${path.basename(normalizedRel)}`);

  await runGit(['add', '--', dirFileRel], ctx.repoRoot);
  const { stdout: status } = await runGit(['status', '--porcelain', '--', dirFileRel], ctx.repoRoot);

  let commit: { commitHash: string; shortHash: string };
  if (status.trim()) {
    commit = await stageAndCommit(ctx.repoRoot, [dirFileRel], message);
  } else {
    const { stdout: hash } = await runGit(['rev-parse', 'HEAD'], ctx.repoRoot);
    const { stdout: shortHash } = await runGit(['rev-parse', '--short', 'HEAD'], ctx.repoRoot);
    commit = { commitHash: hash, shortHash };
  }

  return {
    success: true,
    path: normalizedRel,
    folder,
    commit,
  };
}

export async function handleUpdateFolderMetadata(
  ctx: ToolContext,
  args: {
    path: string;
    title?: string;
    order?: number;
    description?: string;
    metadata?: Record<string, unknown>;
    commitMessage?: string;
  }
) {
  return handleMkdir(ctx, { ...args, overwrite: true });
}

