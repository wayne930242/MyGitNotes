import { Router } from 'express';
import fs from 'node:fs/promises';
import syncFs from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { parse, stringify } from 'yaml';
import { emptyStudyWorkspace, StudyWorkspaceSchema, STUDY_FILE, STUDY_MAX_BYTES, createRemoteSource, SourceError, type SourceConfig } from '@github-notes/core';
import { defaultStudyProgression, studyLaneStatuses, StudyLaneActionSchema, loadWorkspaceConfig, resolveSafePath, isNotebookContent, readNoteFile, parseNoteContent, replaceNoteStatus, ScreenPageSchema, SCREEN_PAGE_FILE, createStudyNote, findStudyNote, reconcileStudyNote, applyStageAction, undoStudyAction } from '@github-notes/core';
import { getCurrentBranch } from '@github-notes/git';
import { serializeWorkspaceMutation } from './workspace-mutation.js';
import { authToken } from './auth.js';

const revisionOf = (text: string | null) => text === null ? 'missing' : createHash('sha256').update(text).digest('hex');
async function readLocal(root: string) {
  const file = path.join(root, STUDY_FILE);
  try {
    const stat = await fs.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new SourceError('Study data must be a regular file.', 403);
    if (stat.size > STUDY_MAX_BYTES) throw new SourceError('Study data is too large.', 413);
    return await fs.readFile(file, 'utf8');
  } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
}
function decode(raw: string | null) {
  if (raw !== null && Buffer.byteLength(raw) > STUDY_MAX_BYTES) throw new SourceError('Study data is too large.', 413);
  try { return raw === null ? emptyStudyWorkspace() : StudyWorkspaceSchema.parse(parse(raw, { maxAliasCount: 20 })); }
  catch { throw new SourceError('Invalid study workspace YAML. Fix the file before saving.', 422); }
}
function fail(res: import('express').Response, error: unknown) {
  res.status(error instanceof SourceError ? error.status : 500).json({ error: error instanceof SourceError ? error.message : 'Study data could not be saved. Your draft is preserved.' });
}

