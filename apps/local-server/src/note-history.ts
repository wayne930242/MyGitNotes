import { type NextFunction, type Request, type Response, Router } from 'express';
import path from 'node:path';
import { addVersion, historyFile, type HistoryRead, type NoteVersionFile, onRemoteCommit, readVersionFile, relabelVersion, removeVersion, serializeVersionFile, SourceError, utcDay, versionFilePath, type VersionLabel, VersionLabelSchema } from '@mygitnotes/core';
import { commitDetails, commitVersionChange, fileHistory, getCurrentBranch, readFileAt, readHistoryBlob } from '@mygitnotes/git';
import { notebookRepository, type RepositoryHandle, repositoryOrHome, workspaceOf } from './request-workspace.js';
import { openEventStream } from './event-stream.js';
import { readBoundedFile, readSnapshotText, regularPath } from './workspace-files.js';
import { watchWorktrees } from './worktree-watch.js';

const PER_PAGE = 50;
const OBJECT_ID = /^[a-f0-9]{40}([a-f0-9]{24})?$/;

/** The repository of a file a request names: through its notebook for a note, else the named or home repository. */
async function fileRepository(res: Response, query: Record<string, unknown>) {
  const file = query.path;
  if (typeof file !== 'string' || !file) throw new SourceError('path is required.');
  let resolved: { id?: string; handle: RepositoryHandle; notebooks: Parameters<typeof historyFile>[1]; };
  if (query.notebookId !== undefined && query.notebookId !== '') {
    const { handle, config, notebook } = await notebookRepository(res, query.notebookId);
    if (!file.startsWith(`${notebook.root}/`)) throw new SourceError('Path is not in the named notebook.', 403);
    resolved = { id: handle.id, handle, notebooks: config.notebooks };
  } else {
    const { id, handle, config } = await repositoryOrHome(res, query.repository);
    resolved = { id, handle, notebooks: config.notebooks };
  }
  if (!historyFile(file, resolved.notebooks)) throw new SourceError('This file has no history in the app.', 403);
  if (resolved.handle.kind === 'local') regularPath(resolved.handle.root, file);
  return { file, ...resolved };
}

/** A file's versions as the workspace holds them now: the worktree locally, the branch head remotely. */
async function readVersions(handle: RepositoryHandle, file: string): Promise<NoteVersionFile> {
  const versionFile = versionFilePath(file);
  let raw: string | null;
  if (handle.kind === 'local') {
    regularPath(handle.root, versionFile);
    raw = await readBoundedFile(handle.root, versionFile, 1024 * 1024, 'Version file');
  } else {
    raw = await readSnapshotText(handle.reader, await handle.reader.getSnapshot(), versionFile);
  }
  try {
    return readVersionFile(raw);
  } catch {
    throw new SourceError(`The version file ${versionFile} cannot be read. Fix or remove it.`, 422);
  }
}

async function writable(handle: RepositoryHandle) {
  if (handle.kind === 'local') return await getCurrentBranch(handle.root) === 'main';
  return handle.authenticated && handle.reader.canWrite(await handle.reader.getSnapshot());
}

/** The person's day for a date number, trusted only within a day of the server's. */
function personDay(value: unknown): string {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Math.abs(Date.parse(`${value}T12:00:00Z`) - Date.now()) <= 36 * 60 * 60 * 1000) return value;
  return utcDay();
}

type VersionAction = { action: 'create'; commit: string; at?: string; include: string[]; name?: string; note?: string; today?: unknown; } | { action: 'update'; sequence: number; name?: string; note?: string; } | { action: 'delete'; sequence: number; };

function parseAction(body: Record<string, unknown>): VersionAction {
  const text = (key: string) => {
    const value = body[key];
    if (value !== undefined && typeof value !== 'string') throw new SourceError(`${key} must be text.`);
    return value as string | undefined;
  };
  const sequence = () => {
    if (!Number.isInteger(body.sequence) || Number(body.sequence) < 1) throw new SourceError('sequence is required.');
    return Number(body.sequence);
  };
  if (body.action === 'create') {
    const commit = text('commit');
    if (!commit || !OBJECT_ID.test(commit)) throw new SourceError('commit is required.');
    const include = body.include ?? [];
    if (!Array.isArray(include) || include.length > 50 || include.some(file => typeof file !== 'string')) throw new SourceError('include must list file paths.');
    return { action: 'create', commit, at: text('at'), include: include as string[], name: text('name'), note: text('note'), today: body.today };
  }
  if (body.action === 'update') return { action: 'update', sequence: sequence(), name: text('name'), note: text('note') };
  if (body.action === 'delete') return { action: 'delete', sequence: sequence() };
  throw new SourceError('Unknown version action.');
}

