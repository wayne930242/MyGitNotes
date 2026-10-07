import path from 'node:path';
import fs from 'node:fs';
import { assetPath, type AssetScope, assetSubPath, decodeAsset, deleteR2Object, inAssetScope, isAssetPath, isNotebookR2Key, listR2Objects, loadWorkspaceConfig, parseR2Reference, putR2Object, R2_MAX_OBJECT_BYTES, r2NotebookPrefix, r2ObjectExists, r2Reference, r2ReferenceKeys, r2SettingsFromEnv, resolveSafePath, scanNotebookMarkdownNotes } from '@mygitnotes/core';
import { stageAndCommit } from '@mygitnotes/git';
import { assertSafeRepoPath, assertUserWorkspaceBranch } from '../guards.js';
import type { ToolContext } from './context.js';

/** Every note body in the workspace, keyed by path, for checking what an R2 object is still linked from. */
const localNotes = (ctx: ToolContext, notebooks: Parameters<typeof scanNotebookMarkdownNotes>[1][]) => new Map(notebooks.flatMap(nb => scanNotebookMarkdownNotes(ctx.repoRoot, nb)).map(note => [note.path, note.content]));

/**
 * What the asset tools use of the bucket in one call. The hosted server adapts its `AssetStorage` to it, resolved
 * for the repository the call reaches, so the tools keep to the same bucket, key prefix and quota as the R2 routes.
 */
export interface ToolAssets {
  /** The bucket and key prefix this call may use, or null when R2 is not available to it. */
  scope(): Promise<AssetScope | null>;
  /** Called with the exact key and size before an upload; throws when it would exceed a quota. */
  reserve?(scope: AssetScope, key: string, bytes: number): Promise<void>;
  /** Called with the signed size change after an object is created or deleted. */
  record?(scope: AssetScope, key: string, deltaBytes: number): Promise<void>;
}

/** The community behavior, and the local server's: the bucket comes from the environment when each call is made, every key is allowed, nothing is metered. */
export function envToolAssets(env: NodeJS.ProcessEnv = process.env): ToolAssets {
  return {
    scope: async () => {
      const settings = r2SettingsFromEnv(env);
      return settings && { settings, prefix: '', limits: { maxObjectBytes: R2_MAX_OBJECT_BYTES } };
    },
  };
}

/** The notebooks' R2 objects with the reference a note links each by; null when R2 is unavailable to the call. */
export async function listR2Assets(assets: ToolAssets, notebookIds: string[]) {
  const scope = await assets.scope();
  if (!scope) return null;
  const listed = [];
  for (const notebookId of notebookIds) {
    for (const object of await listR2Objects(scope.settings, scope.prefix + r2NotebookPrefix(notebookId))) {
      const name = path.posix.basename(object.key);
      // A `.keep` placeholder only exists to hold an empty folder open.
      if (!inAssetScope(scope, object.key) || !isNotebookR2Key(object.key.slice(scope.prefix.length), notebookId) || name.startsWith('.')) continue;
      listed.push({ storage: 'r2' as const, notebookId, name, key: object.key, size: object.size, lastModified: object.lastModified, reference: `r2:${object.key}`, markdownRef: r2Reference(object.key) });
    }
  }
  return listed;
}

export async function handleListAssets(ctx: ToolContext, args: { notebookId: string; }) {
  const config = ctx.config ?? loadWorkspaceConfig(ctx.repoRoot);
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

  return { assets: [...files, ...await listR2Assets(ctx.assets ?? envToolAssets(), [nb.id]) || []] };
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
 * Stores an asset in the call's private R2 bucket so a binary never enters Git history, under the scope's key
 * prefix and within its quota, and returns the `r2:` reference a note links it by. Null when R2 is unavailable
 * to the call, which keeps the asset in the repository.
 */
export async function uploadR2Asset(assets: ToolAssets, notebookId: string, args: AssetUpload) {
  const scope = await assets.scope();
  if (!scope) return null;
  const { filename, directory } = assetTarget(args);
  const key = scope.prefix + r2NotebookPrefix(notebookId) + assetSubPath(directory, filename);
  // The repository size limit guards Git history, which a bucket-bound file never enters; the scope's object limit still applies.
  const bytes = decodeAsset(args.base64Content, scope.limits.maxObjectBytes);
  if (await r2ObjectExists(scope.settings, key)) throw new Error(`R2 object already exists: r2:${key}`);
  await assets.reserve?.(scope, key, bytes.length);
  // A create-only PUT reports a taken key instead of replacing an object other notes already link.
  if (!await putR2Object(scope.settings, key, bytes)) throw new Error(`R2 object already exists: r2:${key}`);
  await assets.record?.(scope, key, bytes.length);
  return { success: true as const, storage: 'r2' as const, filename: path.posix.basename(key), key, reference: `r2:${key}`, markdownRef: r2Reference(key) };
}

export async function handleAddAsset(ctx: ToolContext, args: { notebookId: string; } & AssetUpload) {
  await assertUserWorkspaceBranch(ctx.repoRoot);
  const config = ctx.config ?? loadWorkspaceConfig(ctx.repoRoot);
  if (!config) return { error: 'Workspace not configured' };

  const nb = config.notebooks.find((n) => n.id === args.notebookId);
  if (!nb) return { error: `Notebook '${args.notebookId}' not found` };

  const uploaded = await uploadR2Asset(ctx.assets ?? envToolAssets(), nb.id, args);
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
 * cannot go missing behind the agent's back. A key outside the call's scope is not found. Null when
 * `reference` is not an `r2:` reference.
 */
export async function deleteR2Asset(assets: ToolAssets, reference: string, notebookIds: string[], notes: () => Promise<Map<string, string>>, force = false) {
  const key = parseR2Reference(reference);
  if (!key) return null;
  const scope = await assets.scope();
  if (!scope) throw new Error('R2 storage is not configured.');
  if (!inAssetScope(scope, key)) throw new Error(`R2 object not found: r2:${key}`);
  if (!notebookIds.some(id => isNotebookR2Key(key.slice(scope.prefix.length), id))) throw new Error(`R2 key is outside this workspace: r2:${key}`);
  // A storage that meters sizes learns the deleted object's size from the bucket.
  const size = assets.record ? (await listR2Objects(scope.settings, key)).find(object => object.key === key)?.size : await r2ObjectExists(scope.settings, key) ? 0 : undefined;
  if (size === undefined) throw new Error(`R2 object not found: r2:${key}`);
  const referencing = force ? [] : [...await notes()].filter(([, content]) => r2ReferenceKeys(content).includes(key)).map(([file]) => file).sort();
  if (referencing.length) throw new Error(`r2:${key} is still referenced by ${referencing.join(', ')}. Remove those references first, or pass force true.`);
  await deleteR2Object(scope.settings, key);
  await assets.record?.(scope, key, -size);
  return { success: true as const, storage: 'r2' as const, key, reference: `r2:${key}` };
}

export async function handleDeleteAsset(ctx: ToolContext, args: { path: string; commitMessage?: string; force?: boolean; }) {
  await assertUserWorkspaceBranch(ctx.repoRoot);

  const config = ctx.config ?? loadWorkspaceConfig(ctx.repoRoot);
  if (!config) return { error: 'Workspace not configured' };

  const removed = await deleteR2Asset(ctx.assets ?? envToolAssets(), args.path, config.notebooks.map(nb => nb.id), async () => localNotes(ctx, config.notebooks), args.force);
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