export function createStudyRouter(base: string, source: SourceConfig): Router {
  const router = Router();
  router.get('/', async (req, res) => {
    try {
      if (source.type === 'local') {
        const raw = await readLocal(source.path);
        return res.json({ study: decode(raw), revision: revisionOf(raw), path: STUDY_FILE, writable: await getCurrentBranch(source.path) === 'main' });
      }
      const token = await authToken(req, base);
      const reader = createRemoteSource(source, token);
      const snapshot = await reader.getSnapshot();
      const exists = snapshot.entries.some(entry => entry.path === STUDY_FILE);
      const raw = exists ? (await reader.readFile(STUDY_FILE)).toString('utf8') : null;
      res.json({ study: decode(raw), revision: snapshot.sha, path: STUDY_FILE, writable: Boolean(token && snapshot.info.permissions?.push && source.branch === 'main') });
    } catch (error) { fail(res, error); }
  });
  router.post('/action', async (req, res) => {
    try {
      const validation = StudyLaneActionSchema.safeParse(req.body);
      if (!validation.success) throw new SourceError('Invalid review action.', 400);
      const body = validation.data;
      const execute = async () => {
        const token = source.type !== 'local' ? await authToken(req, base) : undefined;
        if (source.type !== 'local' && !token) throw new SourceError('Sign in with write access.', 403);
        const reader = source.type !== 'local' ? createRemoteSource(source, token!) : undefined;
        const snapshot = await reader?.getSnapshot();
        if (source.type === 'local' && await getCurrentBranch(source.path) !== 'main') throw new SourceError('Switch to main to review cards.', 403);
        const config = reader ? await reader.config() : loadWorkspaceConfig(source.type === 'local' ? source.path : '');
        const notebook = config?.notebooks.find(value => value.id === body.notebookId && body.path.startsWith(`${value.root}/`));
        if (!notebook || !isNotebookContent(body.path.slice(notebook.root.length + 1), notebook) || !/\.(md|markdown|txt)$/i.test(body.path)) throw new SourceError('Path is not a configured note.', 403);
        const root = source.type === 'local' ? source.path : '';
        const read = async (file: string) => reader ? (await reader.readFile(file)).toString('utf8') : readRegular(root, file);
        const rawStudy = reader ? snapshot!.entries.some(entry => entry.path === STUDY_FILE) ? await read(STUDY_FILE) : null : await readLocal(root);
        if ((snapshot?.sha || revisionOf(rawStudy)) !== body.revision) throw new SourceError('Study data changed. Reload before reviewing.', 409);
        const currentStudy = decode(rawStudy), rawNote = await read(body.path);
        const currentNote = reader ? await reader.note(body.path) : readNoteFile(root, body.path, body.notebookId);
        if (currentNote.content !== body.expected.content || !isDeepStrictEqual(currentNote.metadata, body.expected.metadata)) throw new SourceError('The note changed. Reload before reviewing.', 409);
        let nextStudy, status: string | null;
        if (body.action === 'undo') {
          const event = currentStudy.events.at(-1), note = event && currentStudy.notes.find(note => note.id === event.noteId);
          if (!event?.transition || event.id !== body.eventId || event.transition.laneId !== body.laneId || !note || note.path !== body.path || note.notebookId !== body.notebookId || currentNote.status !== event.transition.toStatus) throw new SourceError('This review can no longer be undone.', 409);
          nextStudy = undoStudyAction(currentStudy); status = event.transition.fromStatus;
        } else {
          const screen = ScreenPageSchema.parse(parse(await read(SCREEN_PAGE_FILE), { maxAliasCount: 20 }));
          const lane = screen.rows.find(row => row.id === body.laneId);
          if (!lane) throw new SourceError('This lane no longer exists. Reload before reviewing.', 409);
          const progression = lane.progression || defaultStudyProgression(studyLaneStatuses(lane, config!.notebooks));
          if (!progression) throw new SourceError('Configure learning stages for this lane before reviewing.', 400);
          const stored = findStudyNote(currentStudy, currentNote), resolved = stored ? reconcileStudyNote(stored, currentNote) : createStudyNote(currentNote);
          if (!resolved || resolved.cards.length !== 1 || resolved.cards[0].kind !== 'forward') throw new SourceError('Rebind this card before reviewing.', 409);
          if (body.action !== 'stage-postpone' && !body.rating || body.action === 'stage-postpone' && !body.due) throw new SourceError('A rating or postponement time is required.', 400);
          nextStudy = applyStageAction(currentStudy, resolved, lane.id, currentNote.status, progression,
            body.action === 'stage-postpone' ? { kind: body.action, due: body.due! } : { kind: body.action, rating: body.rating! });
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
        res.json({ study: nextStudy, revision, path: STUDY_FILE, writable: true, note: { ...currentNote, ...parsed, status: status ?? undefined,
          metadata: parsed.metadata, ...(reader ? { revision } : { mtime: Date.now(), size: Buffer.byteLength(updated) }) } });
      };
      if (source.type === 'local') await serializeWorkspaceMutation(source.path, execute); else await execute();
    } catch (error) { fail(res, error); }
  });
  router.put('/', async (req, res) => {
    try {
      const value = StudyWorkspaceSchema.safeParse(req.body?.study);
      const revision = req.body?.revision;
      if (!value.success || typeof revision !== 'string' || !revision || Object.keys(req.body).some(key => !['study', 'revision'].includes(key))) throw new SourceError('Invalid study workspace configuration.', 400);
      const yaml = stringify(value.data, { lineWidth: 0 });
      if (Buffer.byteLength(yaml) > STUDY_MAX_BYTES) throw new SourceError('Study data is too large.', 413);
      if (source.type === 'local') {
        return await serializeWorkspaceMutation(source.path, async () => {
          if (await getCurrentBranch(source.path) !== 'main') throw new SourceError('Switch to main to save the study workspace.', 403);
          const raw = await readLocal(source.path);
          if (revisionOf(raw) !== revision) throw new SourceError('The study workspace changed. Reload it before saving your draft.', 409);
          const target = path.join(source.path, STUDY_FILE);
          const temporary = `${target}.${randomUUID()}.tmp`;
          try { await fs.writeFile(temporary, yaml, { flag: 'wx', mode: 0o600 }); await fs.rename(temporary, target); }
          finally { await fs.rm(temporary, { force: true }); }
          res.json({ study: value.data, revision: revisionOf(yaml), path: STUDY_FILE, writable: true });
        });
      }
      const token = await authToken(req, base);
      if (!token) throw new SourceError('Sign in with write access to save the study workspace.', 403);
      const reader = createRemoteSource(source, token);
      const saved = await reader.saveStudyWorkspace(yaml, revision);
      res.json({ study: value.data, revision: saved.revision, path: STUDY_FILE, writable: true });
    } catch (error) { fail(res, error); }
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
    syncFs.renameSync(files[0], note); noteChanged = true;
    syncFs.renameSync(files[1], study);
  } catch (error) {
    if (noteChanged) {
      try { syncFs.renameSync(files[2], note); }
      catch { preserveBackup = true; throw new SourceError('The review failed and note recovery needs attention. The original note is preserved in the adjacent .backup file.', 500); }
    }
    throw error;
  } finally { for (const temporary of preserveBackup ? files.slice(0, 2) : files) syncFs.rmSync(temporary, { force: true }); }
}
