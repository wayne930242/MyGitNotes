import fs from 'node:fs';
import path from 'node:path';
import { loadWorkspaceConfig, parseWorkspaceConfig, resolveWorkspaceConfigPath, serializeWorkspaceConfig, WORKSPACE_CONFIG_FILENAME } from './config.js';
import { SourceError } from './github-api.js';
import type { ManifestStore } from './workspace-config-source.js';

/** Commits the given repository-relative files in a worktree. */
export type LocalCommit = (root: string, files: string[], message: string) => Promise<unknown>;

/** The manifest kept as a file in a local worktree. Local writes are not revision-checked, so the revision is empty. */
export function localManifest(root: string, commit: LocalCommit): ManifestStore {
  const load = async () => {
    const config = loadWorkspaceConfig(root);
    if (!config) throw new SourceError('Workspace manifest missing.', 422);
    return { config, revision: '' };
  };
  return {
    load,
    async save(yaml) {
      const validated = parseWorkspaceConfig(yaml);
      const file = resolveWorkspaceConfigPath(root) ?? path.posix.join('notes', WORKSPACE_CONFIG_FILENAME);
      const target = path.join(root, file);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, serializeWorkspaceConfig(validated), 'utf-8');
      await commit(root, [file], 'chore(workspace): update configuration');
      return load();
    },
  };
}
