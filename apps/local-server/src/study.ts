import { Router } from 'express';
import syncFs from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { parse, stringify } from 'yaml';
import { emptyStudyWorkspace, SourceError, STUDY_FILE, STUDY_MAX_BYTES, StudyWorkspaceSchema } from '@mygitnotes/core';
import { applyStageAction, createStudyNote, defaultStudyProgression, findStudyNote, isNotebookContent, parseNoteContent, readNoteFile, readScreenPage, reconcileStudyNote, replaceNoteStatus, resolveSafePath, SCREEN_PAGE_FILE, StudyLaneActionSchema, studyLaneStatuses, undoStudyAction } from '@mygitnotes/core';
import { getCurrentBranch } from '@mygitnotes/git';
import { serializeWorkspaceMutation } from './workspace-mutation.js';
import { homeRepository, workspaceOf } from './request-workspace.js';
import { readBoundedFile, readSnapshotText, revisionOf, writeFileAtomic } from './workspace-files.js';

const readLocal = (root: string) => readBoundedFile(root, STUDY_FILE, STUDY_MAX_BYTES, 'Study data');
function decode(raw: string | null) {
  if (raw !== null && Buffer.byteLength(raw) > STUDY_MAX_BYTES) throw new SourceError('Study data is too large.', 413);
  try {
    return raw === null ? emptyStudyWorkspace() : StudyWorkspaceSchema.parse(parse(raw, { maxAliasCount: 20 }));
  } catch {
    throw new SourceError('Invalid study workspace YAML. Fix the file before saving.', 422);
  }
}
function fail(res: import('express').Response, error: unknown) {
  res.status(error instanceof SourceError ? error.status : 500).json({ error: error instanceof SourceError ? error.message : 'Study data could not be saved. Your draft is preserved.' });
}

export function createStudyRouter(): Router {
  const router = Router();
  router.get('/', async (_req, res) => {
    try {
      const { handle } = workspaceOf(res).home;
      if (handle.kind === 'local') {
        const raw = await readLocal(handle.root);
        return res.json({ study: decode(raw), revision: revisionOf(raw), path: STUDY_FILE, writable: await getCurrentBranch(handle.root) === 'main' });
      }
      const { reader } = handle;
      const snapshot = await reader.getSnapshot();
      const raw = await readSnapshotText(reader, snapshot, STUDY_FILE);
      res.json({ study: decode(raw), revision: snapshot.sha, path: STUDY_FILE, writable: reader.canWrite(snapshot) });
    } catch (error) {
      fail(res, error);
    }
  });
  router.post('/action', async (req, res) => {
    try {
      const validation = StudyLaneActionSchema.safeParse(req.body);
      if (!validation.success) throw new SourceError('Invalid review action.', 400);
      const body = validation.data;
      const { handle, config } = await homeRepository(res);
      const execute = async () => {
        if (handle.kind === 'remote' && !handle.authenticated) throw new SourceError('Sign in with write access.', 403);
        const reader = handle.kind === 'remote' ? handle.reader : undefined;
        const snapshot = await reader?.getSnapshot();
        if (handle.kind === 'local' && await getCurrentBranch(handle.root) !== 'main') throw new SourceError('Switch to main to review cards.', 403);
        const notebook = config.notebooks.find(value => value.id === body.notebookId && body.path.startsWith(`${value.root}/`));
        if (!notebook || !isNotebookContent(body.path.slice(notebook.root.length + 1), notebook) || !/\.(md|markdown|txt)$/i.test(body.path)) throw new SourceError('Path is not a configured note.', 403);
        const root = handle.kind === 'local' ? handle.root : '';
        const read = async (file: string) => reader ? (await reader.readFile(file)).toString('utf8') : readRegular(root, file);
        const rawStudy = reader ? await readSnapshotText(reader, snapshot!, STUDY_FILE) : await readLocal(root);
        if ((snapshot?.sha || revisionOf(rawStudy)) !== body.revision) throw new SourceError('Study data changed. Reload before reviewing.', 409);
        const currentStudy = decode(rawStudy), rawNote = await read(body.path);
        const currentNote = reader ? await reader.note(body.path) : readNoteFile(root, body.path, body.notebookId);
        if (currentNote.content !== body.expected.content || !isDeepStrictEqual(currentNote.metadata, body.expected.metadata)) throw new SourceError('The note changed. Reload before reviewing.', 409);
        let nextStudy, status: string | null;
        if (body.action === 'undo') {
          const event = currentStudy.events.at(-1), note = event && currentStudy.notes.find(note => note.id === event.noteId);
          if (!event?.transition || event.id !== body.eventId || event.transition.laneId !== body.laneId || !note || note.path !== body.path || note.notebookId !== body.notebookId || currentNote.status !== event.transition.toStatus) throw new SourceError('This review can no longer be undone.', 409);
          nextStudy = undoStudyAction(currentStudy);
          status = event.transition.fromStatus;
        } else {
          const screen = readScreenPage(parse(await read(SCREEN_PAGE_FILE), { maxAliasCount: 20 }), config);
          const lane = screen.rows.find(row => row.id === body.laneId);
          if (!lane) throw new SourceError('This lane no longer exists. Reload before reviewing.', 409);
          if (lane.notebookId !== body.notebookId) throw new SourceError('This note is not in the lane notebook.', 403);
          const progression = lane.progression || defaultStudyProgression(studyLaneStatuses(lane, config.notebooks));
          if (!progression) throw new SourceError('Configure learning stages for this lane before reviewing.', 400);
          const stored = findStudyNote(currentStudy, currentNote), resolved = stored ? reconcileStudyNote(stored, currentNote) : createStudyNote(currentNote);
          if (!resolved || resolved.cards.length !== 1 || resolved.cards[0].kind !== 'forward') throw new SourceError('Rebind this card before reviewing.', 409);
          if (body.action !== 'stage-postpone' && !body.rating || body.action === 'stage-postpone' && !body.due) throw new SourceError('A rating or postponement time is required.', 400);
          nextStudy = applyStageAction(currentStudy, resolved, lane.id, currentNote.status, progression, body.action === 'stage-postpone' ? { kind: body.action, due: body.due! } : { kind: body.action, rating: body.rating! });
          status = nextStudy.events.at(-1)!.transition!.toStatus;
        }
        const yaml = stringify(nextStudy, { lineWidth: 0 }), updated = replaceNoteStatus(rawNote, status);
        if (Buffer.byteLength(yaml) > STUDY_MAX_BYTES) throw new SourceError('Study data is too large.', 413);
        const parsed = parseNoteContent(updated, body.path);
        let revision: string;
        if (reader) revision = (await reader.saveStudyTransition(yaml, { path: body.path, content: updated }, body.revision)).revision;
        else {
          replaceStudyAndNote(root, body.path, rawNote, updated, rawStudy, yaml);
          revision = revisionOf(yaml);
        }
        res.json({ study: nextStudy, revision, path: STUDY_FILE, writable: true, note: { ...currentNote, ...parsed, status: status ?? undefined, metadata: parsed.metadata, ...(reader ? { revision } : { mtime: Date.now(), size: Buffer.byteLength(updated) }) } });
      };
      if (handle.kind === 'local') await serializeWorkspaceMutation(handle.root, execute);
      else await execute();
    } catch (error) {
      fail(res, error);
    }
  });
  router.put('/', async (req, res) => {
    try {
      const value = StudyWorkspaceSchema.safeParse(req.body?.study);
      const revision = req.body?.revision;
      if (!value.success || typeof revision !== 'string' || !revision || Object.keys(req.body).some(key => !['study', 'revision'].includes(key))) throw new SourceError('Invalid study workspace configuration.', 400);
      const yaml = stringify(value.data, { lineWidth: 0 });
      if (Buffer.byteLength(yaml) > STUDY_MAX_BYTES) throw new SourceError('Study data is too large.', 413);
      const { handle } = workspaceOf(res).home;
      if (handle.kind === 'local') {
        const { root } = handle;
        return await serializeWorkspaceMutation(root, async () => {
          if (await getCurrentBranch(root) !== 'main') throw new SourceError('Switch to main to save the study workspace.', 403);
          const raw = await readLocal(root);
          if (revisionOf(raw) !== revision) throw new SourceError('The study workspace changed. Reload it before saving your draft.', 409);
          await writeFileAtomic(path.join(root, STUDY_FILE), yaml);
          res.json({ study: value.data, revision: revisionOf(yaml), path: STUDY_FILE, writable: true });
        });
      }
      if (!handle.authenticated) throw new SourceError('Sign in with write access to save the study workspace.', 403);
      const saved = await handle.reader.saveStudyWorkspace(yaml, revision);
      res.json({ study: value.data, revision: saved.revision, path: STUDY_FILE, writable: true });
    } catch (error) {
      fail(res, error);
    }
  });
  return router;
}

