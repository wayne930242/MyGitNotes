import path from 'node:path';
import fs from 'node:fs';
import { DEFAULT_NOTE_STATUSES, deleteNoteFile, loadWorkspaceConfig, type NotebookConfig, NoteItem, noteSummary, readNoteFile, resolveNoteStatuses, resolveSafePath, scanNotebookNotes, withNoteEdits, type WorkspaceConfig, writeNoteFile } from '@mygitnotes/core';
import { generateCommitMessage, stageAndCommit } from '@mygitnotes/git';
import { assertSafeRepoPath, assertUserWorkspaceBranch } from '../guards.js';
import type { ToolContext } from './context.js';

export async function handleGetWorkspaceConfig(ctx: ToolContext) {
  const config = loadWorkspaceConfig(ctx.repoRoot);
  if (!config) {
    return { error: 'No .mygitnotes.yaml (or legacy .github-notes.yaml) configuration file found in workspace.' };
  }
  return { config };
}

export async function handleListNotebooks(ctx: ToolContext) {
  const config = loadWorkspaceConfig(ctx.repoRoot);
  if (!config) {
    return { error: 'Workspace not initialized.' };
  }
  return { notebooks: config.notebooks };
}

export async function handleListNotes(ctx: ToolContext, args: { notebookId?: string; offset?: number; limit?: number; }) {
  const config = loadWorkspaceConfig(ctx.repoRoot);
  if (!config) {
    return { error: 'Workspace not initialized.' };
  }

  const notebooks = args.notebookId ? config.notebooks.filter((nb) => nb.id === args.notebookId) : config.notebooks;
  const offset = args.offset === undefined ? 0 : Number(args.offset);
  const limit = args.limit === undefined ? 100 : Number(args.limit);

  const all: NoteItem[] = [];
  for (const nb of notebooks) {
    all.push(...scanNotebookNotes(ctx.repoRoot, nb).sort((a, b) => a.path.localeCompare(b.path)));
  }

  const notes = all.slice(offset, offset + limit).map(noteSummary);
  const next = offset + notes.length;
  return { count: notes.length, total: all.length, nextOffset: next < all.length ? next : null, notes };
}

export async function handleReadNote(ctx: ToolContext, args: { path: string; notebookId?: string; metadataOnly?: boolean; }) {
  assertSafeRepoPath(ctx.repoRoot, args.path);
  if (args.metadataOnly) {
    return handleGetNoteMetadata(ctx, { path: args.path });
  }
  const notebookId = args.notebookId || 'default';
  const note = readNoteFile(ctx.repoRoot, args.path, notebookId);
  return { note };
}

export async function handleSaveNote(ctx: ToolContext, args: { path: string; content?: string; metadata?: Record<string, unknown>; status?: string; tags?: string[]; title?: string; commitMessage?: string; }) {
  await assertUserWorkspaceBranch(ctx.repoRoot);
  assertSafeRepoPath(ctx.repoRoot, args.path);

  if (args.content === undefined) {
    return handleUpdateNoteMetadata(ctx, args);
  }

  const edited = args.status !== undefined || args.tags !== undefined || args.title !== undefined;
  const finalMetadata = edited ? withNoteEdits(args.metadata ?? {}, args) : args.metadata;

  const saved = writeNoteFile(ctx.repoRoot, args.path, args.content, finalMetadata);

  let message = args.commitMessage;
  if (!message) {
    message = await generateCommitMessage({ filePath: args.path, diff: args.content });
  }

  const commitResult = await stageAndCommit(ctx.repoRoot, [args.path], message);

  return { success: true, path: args.path, note: saved, commit: commitResult };
}

export async function handleDeleteNote(ctx: ToolContext, args: { path: string; commitMessage?: string; }) {
  await assertUserWorkspaceBranch(ctx.repoRoot);
  assertSafeRepoPath(ctx.repoRoot, args.path);

  deleteNoteFile(ctx.repoRoot, args.path);

  const message = args.commitMessage || `docs(notes): delete ${path.basename(args.path)}`;
  const commitResult = await stageAndCommit(ctx.repoRoot, [args.path], message);

  return { success: true, path: args.path, commit: commitResult };
}

