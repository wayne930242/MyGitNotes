import path from 'node:path';
import fs from 'node:fs';
import { assetPath, assetSubPath, decodeAsset, deleteR2Object, isAssetPath, isNotebookR2Key, listR2Objects, loadWorkspaceConfig, parseR2Reference, putR2Object, r2NotebookPrefix, r2ObjectExists, r2Reference, r2ReferenceKeys, r2SettingsFromEnv, resolveSafePath, scanNotebookNotes } from '@mygitnotes/core';
import { stageAndCommit } from '@mygitnotes/git';
import { assertSafeRepoPath, assertUserWorkspaceBranch } from '../guards.js';
import type { ToolContext } from './context.js';

/** Every note body in the workspace, keyed by path, for checking what an R2 object is still linked from. */
const localNotes = (ctx: ToolContext, notebooks: Parameters<typeof scanNotebookNotes>[1][]) => new Map(notebooks.flatMap(nb => scanNotebookNotes(ctx.repoRoot, nb)).map(note => [note.path, note.content]));

/** The notebooks' R2 objects with the reference a note links each by; null when R2 is unconfigured. */
export async function listR2Assets(notebookIds: string[]) {
  const settings = r2SettingsFromEnv();
  if (!settings) return null;
  const assets = [];
  for (const notebookId of notebookIds) {
    for (const object of await listR2Objects(settings, r2NotebookPrefix(notebookId))) {
      const name = path.posix.basename(object.key);
      // A `.keep` placeholder only exists to hold an empty folder open.
      if (!isNotebookR2Key(object.key, notebookId) || name.startsWith('.')) continue;
      assets.push({ storage: 'r2' as const, notebookId, name, key: object.key, size: object.size, lastModified: object.lastModified, reference: `r2:${object.key}`, markdownRef: r2Reference(object.key) });
    }
  }
  return assets;
}

export async function handleListAssets(ctx: ToolContext, args: { notebookId: string; }) {
  const config = loadWorkspaceConfig(ctx.repoRoot);
  if (!config) return { error: 'Workspace not configured' };

  const nb = config.notebooks.find((n) => n.id === args.notebookId);
  if (!nb) return { error: `Notebook '${args.notebookId}' not found` };

  const assetDir = path.join(ctx.repoRoot, nb.root, nb.assets || 'assets');
  const files = fs.existsSync(assetDir)
    ? fs.readdirSync(assetDir, { withFileTypes: true }).filter((e) => e.isFile() && !e.name.startsWith('.')).map((e) => {
      const rel = path.relative(ctx.repoRoot, path.join(assetDir, e.name)).replace(/\\/g, '/');
      return { storage: 'git' as const, name: e.name, path: rel, markdownRef: `![${e.name}](${nb.assets || 'assets'}/${e.name})` };
    })
    : [];

  return { assets: [...files, ...await listR2Assets([nb.id]) || []] };
}

export interface AssetUpload {
  filename: string;
  base64Content: string;
  directory?: string;
}

/** Splits an upload whose `filename` carries folders into the folder and basename the upload uses. */
function assetTarget(args: AssetUpload) {
  let filename = args.filename;
  let directory = (args.directory || '').trim().replace(/^\/+|\/+$/g, '');
  if (!directory && filename.includes('/')) {
    const parts = filename.split('/');
    filename = parts.pop() || '';
    directory = parts.join('/');
  } else if (filename.includes('/')) {
    filename = path.posix.basename(filename);
  }
  return { filename, directory };
}

/**
 * Stores an asset in the configured private R2 bucket so a binary never enters Git history, and
 * returns the `r2:` reference a note links it by. Null when R2 is unconfigured, which keeps the
 * asset in the repository.
 */
