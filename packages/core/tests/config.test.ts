import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ConfigValidationError, LEGACY_WORKSPACE_CONFIG_FILENAME, loadWorkspaceConfig, parseWorkspaceConfig, resolveWorkspaceConfigPath, serializeWorkspaceConfig, WORKSPACE_CONFIG_FILENAME } from '../src/config.js';

describe('Workspace Config Parser', () => {
  it('parses a valid multi-notebook configuration', () => {
    const yaml = `
schema_version: 1
workspace:
  title: "My Research Notes"
  default_notebook: personal
notebooks:
  - id: personal
    title: "Personal Notes"
    root: notes/personal
    assets: assets
    default_view: card
  - id: work
    title: "Work Notes"
    root: notes/work
    assets: media
    default_view: kanban
files:
  hide_dotfiles: true
`;
    const config = parseWorkspaceConfig(yaml);
    expect(config.schema_version).toBe(1);
    expect(config.workspace.title).toBe('My Research Notes');
    expect(config.workspace.default_notebook).toBe('personal');
    expect(config.notebooks).toHaveLength(2);
    expect(config.notebooks[0].id).toBe('personal');
    expect(config.notebooks[1].id).toBe('work');
    expect(config.notebooks[1].default_view).toBe('kanban');
    expect(config.files?.hide_dotfiles).toBe(true);
    expect(config.preferences).toEqual({ defaultYoutubeDisplayMode: 'thumbnail', defaultShowLineNumbers: false, defaultFocusMode: false });
  });

  it('keeps the obsolete files.hide_dotfiles only where a manifest sets it, so saving never adds it', () => {
    const base = 'schema_version: 3\nworkspace:\n  title: T\n  default_notebook: a\nnotebooks:\n  - id: a\n    title: A\n    root: notes/a\n';
    const without = parseWorkspaceConfig(base);
    expect(without.files).toBeUndefined();
    expect(serializeWorkspaceConfig(without)).not.toContain('hide_dotfiles');
    const kept = parseWorkspaceConfig(`${base}files:\n  hide_dotfiles: false\n`);
    expect(kept.files).toEqual({ hide_dotfiles: false });
    expect(parseWorkspaceConfig(serializeWorkspaceConfig(kept)).files).toEqual({ hide_dotfiles: false });
  });

  it('rejects duplicate notebook IDs', () => {
    const yaml = `
schema_version: 1
workspace:
  title: "Dupes"
  default_notebook: nb1
notebooks:
  - id: nb1
    title: "NB 1"
    root: notes/nb1
  - id: nb1
    title: "Duplicate NB"
    root: notes/nb2
`;
    expect(() => parseWorkspaceConfig(yaml)).toThrow(ConfigValidationError);
  });

  it('rejects overlapping notebook roots', () => {
    const yaml = `
schema_version: 1
workspace:
  title: "Overlap"
  default_notebook: nb1
notebooks:
  - id: nb1
    title: "Parent"
    root: notes/parent
  - id: nb2
    title: "Nested Child"
    root: notes/parent/child
`;
    expect(() => parseWorkspaceConfig(yaml)).toThrow(ConfigValidationError);
  });

  it('rejects notebook roots escaping repository root', () => {
    const yaml = `
schema_version: 1
workspace:
  title: "Escape"
  default_notebook: nb1
notebooks:
  - id: nb1
    title: "Escape"
    root: ../escaped_notes
`;
    expect(() => parseWorkspaceConfig(yaml)).toThrow(ConfigValidationError);
  });

  it('rejects default_notebook not present in notebooks list', () => {
    const yaml = `
schema_version: 1
workspace:
  title: "Missing Default"
  default_notebook: non_existent
notebooks:
  - id: nb1
    title: "NB 1"
    root: notes/nb1
`;
    expect(() => parseWorkspaceConfig(yaml)).toThrow(ConfigValidationError);
  });

  it('parses notebook metadata field definitions', () => {
    const yaml = `
schema_version: 1
workspace:
  title: "With Metadata"
  default_notebook: nb1
notebooks:
  - id: nb1
    title: "NB 1"
    root: notes/nb1
    metadata:
      - draft
      - key: private
        type: boolean
        label: "私密文章"
      - key: order
        type: number
`;
    const config = parseWorkspaceConfig(yaml);
    expect(config.notebooks[0].metadata).toEqual([{ key: 'draft' }, { key: 'private', type: 'boolean', label: '私密文章' }, { key: 'order', type: 'number' }]);
  });

  it('rejects duplicate metadata field keys', () => {
    const yaml = `
schema_version: 1
workspace:
  title: "Dupes"
  default_notebook: nb1
notebooks:
  - id: nb1
    title: "NB 1"
    root: notes/nb1
    metadata:
      - draft
      - key: draft
        type: boolean
`;
    expect(() => parseWorkspaceConfig(yaml)).toThrow(ConfigValidationError);
  });

  it('parses notebook pathAliases when specified', () => {
    const yaml = `
schema_version: 1
workspace:
  title: "With Aliases"
  default_notebook: nb1
notebooks:
  - id: nb1
    title: "NB 1"
    root: notes/nb1
    path_aliases:
      "@/*": "src/*"
`;
    const config = parseWorkspaceConfig(yaml);
    expect(config.notebooks[0].pathAliases).toEqual({ '@/*': 'src/*' });
  });
});

