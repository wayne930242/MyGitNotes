import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ConfigValidationError, LEGACY_WORKSPACE_CONFIG_FILENAME, loadWorkspaceConfig, parseWorkspaceConfig, resolveWorkspaceConfigPath, WORKSPACE_CONFIG_FILENAME } from '../src/config.js';

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
