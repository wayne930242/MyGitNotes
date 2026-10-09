import { parseWorkspaceConfig, serializeWorkspaceConfig, SUPPORTED_SCHEMA_VERSION } from './config.js';
import type { WorkspaceConfig } from './types.js';
import type { ManifestStore } from './workspace-config-source.js';

/**
 * The manifest of a repository that keeps none but whose member names a `folder`: one notebook rooted there, its id
 * the folder's last segment as a notebook id (`notes` when nothing usable is left), titled by that segment, with the
 * defaults a derived manifest uses. The repository is titled by its name and opens at that notebook.
 */
export function folderWorkspaceConfig(folder: string, title: string): WorkspaceConfig {
  const name = folder.split('/').pop() ?? '';
  const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'notes';
  return parseWorkspaceConfig(serializeWorkspaceConfig({ schema_version: SUPPORTED_SCHEMA_VERSION, workspace: { title, default_notebook: id }, notebooks: [{ id, title: name || folder, root: folder }] } as WorkspaceConfig));
}

/**
 * The manifest store of a member with a picked folder. While its repository keeps no manifest file (`inRepository`
 * reads none, or only one derived from its folders), it answers the one notebook at `folder` as derived, with the
 * revision of that read; saving creates the file through `inRepository`, which refuses with 409 when a manifest
 * appeared meanwhile. A manifest file, valid or not, is the repository's: an invalid one never falls back to the folder.
 */
export function folderManifest(inRepository: ManifestStore, folder: string, title: string): ManifestStore {
  return {
    async read() {
      const read = await inRepository.read();
      if (read.state !== 'missing' && read.state !== 'derived') return read;
      return { state: 'derived', config: folderWorkspaceConfig(folder, title), revision: read.revision };
    },
    save: (yaml, revision) => inRepository.save(yaml, revision),
  };
}