describe('Workspace preferences', () => {
  const base = `
schema_version: 1
workspace:
  title: "Prefs"
  default_notebook: nb1
notebooks:
  - id: nb1
    title: "NB 1"
    root: notes/nb1
`;

  it('accepts configured preference values', () => {
    const yaml = `${base}preferences:\n  defaultYoutubeDisplayMode: theater\n  defaultShowLineNumbers: true\n  defaultFocusMode: true\n`;
    const config = parseWorkspaceConfig(yaml);
    expect(config.preferences).toEqual({ defaultYoutubeDisplayMode: 'theater', defaultShowLineNumbers: true, defaultFocusMode: true });
  });

  it('defaults preferences when the block is absent', () => {
    const config = parseWorkspaceConfig(base);
    expect(config.preferences).toEqual({ defaultYoutubeDisplayMode: 'thumbnail', defaultShowLineNumbers: false, defaultFocusMode: false });
  });

  it('falls back to defaults for invalid preference values instead of throwing', () => {
    const yaml = `${base}preferences:\n  defaultYoutubeDisplayMode: music\n  defaultShowLineNumbers: "yes"\n  defaultFocusMode: 1\n`;
    const config = parseWorkspaceConfig(yaml);
    expect(config.preferences).toEqual({ defaultYoutubeDisplayMode: 'thumbnail', defaultShowLineNumbers: false, defaultFocusMode: false });
  });

  it('does not require a schema_version bump', () => {
    const config = parseWorkspaceConfig(base);
    expect(config.schema_version).toBe(1);
  });
});

