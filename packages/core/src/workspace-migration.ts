import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { loadWorkspaceConfig, resolveWorkspaceConfigPath } from './config.js';
import { scanNotebookNotes } from './note-service.js';

/** The workspace manifest schema this Core reads and writes. */
export const SUPPORTED_SCHEMA_VERSION = 1;

export class WorkspaceCompatibilityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorkspaceCompatibilityError';
  }
}

function readSchemaVersion(root: string): { file: string; version: unknown } {
  const relative = resolveWorkspaceConfigPath(root);
  if (!relative) throw new WorkspaceCompatibilityError(`No MyGitNotes workspace found at ${root}. Run \`pnpm bootstrap-workspace\` or set MYGITNOTES_LOCAL_PATH.`);
  const file = path.join(root, relative);
  return { file, version: (YAML.parse(fs.readFileSync(file, 'utf8')) as { schema_version?: unknown } | null)?.schema_version };
}

/** Startup check: this Core only serves workspaces on its own schema version. */
export function assertWorkspaceCompatible(root: string): void {
  const { file, version } = readSchemaVersion(root);
  if (version === SUPPORTED_SCHEMA_VERSION) return;
  if (typeof version === 'number' && version > SUPPORTED_SCHEMA_VERSION) {
    throw new WorkspaceCompatibilityError(`${file} uses schema_version ${version}; it requires a newer Core than this one (${SUPPORTED_SCHEMA_VERSION}). Update Core with \`pnpm update-core\`.`);
  }
  throw new WorkspaceCompatibilityError(`${file} uses schema_version ${String(version)}; this Core supports ${SUPPORTED_SCHEMA_VERSION}. Run \`pnpm migrate-workspace\`.`);
}

export interface WorkspaceMigrationResult {
  migrated: boolean;
  notesMissingTimestamps: number;
}

/** Brings the workspace manifest to the supported schema and counts notes that need a timestamp backfill. */
export function migrateWorkspace(root: string): WorkspaceMigrationResult {
  const { file, version } = readSchemaVersion(root);
  if (typeof version === 'number' && version > SUPPORTED_SCHEMA_VERSION) assertWorkspaceCompatible(root);
  let migrated = false;
  if (version !== SUPPORTED_SCHEMA_VERSION) {
    const document = YAML.parseDocument(fs.readFileSync(file, 'utf8'));
    document.set('schema_version', SUPPORTED_SCHEMA_VERSION);
    const map = document.contents as YAML.YAMLMap;
    const index = map.items.findIndex(item => YAML.isScalar(item.key) && item.key.value === 'schema_version');
    map.items.unshift(...map.items.splice(index, 1));
    fs.writeFileSync(file, document.toString());
    migrated = true;
  }
  let notesMissingTimestamps = 0;
  for (const notebook of loadWorkspaceConfig(root)?.notebooks ?? []) {
    for (const note of scanNotebookNotes(root, notebook)) {
      if (!note.metadata.created || !note.metadata.updated) notesMissingTimestamps++;
    }
  }
  return { migrated, notesMissingTimestamps };
}