export async function handleGetStatuses(ctx: ToolContext, args: { notebookId?: string; } = {}) {
  const config = loadWorkspaceConfig(ctx.repoRoot);
  if (!config) return { error: 'Workspace not configured' };

  const notebooks = args.notebookId ? config.notebooks.filter((nb) => nb.id === args.notebookId) : config.notebooks;

  const result = notebooks.map((nb) => {
    const notes = scanNotebookNotes(ctx.repoRoot, nb);
    const observed = notes.map((n) => n.status);
    const allStatuses = resolveNoteStatuses(nb, observed);
    return { notebookId: nb.id, configuredStatuses: nb.statuses || [...DEFAULT_NOTE_STATUSES], observedStatuses: [...new Set(observed.filter(Boolean) as string[])], allStatuses };
  });

  return { defaultStatuses: [...DEFAULT_NOTE_STATUSES], notebooks: result };
}

/** The notebook owning an existing note, or the not-found tool error. */
function locateNote(ctx: ToolContext, config: WorkspaceConfig, file: string) {
  if (!fs.existsSync(resolveSafePath(ctx.repoRoot, file))) return { error: `Note not found: ${file}` };
  const normalized = file.replace(/\\/g, '/');
  const nb = config.notebooks.find((n) => normalized.startsWith(`${n.root}/`));
  return { nb, notebookId: nb ? nb.id : 'default' };
}

/** Statuses offered for notes of `nb`: its configured ones followed by values observed in its notes. */
function availableStatuses(ctx: ToolContext, nb?: NotebookConfig) {
  return resolveNoteStatuses(nb, nb ? scanNotebookNotes(ctx.repoRoot, nb).map((n) => n.status) : []);
}

export async function handleGetNoteMetadata(ctx: ToolContext, args: { path: string; }) {
  assertSafeRepoPath(ctx.repoRoot, args.path);
  const config = loadWorkspaceConfig(ctx.repoRoot);
  if (!config) return { error: 'Workspace not configured' };

  const located = locateNote(ctx, config, args.path);
  if ('error' in located) return located;
  const { nb, notebookId } = located;
  const note = readNoteFile(ctx.repoRoot, args.path, notebookId);

  return { path: note.path, notebookId, title: note.title, status: note.status, tags: note.tags, metadata: note.metadata, availableStatuses: availableStatuses(ctx, nb) };
}

export async function handleUpdateNoteMetadata(ctx: ToolContext, args: { path: string; metadata?: Record<string, unknown>; status?: string; tags?: string[]; title?: string; commitMessage?: string; }) {
  await assertUserWorkspaceBranch(ctx.repoRoot);
  assertSafeRepoPath(ctx.repoRoot, args.path);

  const config = loadWorkspaceConfig(ctx.repoRoot);
  if (!config) return { error: 'Workspace not configured' };

  const located = locateNote(ctx, config, args.path);
  if ('error' in located) return located;
  const { nb, notebookId } = located;

  const existingNote = readNoteFile(ctx.repoRoot, args.path, notebookId);
  const updatedMetadata = withNoteEdits({ ...existingNote.metadata, ...args.metadata }, args);
  const updatedNote = writeNoteFile(ctx.repoRoot, args.path, existingNote.content, updatedMetadata, notebookId);

  let message = args.commitMessage;
  if (!message) {
    if (args.status !== undefined && args.status !== existingNote.status) {
      message = `chore(metadata): set status to ${args.status} for ${path.basename(args.path)}`;
    } else {
      message = `chore(metadata): update metadata for ${path.basename(args.path)}`;
    }
  }

  const commit = await stageAndCommit(ctx.repoRoot, [args.path], message);

  return { success: true, path: args.path, note: updatedNote, availableStatuses: availableStatuses(ctx, nb), commit };
}
