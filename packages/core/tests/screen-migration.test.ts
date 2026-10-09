import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import YAML from 'yaml';
import { parseCompilation } from '../src/compilation.js';
import { FocusPageSchema } from '../src/focus-page.js';
import { legacyScreenToCompilations, migrateFocusLaneTabs } from '../src/screen-migration.js';
import { readScreenPage } from '../src/screen-page.js';
import { migrateWorkspace, PartialMigrationError, WorkspaceCompatibilityError } from '../src/workspace-migration.js';

const roots: string[] = [];
const temp = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mygitnotes-screen-migration-'));
  roots.push(root);
  return root;
};
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});
const write = (root: string, file: string, text: string) => {
  fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  fs.writeFileSync(path.join(root, file), text);
};
const read = (root: string, file: string) => fs.readFileSync(path.join(root, file), 'utf8');
const manifest = (version: number, extra = '') => `schema_version: ${version}\nworkspace:\n  title: W\n  default_notebook: a\nnotebooks:\n  - id: a\n    title: A\n    root: notes/a\n  - id: b\n    title: B\n    root: notes/b\n${extra}`;
const notebooks = [{ id: 'a', root: 'notes/a' }, { id: 'b', root: 'notes/b' }];
/** A repository's own manifest with the one notebook `id`, at notes/<id>. */
const ownManifest = (version: number, id: string) => `schema_version: ${version}\nworkspace:\n  title: W\n  default_notebook: ${id}\nnotebooks:\n  - id: ${id}\n    title: ${id.toUpperCase()}\n    root: notes/${id}\n`;

const screenV2 = { version: 2, rows: [{ id: 'reading', notebookId: 'a', kind: 'custom', name: 'Reading list', view: 'medium', items: [{ id: 'n1', kind: 'note', notebookId: 'a', path: 'notes/a/one.md' }, { id: 'y1', kind: 'youtube', videoId: 'dQw4w9WgXcQ', start: 12 }], progression: { stages: [{ status: 'new', intervalDays: 1 }], easy: 'two' }, study: { filter: 'due', dueFirst: true } }, { id: 'tagged', notebookId: 'a', kind: 'dynamic', name: 'Reading list', view: 'thumbnail', source: { kind: 'tag', tag: 'clue', notebookId: 'a' }, sort: { field: 'title', order: 'asc' } }, { id: 'graph', notebookId: 'b', kind: 'custom', name: 'Map', view: 'graph', items: [{ id: 'g1', kind: 'note', notebookId: 'b', path: 'notes/b/z.md' }], graph: { nodes: [{ path: 'notes/b/z.md', x: 10, y: 20 }] } }] };
const focusWithLanes = { version: 1, focuses: [{ id: 'weekly', notebookId: 'a', name: 'Weekly', division: 'columns-2', panes: [{ tabs: [{ kind: 'note', path: 'notes/a/one.md' }, { kind: 'lane', id: 'reading' }] }, { tabs: [{ kind: 'lane', id: 'gone' }, { kind: 'lane', id: 'tagged' }] }] }] };

describe('legacyScreenToCompilations', () => {
  it('names each lane after its title in its notebook, suffixing collisions and files already on disk', () => {
    const lanes = legacyScreenToCompilations(readScreenPage(screenV2, null), notebooks, file => file === 'notes/b/map.compilation.yml');
    expect(lanes.map(lane => [lane.id, lane.path])).toEqual([['reading', 'notes/a/reading-list.compilation.yml'], ['tagged', 'notes/a/reading-list-2.compilation.yml'], ['graph', 'notes/b/map-2.compilation.yml']]);
  });
  it('keeps the id, items or source, sort, study, progression and graph, and folds view into arrangement and size', () => {
    const [reading, tagged, graph] = legacyScreenToCompilations(readScreenPage(screenV2, null), notebooks).map(lane => parseCompilation(lane.content));
    expect(reading).toMatchObject({ id: 'reading', title: 'Reading list', arrangement: 'lane', size: 'medium', study: { filter: 'due', dueFirst: true }, progression: { easy: 'two' } });
    expect(reading.items).toEqual([{ id: 'n1', kind: 'note', path: 'notes/a/one.md' }, { id: 'y1', kind: 'youtube', videoId: 'dQw4w9WgXcQ', start: 12 }]);
    expect(tagged).toMatchObject({ id: 'tagged', arrangement: 'lane', size: 'thumbnail', source: { kind: 'tag', tag: 'clue' }, sort: { field: 'title', order: 'asc' } });
    expect(graph).toMatchObject({ id: 'graph', arrangement: 'graph', graph: { nodes: [{ path: 'notes/b/z.md', x: 10, y: 20 }] } });
  });
  it('reads a lane of a notebook this repository does not serve as an error', () => {
    expect(() => legacyScreenToCompilations(readScreenPage(screenV2, null), [notebooks[0]])).toThrow('belongs to notebook "b"');
  });
});

