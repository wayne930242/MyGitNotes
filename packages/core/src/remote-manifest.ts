import { LEGACY_WORKSPACE_CONFIG_FILENAME, parseWorkspaceConfig, serializeWorkspaceConfig, WORKSPACE_CONFIG_FILENAME } from './config.js';
import { SourceError } from './github-api.js';
import type { RemoteSnapshot, RemoteSource } from './remote-source.js';
import type { WorkspaceConfig } from './types.js';
import type { ManifestStore } from './workspace-config-source.js';

/** Where a repository may keep its workspace manifest, in lookup order. */
export const MANIFEST_FILES = [`notes/${WORKSPACE_CONFIG_FILENAME}`, `notes/${LEGACY_WORKSPACE_CONFIG_FILENAME}`, WORKSPACE_CONFIG_FILENAME, LEGACY_WORKSPACE_CONFIG_FILENAME];

interface ManifestRecord {
  config: WorkspaceConfig;
  file: string;
  /** Notebooks whose root this read prefixed with `notes/`, so a save restores the stored form. */
  prefixed: ReadonlySet<string>;
}

/** The manifest kept as a file in a remote home repository, read once per snapshot. */
export class RemoteManifest implements ManifestStore {
  private record?: { sha: string; value: Promise<ManifestRecord>; };
  constructor(private readonly reader: RemoteSource) {}

  private async current() {
    const snapshot = await this.reader.getSnapshot();
    if (this.record?.sha !== snapshot.sha) this.record = { sha: snapshot.sha, value: this.read(snapshot) };
    return { sha: snapshot.sha, record: await this.record.value };
  }

  private async read({ entries }: RemoteSnapshot): Promise<ManifestRecord> {
    const file = MANIFEST_FILES.find(p => entries.some(e => e.path === p && e.type === 'blob'));
    if (!file) throw new SourceError('Workspace manifest missing. Run pnpm bootstrap-workspace in the note repository and push its workspace branch.', 422);
    const config = parseWorkspaceConfig((await this.reader.readFile(file)).toString('utf8'));
    const prefixed = new Set<string>();
    if (file.startsWith('notes/')) {
      config.notebooks = config.notebooks.map(nb => {
        if (nb.root.startsWith('notes/') || nb.root === 'notes' || !entries.some(e => e.path === `notes/${nb.root}` && e.type === 'tree')) return nb;
        prefixed.add(nb.id);
        return { ...nb, root: `notes/${nb.root}` };
      });
    }
    return { config, file, prefixed };
  }

  async load() {
    const { sha, record } = await this.current();
    return { config: record.config, revision: sha };
  }

  /** Writes the manifest back to its own file, restoring every root this store prefixed with `notes/`. */
  async save(yaml: string, revision: string) {
    const { record } = await this.current();
    const validated = parseWorkspaceConfig(yaml);
    if (record.prefixed.size) validated.notebooks = validated.notebooks.map(nb => record.prefixed.has(nb.id) && nb.root.startsWith('notes/') ? { ...nb, root: nb.root.slice('notes/'.length) } : nb);
    await this.reader.commitManifest(record.file, serializeWorkspaceConfig(validated), revision);
    return this.load();
  }
}
