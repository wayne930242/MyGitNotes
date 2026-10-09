import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { parseWorkspaceConfigAt, resolveWorkspaceConfigPath, SUPPORTED_SCHEMA_VERSION } from './config.js';
import { scanNotebookNotes } from './note-service.js';
import { applyScreenMigration, planScreenMigration, ScreenMigrationError, type ScreenMigrationPlan } from './screen-migration.js';
import type { WorkspaceConfig } from './types.js';

export { SUPPORTED_SCHEMA_VERSION } from './config.js';

export class WorkspaceCompatibilityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorkspaceCompatibilityError';
  }
}

/** A repository could not be written after others had been: those hold uncommitted migration files a re-run no longer sees. */
export class PartialMigrationError extends WorkspaceCompatibilityError {
  constructor(message: string, public readonly applied: MigratedRepository[]) {
    super(message);
    this.name = 'PartialMigrationError';
  }
}

function readSchemaVersion(root: string): { file: string; version: unknown; } {
  const relative = resolveWorkspaceConfigPath(root);
  if (!relative) throw new WorkspaceCompatibilityError(`No MyGitNotes workspace found at ${root}. Run \`pnpm link-workspace <path>\` to use an existing workspace, or \`pnpm bootstrap-workspace\` to create one.`);
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

export interface MigrationOptions {
  /** Worktrees of the workspace's other members, each migrated from its own manifest; a worktree without one is skipped. */
  worktrees?: string[];
  /** The files of `files` with uncommitted changes in the worktree `root`, a file Git has never seen included; a worktree with any is not migrated. */
  dirtyFiles?(root: string, files: string[]): string[];
}

export interface MigratedRepository {
  root: string;
  /** Repository-relative files written or deleted, the manifest included when its schema_version moved. */
  touched: string[];
  compilations: number;
  droppedFocusTabs: number;
}

export interface WorkspaceMigrationResult {
  migrated: boolean;
  notesMissingTimestamps: number;
  /** Repositories the migration wrote; the caller commits each. */
  repositories: MigratedRepository[];
}

/** One worktree's migration, planned before anything is written. */
interface WorktreePlan {
  root: string;
  file: string;
  /** The manifest as it will be written, when its schema_version moves. */
  bumped?: string;
  config: WorkspaceConfig;
  plan: ScreenMigrationPlan | null;
}

/** Notebooks that still name their repository by `source`, which schema 4 removed, read without validating the rest. */
function sourceNotebooks(text: string): string[] {
  const notebooks = (YAML.parse(text) as { notebooks?: unknown; } | null)?.notebooks;
  return Array.isArray(notebooks) ? notebooks.filter(notebook => notebook && typeof notebook === 'object' && 'source' in notebook).map(notebook => String((notebook as { id?: unknown; }).id)) : [];
}

/** Plans one worktree: its manifest at the supported schema and, from schema 1 or 2, its Screen file as compilations. */
function planWorktree(root: string, dirtyFiles: (root: string, files: string[]) => string[]): WorktreePlan {
  const { file, version } = readSchemaVersion(root);
  if (typeof version === 'number' && version > SUPPORTED_SCHEMA_VERSION) assertWorkspaceCompatible(root);
  // Version 2 added notebook `source`; version 3 replaced the Screen file with compilation files; version 4 removed `source`.
  if (version !== undefined && version !== 1 && version !== 2 && version !== 3 && version !== SUPPORTED_SCHEMA_VERSION) {
    throw new WorkspaceCompatibilityError(`${file} uses schema_version ${String(version)}; this Core has no migration from it to ${SUPPORTED_SCHEMA_VERSION}.`);
  }
  const text = fs.readFileSync(file, 'utf8');
  const sourced = sourceNotebooks(text);
  if (sourced.length) throw new WorkspaceCompatibilityError(`${file}: notebook(s) ${sourced.join(', ')} use source, which schema 4 removed. Run \`pnpm convert-sources\` in ${root} first.`);
  // The manifest as it will be written, so a missing or old schema_version does not keep its notebooks from being read.
  let bumped: string | undefined;
  if (version !== SUPPORTED_SCHEMA_VERSION) {
    const document = YAML.parseDocument(text);
    document.set('schema_version', SUPPORTED_SCHEMA_VERSION);
    const map = document.contents as YAML.YAMLMap;
    const index = map.items.findIndex(item => YAML.isScalar(item.key) && item.key.value === 'schema_version');
    map.items.unshift(...map.items.splice(index, 1));
    bumped = document.toString();
  }
  const manifest = path.relative(root, file).split(path.sep).join('/');
  const config = parseWorkspaceConfigAt(root, manifest, bumped ?? text);
  let plan: ScreenMigrationPlan | null;
  try {
    plan = planScreenMigration(root, config.notebooks, config.workspace.default_notebook);
  } catch (error) {
    if (error instanceof ScreenMigrationError) throw new WorkspaceCompatibilityError(error.message);
    throw error;
  }
  // A manifest whose version moves always has a plan, so the bump is committed with the rest.
  if (!plan && bumped !== undefined) plan = { lanes: [], touched: [] };
  if (plan) {
    if (bumped !== undefined) plan.touched.push(manifest);
    // Files an interrupted earlier run already wrote with the planned content are not local changes to lose.
    const written = new Set(plan.lanes.filter(lane => lane.written).map(lane => lane.path));
    const dirty = dirtyFiles(root, plan.touched.filter(touched => !written.has(touched)));
    if (dirty.length) throw new WorkspaceCompatibilityError(`${root} has uncommitted changes in files the migration touches: ${dirty.join(', ')}. Commit them (a file Git has never seen counts too) or discard them, then run \`pnpm migrate-workspace\` again.`);
  }
  return { root, file, ...(bumped !== undefined ? { bumped } : {}), config, plan };
}

/**
 * Brings the manifest of `root` and of every worktree in `worktrees` to the supported schema, each from its own
 * manifest, and counts notes that need a timestamp backfill. Every worktree is planned first, so a manifest still
 * using `source`, a lane that cannot convert or a worktree with local changes stops the migration before anything is
 * written. Each worktree's Screen file is converted before its manifest moves, so an interrupted run is run again.
 */
export function migrateWorkspace(root: string, options: MigrationOptions = {}): WorkspaceMigrationResult {
  const dirtyFiles = options.dirtyFiles ?? (() => []);
  const others = (options.worktrees ?? []).filter(worktree => path.resolve(worktree) !== path.resolve(root) && resolveWorkspaceConfigPath(worktree));
  const plans = [root, ...others].map(worktree => planWorktree(worktree, dirtyFiles));
  const repositories: MigratedRepository[] = [];
  for (const { root: worktree, file, bumped, plan } of plans) {
    if (!plan) continue;
    try {
      applyScreenMigration(worktree, plan);
      if (bumped !== undefined) fs.writeFileSync(file, bumped);
    } catch (error) {
      throw new PartialMigrationError(`Writing the migration in ${worktree} failed: ${error instanceof Error ? error.message : String(error)}. Its manifest was not bumped${repositories.length ? `; ${repositories.length} repository(ies) before it were already written but not committed` : ''}.`, repositories);
    }
    repositories.push({ root: worktree, touched: [...plan.touched], compilations: plan.lanes.length, droppedFocusTabs: plan.focus?.droppedTabs ?? 0 });
  }
  let notesMissingTimestamps = 0;
  for (const { root: worktree, config } of plans) {
    for (const notebook of config.notebooks) {
      for (const note of scanNotebookNotes(worktree, notebook)) {
        if (!note.metadata.created || !note.metadata.updated) notesMissingTimestamps++;
      }
    }
  }
  return { migrated: repositories.length > 0, notesMissingTimestamps, repositories };
}
