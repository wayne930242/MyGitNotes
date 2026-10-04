import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { loadWorkspaceConfig, parseWorkspaceConfig, resolveWorkspaceConfigPath, SUPPORTED_SCHEMA_VERSION } from './config.js';
import { scanNotebookNotes } from './note-service.js';
import { applyScreenMigration, planScreenMigration, ScreenMigrationError, type ScreenMigrationPlan } from './screen-migration.js';
import type { NotebookConfig, WorkspaceConfig } from './types.js';

export { SUPPORTED_SCHEMA_VERSION } from './config.js';

export class WorkspaceCompatibilityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorkspaceCompatibilityError';
  }
}

function readSchemaVersion(root: string): { file: string; version: unknown; } {
  const relative = resolveWorkspaceConfigPath(root);
  if (!relative) throw new WorkspaceCompatibilityError(`No MyGitNotes workspace found at ${root}. Run \`pnpm bootstrap-workspace\` or set MYGITNOTES_LOCAL_PATH.`);
  const file = path.join(root, relative);
  return { file, version: (YAML.parse(fs.readFileSync(file, 'utf8')) as { schema_version?: unknown; } | null)?.schema_version };
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

/** A worktree that serves notebooks of its own repository, such as the one `mygitnotes.server.yaml` maps to a notebook `source`. */
export interface MigrationWorktree {
  root: string;
  notebooks: NotebookConfig[];
}

export interface MigrationOptions {
  /** Worktrees of notebook repositories, migrated with the home repository; a function receives the manifest being migrated. */
  worktrees?: MigrationWorktree[] | ((config: WorkspaceConfig) => MigrationWorktree[]);
  /** Whether none of `files` has uncommitted changes in the worktree `root`; a worktree that is not clean is not migrated. */
  isClean?(root: string, files: string[]): boolean;
}

export interface MigratedRepository {
  root: string;
  /** Repository-relative files written or deleted, the manifest included for the home repository. */
  touched: string[];
  compilations: number;
  droppedFocusTabs: number;
}

export interface WorkspaceMigrationResult {
  migrated: boolean;
  notesMissingTimestamps: number;
  /** Repositories whose Screen file became compilations; the caller commits each. */
  repositories: MigratedRepository[];
}

/** Brings the workspace manifest to the supported schema and counts notes that need a timestamp backfill. */
export function migrateWorkspace(root: string, options: MigrationOptions = {}): WorkspaceMigrationResult {
  const { file, version } = readSchemaVersion(root);
  if (typeof version === 'number' && version > SUPPORTED_SCHEMA_VERSION) assertWorkspaceCompatible(root);
  // Version 2 adds notebook `source`; version 3 replaces the Screen file with compilation files.
  if (version !== undefined && version !== 1 && version !== 2 && version !== SUPPORTED_SCHEMA_VERSION) {
    throw new WorkspaceCompatibilityError(`${file} uses schema_version ${String(version)}; this Core has no migration from it to ${SUPPORTED_SCHEMA_VERSION}.`);
  }
  // The manifest as it will be written, so a missing or old schema_version does not keep its notebooks from being read.
  let bumped: string | undefined;
  if (version !== SUPPORTED_SCHEMA_VERSION) {
    const document = YAML.parseDocument(fs.readFileSync(file, 'utf8'));
    document.set('schema_version', SUPPORTED_SCHEMA_VERSION);
    const map = document.contents as YAML.YAMLMap;
    const index = map.items.findIndex(item => YAML.isScalar(item.key) && item.key.value === 'schema_version');
    map.items.unshift(...map.items.splice(index, 1));
    bumped = document.toString();
  }
  const config = bumped === undefined ? loadWorkspaceConfig(root) : parseWorkspaceConfig(bumped);
  const isClean = options.isClean ?? (() => true);
  // Plan every repository first: a lane that cannot convert, or a worktree with local changes, stops the migration before anything is written.
  const worktrees: MigrationWorktree[] = [{ root, notebooks: (config?.notebooks ?? []).filter(notebook => !notebook.source) }, ...(typeof options.worktrees === 'function' ? (config ? options.worktrees(config) : []) : options.worktrees ?? []).filter(worktree => path.resolve(worktree.root) !== path.resolve(root))];
  const plans: { worktree: MigrationWorktree; plan: ScreenMigrationPlan; }[] = [];
  for (const worktree of worktrees) {
    let plan: ScreenMigrationPlan | null;
    try {
      plan = planScreenMigration(worktree.root, worktree.notebooks, config?.workspace.default_notebook);
    } catch (error) {
      if (error instanceof ScreenMigrationError) throw new WorkspaceCompatibilityError(error.message);
      throw error;
    }
    if (!plan) continue;
    if (!isClean(worktree.root, plan.touched)) throw new WorkspaceCompatibilityError(`${worktree.root} has uncommitted changes in files the migration touches. Commit or discard them, then run \`pnpm migrate-workspace\` again.`);
    plans.push({ worktree, plan });
  }
  const repositories: MigratedRepository[] = plans.map(({ worktree, plan }) => {
    applyScreenMigration(worktree.root, plan);
    return { root: worktree.root, touched: [...plan.touched], compilations: plan.lanes.length, droppedFocusTabs: plan.focus?.droppedTabs ?? 0 };
  });
  let migrated = repositories.length > 0;
  if (bumped !== undefined) {
    fs.writeFileSync(file, bumped);
    migrated = true;
    const home = repositories.find(repository => path.resolve(repository.root) === path.resolve(root));
    if (home) home.touched.push(path.relative(root, file));
  }
  let notesMissingTimestamps = 0;
  // Notebooks in their own repositories are counted by the backfill in their worktrees.
  for (const notebook of (config?.notebooks ?? []).filter(notebook => !notebook.source)) {
    for (const note of scanNotebookNotes(root, notebook)) {
      if (!note.metadata.created || !note.metadata.updated) notesMissingTimestamps++;
    }
  }
  return { migrated, notesMissingTimestamps, repositories };
}
