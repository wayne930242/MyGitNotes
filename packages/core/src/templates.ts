import fs from 'node:fs';
import path from 'node:path';
import { NotebookConfig, NoteMetadata } from './types.js';
import { resolveSafePath } from './path-guard.js';
import { parseNoteContent } from './frontmatter.js';

export interface LoadedNoteTemplate {
  id: string;
  title: string;
  metadata: NoteMetadata;
  content: string;
}

export interface RenderedNoteTemplate {
  metadata: NoteMetadata;
  content: string;
}

export interface TemplateVariables {
  title: string;
  date: string;
}

/** Formats a date as `YYYY-MM-DD` for the `{{date}}` template variable. */
export function formatTemplateDate(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

function substitute(value: unknown, vars: TemplateVariables): unknown {
  if (typeof value === 'string') {
    return value.replace(/\{\{\s*title\s*\}\}/g, vars.title).replace(/\{\{\s*date\s*\}\}/g, vars.date);
  }
  if (Array.isArray(value)) {
    return value.map(item => substitute(item, vars));
  }
  if (value && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) result[key] = substitute(item, vars);
    return result;
  }
  return value;
}

/** Reads a notebook's configured template file (frontmatter + body) safely from disk. */
export function loadNoteTemplate(
  repoRoot: string,
  notebook: NotebookConfig,
  templateId: string
): LoadedNoteTemplate {
  const entry = notebook.templates?.find(t => t.id === templateId);
  if (!entry) {
    throw new Error(`Template '${templateId}' is not configured for notebook '${notebook.id}'`);
  }
  const safePath = resolveSafePath(repoRoot, path.posix.join(notebook.root, entry.file));
  if (!fs.existsSync(safePath)) {
    throw new Error(`Template file not found: ${entry.file}`);
  }
  const raw = fs.readFileSync(safePath, 'utf-8');
  const { metadata, content } = parseNoteContent(raw, path.basename(entry.file));
  return { id: entry.id, title: entry.title, metadata, content };
}

/**
 * Substitutes `{{title}}` and `{{date}}` in a template's frontmatter and body.
 * The resulting metadata always carries the given title, matching normal note creation.
 */
export function renderNoteTemplate(
  template: { metadata: NoteMetadata; content: string },
  vars: TemplateVariables
): RenderedNoteTemplate {
  const metadata = substitute(template.metadata, vars) as NoteMetadata;
  const content = substitute(template.content, vars) as string;
  return { metadata: { ...metadata, title: vars.title }, content };
}