function readRegular(root: string, file: string): string {
  const target = resolveSafePath(root, file);
  let cursor = root;
  for (const part of file.split('/')) {
    cursor = path.join(cursor, part);
    if (syncFs.lstatSync(cursor).isSymbolicLink()) throw new SourceError('Study resources must be regular files.', 403);
  }
  const stat = syncFs.lstatSync(target);
  if (!stat.isFile() || stat.size > 5 * 1024 * 1024) throw new SourceError('Study resource is unavailable or too large.', 403);
  return syncFs.readFileSync(target, 'utf8');
}

function replaceStudyAndNote(root: string, file: string, beforeNote: string, afterNote: string, beforeStudy: string | null, afterStudy: string) {
  const note = resolveSafePath(root, file), study = path.join(root, STUDY_FILE), suffix = `.${randomUUID()}.tmp`;
  const files = [note + suffix, study + suffix, note + suffix + '.backup'];
  let noteChanged = false, preserveBackup = false;
  try {
    syncFs.writeFileSync(files[0], afterNote, { flag: 'wx', mode: syncFs.statSync(note).mode });
    syncFs.writeFileSync(files[1], afterStudy, { flag: 'wx', mode: 0o600 });
    syncFs.writeFileSync(files[2], beforeNote, { flag: 'wx', mode: syncFs.statSync(note).mode });
    const currentStudy = syncFs.existsSync(study) ? readRegular(root, STUDY_FILE) : null;
    if (readRegular(root, file) !== beforeNote || currentStudy !== beforeStudy) throw new SourceError('The workspace changed. Reload before reviewing.', 409);
    syncFs.renameSync(files[0], note);
    noteChanged = true;
    syncFs.renameSync(files[1], study);
  } catch (error) {
    if (noteChanged) {
      try {
        syncFs.renameSync(files[2], note);
      } catch {
        preserveBackup = true;
        throw new SourceError('The review failed and note recovery needs attention. The original note is preserved in the adjacent .backup file.', 500);
      }
    }
    throw error;
  } finally {
    for (const temporary of preserveBackup ? files.slice(0, 2) : files) syncFs.rmSync(temporary, { force: true });
  }
}