describe('migrateFocusLaneTabs', () => {
  it('turns lane tabs into path tabs and drops a tab whose lane is gone', () => {
    const { page, changedTabs, droppedTabs } = migrateFocusLaneTabs(focusWithLanes, new Map([['reading', 'notes/a/reading-list.compilation.yml'], ['tagged', 'notes/a/tagged.compilation.yml']]));
    expect([changedTabs, droppedTabs]).toEqual([2, 1]);
    expect(FocusPageSchema.parse(page).focuses[0].panes.map(pane => pane.tabs)).toEqual([[{ kind: 'note', path: 'notes/a/one.md' }, { kind: 'note', path: 'notes/a/reading-list.compilation.yml' }], [{ kind: 'note', path: 'notes/a/tagged.compilation.yml' }]]);
  });
});

describe('migrateWorkspace with a Screen file', () => {
  it.each([['version 2', screenV2], ['version 1', { version: 1, rows: [{ id: 'old', name: 'Old lane', view: 'reading', kind: 'custom', items: [{ id: 'o1', kind: 'note', notebookId: 'a', path: 'notes/a/one.md' }] }] }]])('migrates a %s Screen file and its Focus lane tabs, then removes the Screen file', (_label, screen) => {
    const root = temp();
    write(root, '.mygitnotes.yaml', manifest(2));
    write(root, '.github-notes-screen.yaml', YAML.stringify(screen));
    write(root, '.github-notes-focus.yaml', YAML.stringify(focusWithLanes));
    write(root, 'notes/a/one.md', '---\ncreated: 2026-01-01\nupdated: 2026-01-01\n---\n# One\n');
    const result = migrateWorkspace(root);
    expect(result.migrated).toBe(true);
    expect(fs.existsSync(path.join(root, '.github-notes-screen.yaml'))).toBe(false);
    expect(read(root, '.mygitnotes.yaml')).toMatch(/^schema_version: 4$/m);
    const repository = result.repositories[0];
    expect(repository.root).toBe(root);
    expect(repository.touched).toContain('.github-notes-screen.yaml');
    expect(repository.touched).toContain('.mygitnotes.yaml');
    for (const file of repository.touched.filter(file => file.endsWith('.compilation.yml'))) expect(parseCompilation(read(root, file), file.startsWith('notes/a/') ? 'notes/a' : 'notes/b').id).toBeTruthy();
    const focus = FocusPageSchema.parse(YAML.parse(read(root, '.github-notes-focus.yaml')));
    expect(focus.focuses[0].panes.flatMap(pane => pane.tabs).every(tab => tab.kind === 'note')).toBe(true);
    expect(migrateWorkspace(root)).toMatchObject({ migrated: false, repositories: [] });
  });
  it('writes nothing when a lane cannot convert', () => {
    const root = temp();
    write(root, '.mygitnotes.yaml', manifest(2));
    write(root, '.github-notes-screen.yaml', YAML.stringify({ version: 2, rows: [{ id: 'bad', notebookId: 'ghost', kind: 'custom', name: 'Bad', view: 'small', items: [] }] }));
    expect(() => migrateWorkspace(root)).toThrow(WorkspaceCompatibilityError);
    expect(read(root, '.mygitnotes.yaml')).toMatch(/^schema_version: 2$/m);
    expect(fs.existsSync(path.join(root, '.github-notes-screen.yaml'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'notes/a'))).toBe(false);
  });
  it('stops before writing when a touched file has uncommitted changes', () => {
    const root = temp();
    write(root, '.mygitnotes.yaml', manifest(2));
    write(root, '.github-notes-screen.yaml', YAML.stringify(screenV2));
    expect(() => migrateWorkspace(root, { dirtyFiles: () => ['.github-notes-screen.yaml'] })).toThrow(/uncommitted changes in files the migration touches: \.github-notes-screen\.yaml\./);
    expect(fs.existsSync(path.join(root, '.github-notes-screen.yaml'))).toBe(true);
    expect(read(root, '.mygitnotes.yaml')).toMatch(/^schema_version: 2$/m);
  });
  it('migrates each member worktree from its own manifest, and skips one that keeps none', () => {
    const root = temp(), other = temp(), bare = temp();
    write(root, '.mygitnotes.yaml', ownManifest(2, 'a'));
    write(other, '.mygitnotes.yaml', ownManifest(2, 'b'));
    write(root, '.github-notes-screen.yaml', YAML.stringify({ version: 2, rows: [screenV2.rows[0]] }));
    write(other, '.github-notes-screen.yaml', YAML.stringify({ version: 2, rows: [screenV2.rows[2]] }));
    const result = migrateWorkspace(root, { worktrees: [other, bare] });
    expect(result.repositories.map(repository => repository.root).sort()).toEqual([root, other].sort());
    expect(fs.existsSync(path.join(other, 'notes/b/map.compilation.yml'))).toBe(true);
    expect(fs.existsSync(path.join(other, '.github-notes-screen.yaml'))).toBe(false);
    expect(fs.existsSync(path.join(root, 'notes/a/reading-list.compilation.yml'))).toBe(true);
    expect(read(other, '.mygitnotes.yaml')).toMatch(/^schema_version: 4$/m);
    expect(fs.readdirSync(bare)).toEqual([]);
  });
  it('refuses a manifest that still uses source and names the conversion command, writing nothing', () => {
    const root = temp(), other = temp();
    write(root, '.mygitnotes.yaml', ownManifest(3, 'a'));
    write(other, '.mygitnotes.yaml', manifest(3).replace('  - id: b\n    title: B\n    root: notes/b\n', '  - id: b\n    title: B\n    root: notes/b\n    source: { type: github, repository: owner/trpg }\n'));
    expect(() => migrateWorkspace(root, { worktrees: [other] })).toThrow(/notebook\(s\) b use source, which schema 4 removed\. Run `pnpm convert-sources` in .* first\./);
    expect(read(root, '.mygitnotes.yaml')).toMatch(/^schema_version: 3$/m);
    expect(read(other, '.mygitnotes.yaml')).toMatch(/^schema_version: 3$/m);
  });
});

