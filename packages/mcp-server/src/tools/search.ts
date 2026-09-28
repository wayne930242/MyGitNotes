import fs from 'node:fs';
import { loadWorkspaceConfig, matchNoteGlob, NoteItem, resolveSafePath, scanNotebookNotes, textLines, textSearchRegex, type WorkspaceConfig } from '@mygitnotes/core';
import { stageAndCommit } from '@mygitnotes/git';
import { assertUserWorkspaceBranch } from '../guards.js';
import type { ToolContext } from './context.js';

interface NoteScope {
  isRegex?: boolean;
  pattern?: string;
  notebookId?: string;
  caseSensitive?: boolean;
}

/** Builds the request's matcher, or the tool error for an invalid pattern. */
function scopeRegex(query: string, args: NoteScope): RegExp | { error: string; } {
  try {
    return textSearchRegex(query, args.isRegex, args.caseSensitive);
  } catch (err) {
    return { error: `Invalid regular expression: ${(err as Error).message}` };
  }
}

/** Notes in the requested notebook (or all), narrowed by the optional path glob. */
function scopeNotes(ctx: ToolContext, config: WorkspaceConfig, args: NoteScope): NoteItem[] {
  const notebooks = args.notebookId ? config.notebooks.filter((nb) => nb.id === args.notebookId) : config.notebooks;
  const notes = notebooks.flatMap((nb) => scanNotebookNotes(ctx.repoRoot, nb));
  if (!args.pattern) return notes;
  const matcher = matchNoteGlob(args.pattern);
  return notes.filter((n) => matcher(n.path));
}

export async function handleSearchNotes(ctx: ToolContext, args: NoteScope & { query: string; maxResults?: number; }) {
  const config = ctx.config ?? loadWorkspaceConfig(ctx.repoRoot);
  if (!config) return { error: 'Workspace not configured' };
  if (!args.query) return { error: 'query is required' };

  const re = scopeRegex(args.query, args);
  if (!(re instanceof RegExp)) return re;
  const filteredNotes = scopeNotes(ctx, config, args);

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

export async function handleReplaceNotes(ctx: ToolContext, args: NoteScope & { find: string; replace: string; dryRun?: boolean; commitMessage?: string; }) {
  if (!args.dryRun) {
    await assertUserWorkspaceBranch(ctx.repoRoot);
  }
  const config = ctx.config ?? loadWorkspaceConfig(ctx.repoRoot);
  if (!config) return { error: 'Workspace not configured' };
  if (!args.find) return { error: 'find parameter is required' };
  if (args.replace === undefined) return { error: 'replace parameter is required' };

  const re = scopeRegex(args.find, args);
  if (!(re instanceof RegExp)) return re;
  const filteredNotes = scopeNotes(ctx, config, args);

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
