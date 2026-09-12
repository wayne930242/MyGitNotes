import { describe, it, expect } from 'vitest';
import { parseWorkspaceConfig, ConfigValidationError } from '../src/config.js';

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
});
