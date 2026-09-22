import path from 'node:path';
import fs from 'node:fs';
import { DEFAULT_NOTE_STATUSES, deleteNoteFile, loadWorkspaceConfig, NoteItem, NoteMetadata, noteSummary, readNoteFile, resolveNoteStatuses, resolveSafePath, scanNotebookNotes, withNoteStatus, writeNoteFile } from '@mygitnotes/core';
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

  let finalMetadata = args.metadata;
  if (args.status !== undefined || args.tags !== undefined || args.title !== undefined) {
    finalMetadata = { ...finalMetadata };
    if (args.status !== undefined) finalMetadata = withNoteStatus(finalMetadata, args.status);
    if (args.tags !== undefined) finalMetadata.tags = args.tags;
    if (args.title !== undefined) finalMetadata.title = args.title;
  }

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

export async function handleGetNoteMetadata(ctx: ToolContext, args: { path: string; }) {
  assertSafeRepoPath(ctx.repoRoot, args.path);
  const config = loadWorkspaceConfig(ctx.repoRoot);
  if (!config) return { error: 'Workspace not configured' };

  const safePath = resolveSafePath(ctx.repoRoot, args.path);
  if (!fs.existsSync(safePath)) {
    return { error: `Note not found: ${args.path}` };
  }

  const normalized = args.path.replace(/\\/g, '/');
  const nb = config.notebooks.find((n) => normalized.startsWith(`${n.root}/`));
  const notebookId = nb ? nb.id : 'default';

  const note = readNoteFile(ctx.repoRoot, args.path, notebookId);
  const observedStatuses = nb ? scanNotebookNotes(ctx.repoRoot, nb).map((n) => n.status) : [];
  const availableStatuses = resolveNoteStatuses(nb, observedStatuses);

  return { path: note.path, notebookId, title: note.title, status: note.status, tags: note.tags, metadata: note.metadata, availableStatuses };
}

export async function handleUpdateNoteMetadata(ctx: ToolContext, args: { path: string; metadata?: Record<string, unknown>; status?: string; tags?: string[]; title?: string; commitMessage?: string; }) {
  await assertUserWorkspaceBranch(ctx.repoRoot);
  assertSafeRepoPath(ctx.repoRoot, args.path);

  const config = loadWorkspaceConfig(ctx.repoRoot);
  if (!config) return { error: 'Workspace not configured' };

  const safePath = resolveSafePath(ctx.repoRoot, args.path);
  if (!fs.existsSync(safePath)) {
    return { error: `Note not found: ${args.path}` };
  }

  const normalized = args.path.replace(/\\/g, '/');
  const nb = config.notebooks.find((n) => normalized.startsWith(`${n.root}/`));
  const notebookId = nb ? nb.id : 'default';

  const existingNote = readNoteFile(ctx.repoRoot, args.path, notebookId);
  let updatedMetadata: NoteMetadata = { ...existingNote.metadata, ...args.metadata };

  if (args.status !== undefined) {
    updatedMetadata = withNoteStatus(updatedMetadata, args.status);
  }
  if (args.tags !== undefined) {
    updatedMetadata.tags = args.tags;
  }
  if (args.title !== undefined) {
    updatedMetadata.title = args.title;
  }

  const updatedNote = writeNoteFile(ctx.repoRoot, args.path, existingNote.content, updatedMetadata, notebookId);

  const observedStatuses = nb ? scanNotebookNotes(ctx.repoRoot, nb).map((n) => n.status) : [];
  const availableStatuses = resolveNoteStatuses(nb, observedStatuses);

  let message = args.commitMessage;
  if (!message) {
    if (args.status !== undefined && args.status !== existingNote.status) {
      message = `chore(metadata): set status to ${args.status} for ${path.basename(args.path)}`;
    } else {
      message = `chore(metadata): update metadata for ${path.basename(args.path)}`;
    }
  }

  const commit = await stageAndCommit(ctx.repoRoot, [args.path], message);

  return { success: true, path: args.path, note: updatedNote, availableStatuses, commit };
}
