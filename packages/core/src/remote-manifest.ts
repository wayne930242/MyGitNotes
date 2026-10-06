import { LEGACY_WORKSPACE_CONFIG_FILENAME, parseWorkspaceConfig, serializeWorkspaceConfig, SUPPORTED_SCHEMA_VERSION, WORKSPACE_CONFIG_FILENAME } from './config.js';
import type { RemoteEntry, RemoteSnapshot, RemoteSource } from './remote-source.js';
import type { WorkspaceConfig } from './types.js';
import type { ManifestStore } from './workspace-config-source.js';

/** Where a repository may keep its workspace manifest, in lookup order. */
export const MANIFEST_FILES = [`notes/${WORKSPACE_CONFIG_FILENAME}`, `notes/${LEGACY_WORKSPACE_CONFIG_FILENAME}`, WORKSPACE_CONFIG_FILENAME, LEGACY_WORKSPACE_CONFIG_FILENAME];

interface ManifestRecord {
  config: WorkspaceConfig;
  file: string;
  /** Notebooks whose root this read prefixed with `notes/`, so a save restores the stored form. */
  prefixed: ReadonlySet<string>;
  /** The repository has no manifest; `config` was derived from its folders and `file` is where a save creates one. */
  derived: boolean;
}

/** Folders that hold tooling or attachments rather than notes. */
const SKIPPED_FOLDERS = new Set(['node_modules', 'assets']);

/**
 * A manifest for a repository that has none: each top-level folder holding Markdown becomes a notebook, so any
 * repository opens at once. Without such a folder the workspace starts with an empty `notes` notebook.
 */
export function deriveWorkspaceConfig(entries: readonly RemoteEntry[], title: string): WorkspaceConfig {
  const folders = entries.filter(entry => entry.type === 'tree' && !entry.path.includes('/') && !entry.path.startsWith('.') && !SKIPPED_FOLDERS.has(entry.path) && entries.some(file => file.type === 'blob' && file.path.startsWith(`${entry.path}/`) && /\.md$/i.test(file.path))).map(entry => entry.path).sort();
  const roots = folders.length ? folders : ['notes'];
  const used = new Set<string>();
  const notebooks = roots.map(root => {
    const base = root.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'notebook';
    let id = base;
    for (let n = 2; used.has(id); n++) id = `${base}-${n}`;
    used.add(id);
    return { id, title: root, root };
  });
  return parseWorkspaceConfig(serializeWorkspaceConfig({ schema_version: SUPPORTED_SCHEMA_VERSION, workspace: { title, default_notebook: notebooks[0].id }, notebooks } as WorkspaceConfig));
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
    if (!file) return { config: deriveWorkspaceConfig(entries, this.reader.repository.split('/').pop() || 'Notes'), file: WORKSPACE_CONFIG_FILENAME, prefixed: new Set(), derived: true };
    const config = parseWorkspaceConfig((await this.reader.readFile(file)).toString('utf8'));
    const prefixed = new Set<string>();
    if (file.startsWith('notes/')) {
      config.notebooks = config.notebooks.map(nb => {
        if (nb.source || nb.root.startsWith('notes/') || nb.root === 'notes' || !entries.some(e => e.path === `notes/${nb.root}` && e.type === 'tree')) return nb;
        prefixed.add(nb.id);
        return { ...nb, root: `notes/${nb.root}` };
      });
    }
    return { config, file, prefixed, derived: false };
  }

  async load() {
    const { sha, record } = await this.current();
    return { config: record.config, revision: sha, ...(record.derived ? { derived: true } : {}) };
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
