import fs from 'node:fs';
import { loadWorkspaceConfig, matchNoteGlob, NoteItem, resolveSafePath, scanNotebookNotes, textLines } from '@mygitnotes/core';
import { stageAndCommit } from '@mygitnotes/git';
import { assertUserWorkspaceBranch } from '../guards.js';
import type { ToolContext } from './context.js';

export async function handleSearchNotes(ctx: ToolContext, args: { query: string; isRegex?: boolean; pattern?: string; notebookId?: string; caseSensitive?: boolean; maxResults?: number; }) {
  const config = loadWorkspaceConfig(ctx.repoRoot);
  if (!config) return { error: 'Workspace not configured' };
  if (!args.query) return { error: 'query is required' };

  let re: RegExp;
  try {
    if (args.isRegex) {
      re = new RegExp(args.query, args.caseSensitive ? 'g' : 'gi');
    } else {
      const escaped = args.query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      re = new RegExp(escaped, args.caseSensitive ? 'g' : 'gi');
    }
  } catch (err) {
    return { error: `Invalid regular expression: ${(err as Error).message}` };
  }

  const notebooks = args.notebookId ? config.notebooks.filter((nb) => nb.id === args.notebookId) : config.notebooks;

  const notes: NoteItem[] = [];
  for (const nb of notebooks) {
    notes.push(...scanNotebookNotes(ctx.repoRoot, nb));
  }

  let filteredNotes = notes;
  if (args.pattern) {
    const matcher = matchNoteGlob(args.pattern);
    filteredNotes = notes.filter((n) => matcher(n.path));
  }

  const maxResults = args.maxResults || 100;
  const matches: { path: string; line: number; text: string; matches?: string[]; }[] = [];
  let scannedFiles = 0;
  let truncated = false;

  for (const note of filteredNotes) {
    scannedFiles++;
    const safePath = resolveSafePath(ctx.repoRoot, note.path);
    const raw = fs.readFileSync(safePath, 'utf-8');
    const lines = textLines(raw);

    for (let i = 0; i < lines.length; i++) {
      const lineText = lines[i];
      re.lastIndex = 0;
      const matchTerms = lineText.match(re);
      if (matchTerms && matchTerms.length > 0) {
        matches.push({ path: note.path, line: i + 1, text: lineText.replace(/\r?\n$/, '').slice(0, 2000), matches: [...new Set(matchTerms)] });
        if (matches.length >= maxResults) {
          truncated = true;
          break;
        }
      }
    }
    if (truncated) break;
  }

  return { matches, totalMatches: matches.length, scannedFiles, truncated };
}

export async function handleReplaceNotes(ctx: ToolContext, args: { find: string; replace: string; isRegex?: boolean; pattern?: string; notebookId?: string; caseSensitive?: boolean; dryRun?: boolean; commitMessage?: string; }) {
  if (!args.dryRun) {
    await assertUserWorkspaceBranch(ctx.repoRoot);
  }
  const config = loadWorkspaceConfig(ctx.repoRoot);
  if (!config) return { error: 'Workspace not configured' };
  if (!args.find) return { error: 'find parameter is required' };
  if (args.replace === undefined) return { error: 'replace parameter is required' };

  let re: RegExp;
  try {
    if (args.isRegex) {
      re = new RegExp(args.find, args.caseSensitive ? 'g' : 'gi');
    } else {
      const escaped = args.find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      re = new RegExp(escaped, args.caseSensitive ? 'g' : 'gi');
    }
  } catch (err) {
    return { error: `Invalid regular expression: ${(err as Error).message}` };
  }

  const notebooks = args.notebookId ? config.notebooks.filter((nb) => nb.id === args.notebookId) : config.notebooks;

  const notes: NoteItem[] = [];
  for (const nb of notebooks) {
    notes.push(...scanNotebookNotes(ctx.repoRoot, nb));
  }

  let filteredNotes = notes;
  if (args.pattern) {
    const matcher = matchNoteGlob(args.pattern);
    filteredNotes = notes.filter((n) => matcher(n.path));
  }

  const changedFiles: string[] = [];
  let totalReplacements = 0;

  for (const note of filteredNotes) {
    const safePath = resolveSafePath(ctx.repoRoot, note.path);
    const raw = fs.readFileSync(safePath, 'utf-8');
    re.lastIndex = 0;
    const matchTerms = raw.match(re);
    if (matchTerms && matchTerms.length > 0) {
      re.lastIndex = 0;
      const updated = raw.replace(re, args.replace);
      if (updated !== raw) {
        changedFiles.push(note.path);
        totalReplacements += matchTerms.length;
        if (!args.dryRun) {
          fs.writeFileSync(safePath, updated, 'utf-8');
        }
      }
    }
  }

  let commit: { commitHash: string; shortHash: string; } | undefined;
  if (!args.dryRun && changedFiles.length > 0) {
    const message = args.commitMessage || `chore(notes): replace ${args.find.slice(0, 30)} in ${changedFiles.length} file(s)`;
    commit = await stageAndCommit(ctx.repoRoot, changedFiles, message);
  }

  return { success: true, dryRun: Boolean(args.dryRun), changedFiles, totalReplacements, commit };
}