describe('migrateWorkspace edge paths', () => {
  const taggedLane = { version: 2, rows: [{ id: 'tagged', notebookId: 'a', kind: 'dynamic', name: 'Tagged', view: 'small', source: { kind: 'tag', tag: 'clue', notebookId: 'a' } }] };
  it('places compilations inside the notebook when the manifest sits in the notes/ tier', () => {
    const root = temp();
    write(root, 'notes/.mygitnotes.yaml', manifest(2).replaceAll('root: notes/', 'root: '));
    write(root, 'notes/a/one.md', '# One\n');
    write(root, '.github-notes-screen.yaml', YAML.stringify(taggedLane));
    const result = migrateWorkspace(root);
    expect(result.repositories[0].touched).toContain('notes/a/tagged.compilation.yml');
    expect(fs.existsSync(path.join(root, 'notes/a/tagged.compilation.yml'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'a'))).toBe(false);
    expect(result.repositories[0].touched).toContain('notes/.mygitnotes.yaml');
  });
  it('drops Focus lane tabs of a repository that has no Screen file', () => {
    const root = temp();
    write(root, '.mygitnotes.yaml', manifest(2));
    write(root, '.github-notes-focus.yaml', YAML.stringify(focusWithLanes));
    const result = migrateWorkspace(root);
    const focus = FocusPageSchema.parse(YAML.parse(read(root, '.github-notes-focus.yaml')));
    expect(focus.focuses[0].panes.flatMap(pane => pane.tabs).every(tab => tab.kind === 'note')).toBe(true);
    expect(result.repositories[0]).toMatchObject({ compilations: 0, droppedFocusTabs: 3 });
    expect(result.repositories[0].touched).toEqual(['.github-notes-focus.yaml', '.mygitnotes.yaml']);
  });
  it('commits the manifest bump on its own and refuses a manifest with uncommitted edits', () => {
    const root = temp();
    write(root, '.mygitnotes.yaml', manifest(2));
    expect(() => migrateWorkspace(root, { dirtyFiles: (_root, files) => files.filter(file => file === '.mygitnotes.yaml') })).toThrow(/uncommitted changes in files the migration touches: \.mygitnotes\.yaml\./);
    expect(read(root, '.mygitnotes.yaml')).toMatch(/^schema_version: 2$/m);
    const result = migrateWorkspace(root);
    expect(result.repositories).toEqual([{ root, touched: ['.mygitnotes.yaml'], compilations: 0, droppedFocusTabs: 0 }]);
  });
  it('reuses the files an interrupted run already wrote instead of suffixing them', () => {
    const root = temp();
    write(root, '.mygitnotes.yaml', manifest(2));
    write(root, '.github-notes-screen.yaml', YAML.stringify(taggedLane));
    const first = migrateWorkspace(root);
    const lanePaths = first.repositories[0].touched.filter(file => file.endsWith('.compilation.yml'));
    expect(lanePaths).toEqual(['notes/a/tagged.compilation.yml']);
    // The run stopped before it deleted the Screen file and bumped the manifest.
    write(root, '.github-notes-screen.yaml', YAML.stringify(taggedLane));
    write(root, '.mygitnotes.yaml', manifest(2));
    const asked: string[] = [];
    const second = migrateWorkspace(root, { dirtyFiles: (_root, files) => (asked.push(...files), []) });
    expect(second.repositories[0].touched.filter(file => file.endsWith('.compilation.yml'))).toEqual(lanePaths);
    expect(asked).not.toContain('notes/a/tagged.compilation.yml');
    expect(fs.existsSync(path.join(root, 'notes/a/tagged-2.compilation.yml'))).toBe(false);
  });
  it('treats a file with another id at the planned path as taken', () => {
    const root = temp();
    write(root, '.mygitnotes.yaml', manifest(2));
    write(root, 'notes/a/tagged.compilation.yml', 'version: 1\nid: someone-else\ntitle: Other\narrangement: lane\nsource:\n  kind: tag\n  tag: x\n');
    write(root, '.github-notes-screen.yaml', YAML.stringify(taggedLane));
    const result = migrateWorkspace(root);
    expect(result.repositories[0].touched).toContain('notes/a/tagged-2.compilation.yml');
    expect(read(root, 'notes/a/tagged.compilation.yml')).toContain('someone-else');
  });
  it("refuses to overwrite a file with the lane's id but other content", () => {
    const root = temp();
    write(root, '.mygitnotes.yaml', manifest(2));
    const mine = '# my list\nversion: 1\nid: tagged\ntitle: Tagged\narrangement: lane\nsource:\n  kind: tag\n  tag: other\n';
    write(root, 'notes/a/tagged.compilation.yml', mine);
    write(root, '.github-notes-screen.yaml', YAML.stringify(taggedLane));
    expect(() => migrateWorkspace(root)).toThrow(/notes\/a\/tagged\.compilation\.yml already holds a compilation with the id "tagged" but other content/);
    expect(read(root, 'notes/a/tagged.compilation.yml')).toBe(mine);
    expect(fs.existsSync(path.join(root, '.github-notes-screen.yaml'))).toBe(true);
    expect(read(root, '.mygitnotes.yaml')).toMatch(/^schema_version: 2$/m);
  });
  it.each([['not a mapping', 'focuses: {}\n'], ['a syntax error', 'focuses: [\n']])('does not stop on a raw error for a Focus file that is %s', (_label, text) => {
    const root = temp();
    write(root, '.mygitnotes.yaml', manifest(2));
    write(root, '.github-notes-focus.yaml', `version: 1\n${text}`);
    if (_label === 'not a mapping') {
      // Nothing to migrate in it: the manifest still moves on and Focus is left as it was.
      expect(migrateWorkspace(root).migrated).toBe(true);
      expect(read(root, '.github-notes-focus.yaml')).toBe(`version: 1\n${text}`);
    } else {
      expect(() => migrateWorkspace(root)).toThrow(/\.github-notes-focus\.yaml in .* cannot be read/);
      expect(read(root, '.mygitnotes.yaml')).toMatch(/^schema_version: 2$/m);
    }
  });
  it('reports the repositories already written when a later one cannot be', () => {
    const root = temp(), other = temp();
    write(root, '.mygitnotes.yaml', ownManifest(2, 'a'));
    write(other, '.mygitnotes.yaml', ownManifest(2, 'b'));
    write(root, '.github-notes-screen.yaml', YAML.stringify({ version: 2, rows: [screenV2.rows[0]] }));
    write(other, '.github-notes-screen.yaml', YAML.stringify({ version: 2, rows: [screenV2.rows[2]] }));
    // `notes` is a file here, so notes/b cannot be created.
    write(other, 'notes', 'not a directory');
    let caught: unknown;
    try {
      migrateWorkspace(root, { worktrees: [other] });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(PartialMigrationError);
    const { applied } = caught as PartialMigrationError;
    expect(applied.map(repository => repository.root)).toEqual([root]);
    expect(applied[0].touched).toContain('notes/a/reading-list.compilation.yml');
    // The written repository moved on whole; the one that failed kept its manifest, so a re-run tries it again.
    expect(read(root, '.mygitnotes.yaml')).toMatch(/^schema_version: 4$/m);
    expect(read(other, '.mygitnotes.yaml')).toMatch(/^schema_version: 2$/m);
  });
});