/** The version a quick note commit records with the note, as the request names it; undefined without one. */
export function newVersion(value: unknown): { path: string; label: VersionLabel; today: string; } | undefined {
  if (value === undefined || value === null) return;
  const body = value as Record<string, unknown>;
  if (typeof body !== 'object' || typeof body.path !== 'string' || !body.path) throw new SourceError('A new version names its note.');
  const label = VersionLabelSchema.safeParse({ name: body.name, note: body.note });
  if (!label.success) throw new SourceError('A version name is one line of at most 80 characters, and a version note at most 2,000 characters.');
  return { path: body.path, label: label.data, today: personDay(body.today) };
}

function fail(res: Response, error: unknown) {
  res.status(error instanceof SourceError ? error.status : 500).json({ error: error instanceof Error ? error.message : 'Request failed.' });
}

/**
 * A serverless function ends within a minute and hears only its own commits, so there the history stream answers 204,
 * before the workspace is read, which tells the browser not to reconnect; panels then read again after the app's own saves.
 */
export function serverlessHistoryEvents(_req: Request, res: Response, next: NextFunction) {
  if (!process.env.VERCEL) return next();
  res.status(204).end();
}

/**
 * Commits in the workspace's repositories, as server-sent `history` events, so open history panels read again.
 * A local worktree reports every commit, whoever made it; a remote repository reports the commits this server publishes
 * for any request, which includes the app's saves, versions and remote MCP edits, with the paths they changed.
 */
async function streamHistoryChanges(_req: Request, res: Response) {
  await openEventStream(res, async () => (await workspaceOf(res).all()).flatMap(entry => 'handle' in entry ? [entry.handle] : []), error => fail(res, error), (repositories, write) => {
    const send = (change: { repositories: string[]; paths?: string[]; }) => write(`event: history\ndata: ${JSON.stringify(change)}\n\n`);
    const local = repositories.flatMap(handle => handle.kind === 'local' ? [{ id: handle.id, root: handle.root }] : []);
    const remote = new Set(repositories.flatMap(handle => handle.kind === 'remote' ? [handle.reader.id] : []));
    const stops = [local.length ? watchWorktrees(local, ids => send({ repositories: ids }), 'commits') : () => {}, remote.size ? onRemoteCommit((repository, paths) => remote.has(repository) && send({ repositories: [repository], paths })) : () => {}];
    return () => {
      for (const stop of stops) stop();
    };
  });
}

