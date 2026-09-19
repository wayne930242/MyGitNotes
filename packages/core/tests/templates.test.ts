import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { ConfigValidationError, parseWorkspaceConfig } from '../src/config.js';
import { formatTemplateDate, loadNoteTemplate, renderNoteTemplate } from '../src/templates.js';
import { scanNotebookNotes } from '../src/note-service.js';
import type { NotebookConfig } from '../src/types.js';

describe('Notebook template configuration', () => {
  it('parses notebook templates with id, title and file', () => {
    const yaml = `
schema_version: 1
workspace:
  title: "Templates"
  default_notebook: academic
notebooks:
  - id: academic
    title: "Academic"
    root: notes/academic
    templates:
      - id: reading
        title: "Literature Note"
        file: .templates/reading.md
`;
    const config = parseWorkspaceConfig(yaml);
    expect(config.notebooks[0].templates).toEqual([{ id: 'reading', title: 'Literature Note', file: '.templates/reading.md' }]);
  });

  it('rejects a template file path that escapes the notebook', () => {
    const yaml = `
schema_version: 1
workspace:
  title: "Templates"
  default_notebook: academic
notebooks:
  - id: academic
    title: "Academic"
    root: notes/academic
    templates:
      - id: reading
        title: "Literature Note"
        file: ../../etc/passwd
`;
    expect(() => parseWorkspaceConfig(yaml)).toThrow(ConfigValidationError);
  });

  it('rejects duplicate template ids within a notebook', () => {
    const yaml = `
schema_version: 1
workspace:
  title: "Templates"
  default_notebook: academic
notebooks:
  - id: academic
    title: "Academic"
    root: notes/academic
    templates:
      - id: reading
        title: "One"
        file: .templates/one.md
      - id: reading
        title: "Two"
        file: .templates/two.md
`;
    expect(() => parseWorkspaceConfig(yaml)).toThrow(ConfigValidationError);
  });
});

describe('loadNoteTemplate + renderNoteTemplate', () => {
  let repoRoot: string;
  const notebook: NotebookConfig = { id: 'academic', title: 'Academic', root: 'notes/academic', templates: [{ id: 'reading', title: 'Literature Note', file: 'templates/reading.md' }] };

  beforeEach(() => {
    repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-notes-templates-'));
    const templateDir = path.join(repoRoot, 'notes/academic/templates');
    fs.mkdirSync(templateDir, { recursive: true });
    fs.writeFileSync(path.join(templateDir, 'reading.md'), '---\ntitle: "{{title}}"\nstatus: unread\ntags:\n  - reading\ncreated_on: "{{date}}"\n---\n\n# {{title}}\n\nCaptured on {{date}}.\n', 'utf-8');
  });

  afterEach(() => {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  });

  it('substitutes {{title}} and {{date}} in frontmatter and body', () => {
    const template = loadNoteTemplate(repoRoot, notebook, 'reading');
    const rendered = renderNoteTemplate(template, { title: 'Grounding and Explanation', date: '2026-09-16' });
    expect(rendered.metadata.title).toBe('Grounding and Explanation');
    expect(rendered.metadata.created_on).toBe('2026-09-16');
    expect(rendered.metadata.status).toBe('unread');
    expect(rendered.metadata.tags).toEqual(['reading']);
    expect(rendered.content).toContain('# Grounding and Explanation');
    expect(rendered.content).toContain('Captured on 2026-09-16.');
  });

  it('formats today as an ISO date', () => {
    expect(formatTemplateDate(new Date('2026-09-16T12:00:00Z'))).toBe('2026-09-16');
  });

  it('treats the title as a literal value, not a String.replace pattern', () => {
    const template = loadNoteTemplate(repoRoot, notebook, 'reading');
    const rendered = renderNoteTemplate(template, { title: 'Budget $$ $& $1 report', date: '2026-09-16' });
    expect(rendered.metadata.title).toBe('Budget $$ $& $1 report');
    expect(rendered.content).toContain('# Budget $$ $& $1 report');
  });

  it('excludes configured template files from notebook note scanning', () => {
    fs.writeFileSync(path.join(repoRoot, 'notes/academic/paper.md'), '---\ntitle: Paper\n---\n\nBody.\n', 'utf-8');
    const notes = scanNotebookNotes(repoRoot, notebook);
    expect(notes.map(n => n.path)).toEqual(['notes/academic/paper.md']);
  });
});
