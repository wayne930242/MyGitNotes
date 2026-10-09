import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { loadedWorkspaceConfigFile, parseWorkspaceConfig, parseWorkspaceConfigAt, serializeWorkspaceConfig, WORKSPACE_CONFIG_FILENAME } from './config.js';
import { SourceError } from './github-api.js';
import type { ManifestRead, RepositoryManifestFile } from './repository-manifest.js';
import type { ManifestStore } from './workspace-config-source.js';

/** Commits the given repository-relative files in a worktree. */
export type LocalCommit = (root: string, files: string[], message: string) => Promise<unknown>;

/** The revision of a worktree that has no manifest file; a save sending it creates one only while there is still none. */
export const MISSING_MANIFEST_REVISION = 'none';

/** A local manifest's revision: a hash of the file it was read from and its text, so any edit or move changes it. */
const contentRevision = (file: string, text: string) => `sha256:${createHash('sha256').update(file).update('\0').update(text).digest('hex')}`;

/** The revision of a manifest file that exists but cannot be read, such as a directory or a file without read permission. */
const unreadRevision = (file: string) => `unread:${file}`;

/** The manifest file of a worktree and its text, or null when it has none; `error` instead of text when the file cannot be read. */
function readFile(root: string): { file: string; text: string; error?: undefined; } | { file: string; error: Error; } | null {
  const file = loadedWorkspaceConfigFile(root);
  if (!file) return null;
  try {
    return { file, text: fs.readFileSync(path.join(root, file), 'utf-8') };
  } catch (error) {
    return { file, error: error as Error };
  }
}

/**
 * The manifest kept as a file in a local worktree. Its revision is a hash of the file, and a save whose revision no
 * longer matches answers 409 without writing; callers serialize saves with the worktree's other mutations.
 * `newFile` is where a save creates the manifest when the worktree has none.
 */
export function localManifest(root: string, commit: LocalCommit, newFile = path.posix.join('notes', WORKSPACE_CONFIG_FILENAME)): ManifestStore & RepositoryManifestFile {
  const current = () => {
    const found = readFile(root);
    return { found, revision: !found ? MISSING_MANIFEST_REVISION : found.error ? unreadRevision(found.file) : contentRevision(found.file, found.text) };
  };
  const load = async () => {
    const { found, revision } = current();
    if (!found) throw new SourceError('Workspace manifest missing.', 422);
    if (found.error) throw found.error;
    return { config: parseWorkspaceConfigAt(root, found.file, found.text), revision };
  };
  const read = async (): Promise<ManifestRead> => {
    const { found, revision } = current();
    if (!found) return { state: 'missing', revision };
    if (found.error) return { state: 'invalid', text: '', error: found.error.message, revision };
    try {
      return { state: 'file', config: parseWorkspaceConfigAt(root, found.file, found.text), revision };
    } catch (error) {
      return { state: 'invalid', text: found.text, error: (error as Error).message, revision };
    }
  };
  return {
    load,
    read,
    async save(yaml: string, revision: string) {
      const { found, revision: actual } = current();
      if (revision !== actual) throw new SourceError('The workspace manifest changed since it was read. Reload before saving.', 409);
      const validated = parseWorkspaceConfig(yaml);
      const file = found?.file ?? newFile;
      const target = path.join(root, file);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, serializeWorkspaceConfig(validated), 'utf-8');
      await commit(root, [file], 'chore(workspace): update configuration');
      return load();
    },
  };
}