/** History of notes and agent files, and the versions people record for them, in local and remote workspaces. */
export function createNoteHistoryRouter(): Router {
  const router = Router();

  router.get('/api/history/events', streamHistoryChanges);

  router.get('/api/history', async (req, res) => {
    try {
      const { file, id, handle } = await fileRepository(res, req.query);
      const page = Math.max(1, Math.min(10000, Number(req.query.page) || 1));
      const listed = handle.kind === 'local' ? await fileHistory(handle.root, file, page, PER_PAGE) : await handle.reader.fileHistory(file, page, PER_PAGE);
      res.json({ path: file, repository: id, ...listed, versions: (await readVersions(handle, file)).versions, writable: await writable(handle) });
    } catch (error) {
      fail(res, error);
    }
  });

  // `at` is the file's path in that commit, which differs before a move; a blob is readable only when a version of the file names it.
  router.get('/api/history/file', async (req, res) => {
    try {
      const { file, handle, notebooks } = await fileRepository(res, req.query);
      let read: HistoryRead | undefined;
      if (typeof req.query.blob === 'string') {
        const blob = req.query.blob;
        if (!(await readVersions(handle, file)).versions.some(version => version.blob === blob)) throw new SourceError('This content is not a version of the file.', 403);
        read = handle.kind === 'local' ? await readHistoryBlob(handle.root, blob) : await handle.reader.readHistoryBlob(blob);
      } else {
        const commit = String(req.query.commit || '');
        const at = typeof req.query.at === 'string' && req.query.at ? req.query.at : file;
        if (!OBJECT_ID.test(commit)) throw new SourceError('commit is required.');
        if (at !== file && !historyFile(at, notebooks)) throw new SourceError('This file has no history in the app.', 403);
        read = handle.kind === 'local' ? await readFileAt(handle.root, commit, at) : await handle.reader.readFileAt(commit, at);
      }
      if (!read) throw new SourceError('This version of the file is not available.', 404);
      res.json(read);
    } catch (error) {
      fail(res, error);
    }
  });

  // The other files a commit changed that can be versions too, offered when a version is recorded on it.
  router.get('/api/history/commit', async (req, res) => {
    try {
      const { file, handle, notebooks } = await fileRepository(res, req.query);
      const commit = String(req.query.commit || '');
      if (!OBJECT_ID.test(commit)) throw new SourceError('commit is required.');
      const details = handle.kind === 'local' ? await commitDetails(handle.root, commit) : await handle.reader.commitDetails(commit);
      if (!details) throw new SourceError('This commit is not available.', 404);
      res.json({ commit, date: details.date, files: details.paths.filter(other => other !== file && historyFile(other, notebooks)) });
    } catch (error) {
      fail(res, error);
    }
  });

  router.post('/api/versions', async (req, res) => {
    try {
      const { file, id, handle, notebooks } = await fileRepository(res, req.body ?? {});
      const action = parseAction(req.body);
      if (!await writable(handle)) throw new SourceError(handle.kind === 'local' ? 'Switch to main to record versions.' : 'Sign in with write access to record versions.', 403);
      const parsedLabel = action.action === 'delete' ? undefined : VersionLabelSchema.safeParse({ name: action.name, note: action.note });
      if (parsedLabel && !parsedLabel.success) throw new SourceError('A version name is one line of at most 80 characters, and a version note at most 2,000 characters.');
      const label = parsedLabel?.data ?? {};
      const name = path.posix.basename(file);
      let files = [file];
      let message: string;
      let change: (records: Map<string, NoteVersionFile>) => void;
      if (action.action === 'create') {
        const at = action.at || file;
        if (at !== file && !historyFile(at, notebooks)) throw new SourceError('This file has no history in the app.', 403);
        const details = handle.kind === 'local' ? await commitDetails(handle.root, action.commit) : await handle.reader.commitDetails(action.commit);
        if (!details) throw new SourceError('This commit is not available.', 404);
        const include = [...new Set(action.include.filter(other => other !== file))];
        if (include.some(other => !details.paths.includes(other) || !historyFile(other, notebooks))) throw new SourceError('Only files this commit changed can join the version.', 400);
        files = [file, ...include];
        const targets = new Map<string, string>();
        for (const [target, read] of [[file, at], ...include.map(other => [other, other])]) {
          const found = handle.kind === 'local' ? await readFileAt(handle.root, action.commit, read) : await handle.reader.readFileAt(action.commit, read);
          if (!found) throw new SourceError(`${read} is not in this commit.`, 404);
          targets.set(target, found.blob);
        }
        const today = personDay(action.today);
        change = records => {
          for (const [target, blob] of targets) addVersion(records.get(target)!, { blob, commit: action.commit, authored: details.date }, label, today);
        };
        message = files.length === 1 ? `docs(versions): record a version of ${name}` : `docs(versions): record a version of ${files.length} files`;
      } else if (action.action === 'update') {
        change = records => void relabelVersion(records.get(file)!, action.sequence, label);
        message = `docs(versions): rename version ${action.sequence} of ${name}`;
      } else {
        change = records => removeVersion(records.get(file)!, action.sequence);
        message = `docs(versions): delete version ${action.sequence} of ${name}`;
      }
      try {
        if (handle.kind === 'local') {
          regularPath(handle.root, versionFilePath(file));
          await commitVersionChange(handle.root, files, change, message);
        } else {
          const { reader } = handle;
          const snapshot = await reader.getSnapshot(true);
          const records = new Map<string, NoteVersionFile>();
          for (const target of files) records.set(target, readVersionFile(await readSnapshotText(reader, snapshot, versionFilePath(target))));
          change(records);
          const changes = [...records].map(([target, record]) => record.versions.length ? { path: versionFilePath(target), content: serializeVersionFile(record) } : snapshot.entries.some(entry => entry.path === versionFilePath(target)) ? { path: versionFilePath(target), sha: null } : undefined).filter(entry => entry !== undefined);
          if (changes.length) await reader.commitChanges(changes, snapshot.sha, 'save', 'versions', message, snapshot);
        }
      } catch (error) {
        throw error instanceof SourceError ? error : new SourceError((error as Error).message, 409);
      }
      res.json({ path: file, repository: id, versions: (await readVersions(handle, file)).versions });
    } catch (error) {
      fail(res, error);
    }
  });

  return router;
}
