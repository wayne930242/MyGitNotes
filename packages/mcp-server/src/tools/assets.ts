import path from 'node:path';
import fs from 'node:fs';
import {
  loadWorkspaceConfig,
  resolveSafePath,
  assetPath,
  isAssetPath,
  decodeAsset,
} from '@mygitnotes/core';
import { stageAndCommit } from '@mygitnotes/git';
import { assertUserWorkspaceBranch, assertSafeRepoPath } from '../guards.js';
import type { ToolContext } from './context.js';

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