describe('Notebook source', () => {
  const manifest = (version: number, notebooks: string) => `schema_version: ${version}\nworkspace:\n  title: T\n  default_notebook: a\nnotebooks:\n${notebooks}`;
  const home = '  - id: a\n    title: A\n    root: notes\n';

  it('parses a notebook repository and defaults its branch to main', () => {
    const config = parseWorkspaceConfig(manifest(2, `${home}  - id: b\n    title: B\n    root: notes\n    source:\n      type: github\n      repository: owner/trpg\n`));
    expect(config.notebooks[1].source).toEqual({ type: 'github', repository: 'owner/trpg', branch: 'main' });
    expect(config.notebooks[0].source).toBeUndefined();
  });
  it('lets roots overlap only across repositories', () => {
    expect(() => parseWorkspaceConfig(manifest(2, `${home}  - id: b\n    title: B\n    root: notes/b\n    source: { type: github, repository: owner/trpg }\n  - id: c\n    title: C\n    root: notes\n    source: { type: github, repository: owner/trpg }\n`))).toThrow(/overlap/);
  });
  it('needs schema_version 2, a platform repository and a GitLab site', () => {
    expect(() => parseWorkspaceConfig(manifest(1, `${home}  - id: b\n    title: B\n    root: b\n    source: { type: github, repository: owner/trpg }\n`))).toThrow(/schema_version 2/);
    expect(() => parseWorkspaceConfig(manifest(2, `${home}  - id: b\n    title: B\n    root: b\n    source: { type: local, path: ../b }\n`))).toThrow(/github or gitlab/);
    expect(() => parseWorkspaceConfig(manifest(2, `${home}  - id: b\n    title: B\n    root: b\n    source: { type: gitlab, repository: group/project }\n`))).toThrow(/GitLab site/);
    expect(() => parseWorkspaceConfig(manifest(2, `${home}  - id: b\n    title: B\n    root: b\n    source: { type: github, repository: 'not a repo' }\n`))).toThrow(ConfigValidationError);
  });
  it('refuses a schema_version newer than this Core', () => {
    expect(() => parseWorkspaceConfig(manifest(4, home))).toThrow(/newer Core/);
  });
  it('keeps a notebook repository root unprefixed when the manifest lives under notes/', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mygitnotes-source-'));
    fs.mkdirSync(path.join(root, 'notes/a'), { recursive: true });
    fs.mkdirSync(path.join(root, 'notes/b'), { recursive: true });
    fs.writeFileSync(path.join(root, 'notes', WORKSPACE_CONFIG_FILENAME), manifest(2, '  - id: a\n    title: A\n    root: a\n  - id: b\n    title: B\n    root: b\n    source: { type: github, repository: owner/trpg }\n'));
    expect(loadWorkspaceConfig(root)!.notebooks.map(notebook => notebook.root)).toEqual(['notes/a', 'b']);
    fs.rmSync(root, { recursive: true, force: true });
  });
});

describe('Workspace manifest filename resolution', () => {
  let root: string;
  const manifest = (title: string) => `schema_version: 1\nworkspace:\n  title: ${title}\n  default_notebook: a\nnotebooks:\n  - id: a\n    title: A\n    root: notes/a\n`;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'mygitnotes-config-'));
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it('loads the standard filename from the repository root', () => {
    fs.writeFileSync(path.join(root, WORKSPACE_CONFIG_FILENAME), manifest('Standard'));
    expect(loadWorkspaceConfig(root)?.workspace.title).toBe('Standard');
    expect(resolveWorkspaceConfigPath(root)).toBe(WORKSPACE_CONFIG_FILENAME);
  });

  it('falls back to the legacy filename when only it exists', () => {
    fs.writeFileSync(path.join(root, LEGACY_WORKSPACE_CONFIG_FILENAME), manifest('Legacy'));
    expect(loadWorkspaceConfig(root)?.workspace.title).toBe('Legacy');
    expect(resolveWorkspaceConfigPath(root)).toBe(LEGACY_WORKSPACE_CONFIG_FILENAME);
  });

  it('prefers the standard filename over the legacy filename in the same directory', () => {
    fs.writeFileSync(path.join(root, WORKSPACE_CONFIG_FILENAME), manifest('Standard'));
    fs.writeFileSync(path.join(root, LEGACY_WORKSPACE_CONFIG_FILENAME), manifest('Legacy'));
    expect(loadWorkspaceConfig(root)?.workspace.title).toBe('Standard');
    expect(resolveWorkspaceConfigPath(root)).toBe(WORKSPACE_CONFIG_FILENAME);
  });

  it('accepts either filename at the legacy notes/ location, preferring the notes/ tier over root', () => {
    fs.mkdirSync(path.join(root, 'notes'), { recursive: true });
    fs.writeFileSync(path.join(root, 'notes', LEGACY_WORKSPACE_CONFIG_FILENAME), manifest('NotesLegacy'));
    fs.writeFileSync(path.join(root, WORKSPACE_CONFIG_FILENAME), manifest('Root'));
    expect(loadWorkspaceConfig(root)?.workspace.title).toBe('NotesLegacy');
    expect(resolveWorkspaceConfigPath(root)).toBe(path.posix.join('notes', LEGACY_WORKSPACE_CONFIG_FILENAME));
  });

  it('returns null when neither filename exists', () => {
    expect(loadWorkspaceConfig(root)).toBeNull();
    expect(resolveWorkspaceConfigPath(root)).toBeNull();
  });
});
