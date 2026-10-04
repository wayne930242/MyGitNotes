import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { compilationFile, type CompilationRow, compilationSlug, parseCompilation, serializeCompilation, uniqueCompilationPath } from './compilation.js';
import { FOCUS_PAGE_FILE, FocusPageSchema } from './focus-page.js';
import { readScreenPage, SCREEN_PAGE_FILE, type ScreenPage } from './screen-page.js';
import { serializeWorkspaceDocument } from './workspace-documents.js';

/** Why a Screen file cannot become compilations; nothing is written until every lane converts. */
export class ScreenMigrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ScreenMigrationError';
  }
}

export interface ScreenMigrationLane {
  id: string;
  /** Repository-relative path of the compilation file the lane becomes. */
  path: string;
  content: string;
}

export interface ScreenMigrationPlan {
  lanes: ScreenMigrationLane[];
  /** The rewritten Focus file, when the repository has one and a lane tab changed. */
  focus?: { content: string; changedTabs: number; droppedTabs: number; };
  /** Repository-relative files the migration writes or deletes. */
  touched: string[];
}

/** The lanes of a Screen page as compilation files, named after their lane and placed in their notebook's root. */
export function legacyScreenToCompilations(page: ScreenPage, notebooks: readonly { id: string; root: string; }[], taken: (file: string) => boolean = () => false): ScreenMigrationLane[] {
  const planned = new Set<string>();
  return page.rows.map(row => {
    const notebook = notebooks.find(candidate => candidate.id === row.notebookId);
    if (!notebook) throw new ScreenMigrationError(`Lane "${row.name}" belongs to notebook "${row.notebookId}", which this repository does not serve.`);
    const file = uniqueCompilationPath(notebook.root, compilationSlug(row.name), candidate => planned.has(candidate) || taken(candidate));
    planned.add(file);
    const content = serializeCompilation(compilationFile({ ...row, path: file } as CompilationRow));
    try {
      parseCompilation(content, notebook.root);
    } catch (error) {
      throw new ScreenMigrationError(`Lane "${row.name}" cannot become ${file}: ${(error as Error).message}`);
    }
    return { id: row.id, path: file, content };
  });
}

interface RawTab {
  kind?: unknown;
  id?: unknown;
  path?: unknown;
}

/** Focus lane tabs become path tabs to the lane's compilation file; a tab whose lane is gone is dropped. */
export function migrateFocusLaneTabs(raw: unknown, paths: ReadonlyMap<string, string>): { page: unknown; changedTabs: number; droppedTabs: number; } {
  let changedTabs = 0;
  let droppedTabs = 0;
  const focuses = ((raw as { focuses?: unknown[]; } | null)?.focuses ?? []).map(focus => {
    const record = focus as { panes?: { tabs?: RawTab[]; }[]; };
    return {
      ...record,
      panes: (record.panes ?? []).map(pane => ({
        ...pane,
        tabs: (pane.tabs ?? []).flatMap(tab => {
          if (tab.kind !== 'lane') return [tab];
          const file = typeof tab.id === 'string' ? paths.get(tab.id) : undefined;
          if (!file) {
            droppedTabs++;
            return [];
          }
          changedTabs++;
          return [{ kind: 'note', path: file }];
        }),
      })),
    };
  });
  return { page: { ...(raw as object), focuses }, changedTabs, droppedTabs };
}

/**
 * What migrating one worktree takes: its Screen lanes as compilation files and its Focus rewritten to path tabs.
 * Returns null when the worktree has no Screen file. Reads only; `applyScreenMigration` writes.
 */
export function planScreenMigration(root: string, notebooks: readonly { id: string; root: string; }[], defaultNotebook?: string): ScreenMigrationPlan | null {
  const screenFile = path.join(root, SCREEN_PAGE_FILE);
  if (!fs.existsSync(screenFile)) return null;
  if (notebooks.length === 0) throw new ScreenMigrationError(`${root} has a Screen file but serves no notebook.`);
  const fallback = notebooks.find(notebook => notebook.id === defaultNotebook)?.id ?? notebooks[0].id;
  let page: ScreenPage;
  try {
    page = readScreenPage(YAML.parse(fs.readFileSync(screenFile, 'utf8'), { maxAliasCount: 20 }), { workspace: { default_notebook: fallback }, notebooks: [...notebooks] });
  } catch (error) {
    throw new ScreenMigrationError(`${SCREEN_PAGE_FILE} in ${root} is not a valid Screen file: ${(error as Error).message.split('\n')[0]}`);
  }
  const lanes = legacyScreenToCompilations(page, notebooks, file => fs.existsSync(path.join(root, file)));
  const touched = [...lanes.map(lane => lane.path), SCREEN_PAGE_FILE];
  const plan: ScreenMigrationPlan = { lanes, touched };
  const focusFile = path.join(root, FOCUS_PAGE_FILE);
  if (fs.existsSync(focusFile)) {
    const migrated = migrateFocusLaneTabs(YAML.parse(fs.readFileSync(focusFile, 'utf8'), { maxAliasCount: 20 }), new Map(lanes.map(lane => [lane.id, lane.path])));
    if (migrated.changedTabs || migrated.droppedTabs) {
      let focus;
      try {
        focus = FocusPageSchema.parse(migrated.page);
      } catch (error) {
        throw new ScreenMigrationError(`${FOCUS_PAGE_FILE} in ${root} cannot be migrated: ${(error as Error).message.split('\n')[0]}`);
      }
      plan.focus = { content: serializeWorkspaceDocument(focus), changedTabs: migrated.changedTabs, droppedTabs: migrated.droppedTabs };
      touched.push(FOCUS_PAGE_FILE);
    }
  }
  return plan;
}

/** Writes the compilation files and the Focus file, then deletes the Screen file last so a failure can be re-run. */
export function applyScreenMigration(root: string, plan: ScreenMigrationPlan): void {
  for (const lane of plan.lanes) {
    const target = path.join(root, lane.path);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, lane.content);
  }
  if (plan.focus) fs.writeFileSync(path.join(root, FOCUS_PAGE_FILE), plan.focus.content);
  fs.rmSync(path.join(root, SCREEN_PAGE_FILE));
}