export async function uploadR2Asset(notebookId: string, args: AssetUpload) {
  const settings = r2SettingsFromEnv();
  if (!settings) return null;
  const { filename, directory } = assetTarget(args);
  const key = r2NotebookPrefix(notebookId) + assetSubPath(directory, filename);
  // The repository size limit guards Git history, which a bucket-bound file never enters.
  const bytes = decodeAsset(args.base64Content, Infinity);
  // A create-only PUT reports a taken key instead of replacing an object other notes already link.
  if (!await putR2Object(settings, key, bytes)) throw new Error(`R2 object already exists: r2:${key}`);
  return { success: true as const, storage: 'r2' as const, filename: path.posix.basename(key), key, reference: `r2:${key}`, markdownRef: r2Reference(key) };
}

export async function handleAddAsset(ctx: ToolContext, args: { notebookId: string; } & AssetUpload) {
  await assertUserWorkspaceBranch(ctx.repoRoot);
  const config = loadWorkspaceConfig(ctx.repoRoot);
  if (!config) return { error: 'Workspace not configured' };

  const nb = config.notebooks.find((n) => n.id === args.notebookId);
  if (!nb) return { error: `Notebook '${args.notebookId}' not found` };

  const uploaded = await uploadR2Asset(nb.id, args);
  if (uploaded) return uploaded;

  const { filename, directory } = assetTarget(args);
  const relPath = assetPath(nb, directory, filename);
  const safeFilename = path.posix.basename(relPath);
  const targetPath = resolveSafePath(ctx.repoRoot, relPath);
  const buffer = decodeAsset(args.base64Content);

  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, buffer);

  const markdownRel = relPath.slice(nb.root.length + 1);
  const commit = await stageAndCommit(ctx.repoRoot, [relPath], `chore(assets): add asset ${safeFilename}`);

  return { success: true, storage: 'git', filename: safeFilename, path: relPath, reference: markdownRel, markdownRef: `![${safeFilename}](${markdownRel})`, commit };
}

/**
 * Deletes the object an `r2:` reference names, refusing while a note still links it so a live embed
 * cannot go missing behind the agent's back. Null when `reference` is not an `r2:` reference.
 */
export async function deleteR2Asset(reference: string, notebookIds: string[], notes: () => Promise<Map<string, string>>, force = false) {
  const key = parseR2Reference(reference);
  if (!key) return null;
  const settings = r2SettingsFromEnv();
  if (!settings) throw new Error('R2 storage is not configured.');
  if (!notebookIds.some(id => isNotebookR2Key(key, id))) throw new Error(`R2 key is outside this workspace: r2:${key}`);
  if (!await r2ObjectExists(settings, key)) throw new Error(`R2 object not found: r2:${key}`);
  const referencing = force ? [] : [...await notes()].filter(([, content]) => r2ReferenceKeys(content).includes(key)).map(([file]) => file).sort();
  if (referencing.length) throw new Error(`r2:${key} is still referenced by ${referencing.join(', ')}. Remove those references first, or pass force true.`);
  await deleteR2Object(settings, key);
  return { success: true as const, storage: 'r2' as const, key, reference: `r2:${key}` };
}

export async function handleDeleteAsset(ctx: ToolContext, args: { path: string; commitMessage?: string; force?: boolean; }) {
  await assertUserWorkspaceBranch(ctx.repoRoot);

  const config = loadWorkspaceConfig(ctx.repoRoot);
  if (!config) return { error: 'Workspace not configured' };

  const removed = await deleteR2Asset(args.path, config.notebooks.map(nb => nb.id), async () => localNotes(ctx, config.notebooks), args.force);
  if (removed) return removed;

  assertSafeRepoPath(ctx.repoRoot, args.path);
  if (!config.notebooks.some((nb) => isAssetPath(args.path, nb))) {
    return { error: 'Path is not a workspace asset.' };
  }

  const safePath = resolveSafePath(ctx.repoRoot, args.path);
  if (fs.existsSync(safePath)) {
    fs.unlinkSync(safePath);
  }

  const message = args.commitMessage || `chore(assets): delete ${path.basename(args.path)}`;
  const commitResult = await stageAndCommit(ctx.repoRoot, [args.path], message);

  return { success: true, path: args.path, commit: commitResult };
}
