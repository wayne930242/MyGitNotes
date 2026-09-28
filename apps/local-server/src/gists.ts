import path from 'node:path';
import { type Response, Router } from 'express';
import { SourceError } from '@mygitnotes/core';
import { requestToken, workspaceOf } from './request-workspace.js';

/** A Gist request refused because the sign-in grant lacks the `gist` scope; signing in again grants it. */
export class GistAuthorizationError extends SourceError {
  constructor() {
    super('GitHub has not granted Gist access. Sign in again to publish Gists.', 403);
  }
}

/** The outcome of pushing one committed note to the Gist its `gist` frontmatter names. */
export interface GistSync {
  path: string;
  gist: string;
  error?: string;
  reauthorize?: boolean;
}

/** A published note as a commit or save carries it: the body without frontmatter, and its metadata. */
export interface PublishedNote {
  path: string;
  content: string;
  metadata: Record<string, unknown>;
}

const GIST_ID = /^[A-Za-z0-9]{1,64}$/;

/** The Gist id a note's frontmatter names, when it names a well-formed one. */
export function noteGist(metadata: Record<string, unknown> | undefined): string | undefined {
  const id = metadata?.gist;
  return typeof id === 'string' && GIST_ID.test(id) ? id : undefined;
}

async function gistRequest(token: string, endpoint: string, init: RequestInit = {}): Promise<globalThis.Response> {
  const response = await fetch(`https://api.github.com/gists${endpoint}`, { ...init, redirect: 'error', signal: AbortSignal.timeout(15000), headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'MyGitNotes', Authorization: `Bearer ${token}`, ...(init.body ? { 'Content-Type': 'application/json' } : {}) } });
  if (response.ok || response.status === 404 && init.method === 'DELETE') return response;
  // OAuth app tokens list their scopes; one without `gist` is answered 404 or 403 rather than with a scope error.
  const scopes = response.headers.get('x-oauth-scopes');
  if (scopes !== null && !scopes.split(',').map(scope => scope.trim()).includes('gist')) throw new GistAuthorizationError();
  const message = await response.json().then(body => (body as { message?: unknown; }).message, () => undefined);
  throw new SourceError(`GitHub Gist request failed (${response.status})${typeof message === 'string' ? `: ${message}` : ''}.`, response.status === 404 ? 404 : 502);
}

function gistFile(note: { path: string; content: string; }) {
  if (!note.content.trim()) throw new SourceError('An empty note cannot be published as a Gist.');
  return { filename: path.posix.basename(note.path), content: note.content };
}

function gistDescription(note: PublishedNote) {
  return typeof note.metadata.title === 'string' && note.metadata.title.trim() ? note.metadata.title.trim() : path.posix.basename(note.path);
}

/** Creates a secret Gist holding the note's body. */
export async function createGist(token: string, note: PublishedNote): Promise<{ id: string; url: string; }> {
  const file = gistFile(note);
  const response = await gistRequest(token, '', { method: 'POST', body: JSON.stringify({ description: gistDescription(note), public: false, files: { [file.filename]: { content: file.content } } }) });
  const body = await response.json() as { id?: unknown; html_url?: unknown; };
  if (typeof body.id !== 'string' || typeof body.html_url !== 'string') throw new SourceError('GitHub returned an invalid Gist.', 502);
  return { id: body.id, url: body.html_url };
}

/** Deletes a Gist; one that is already gone counts as deleted. */
export async function deleteGist(token: string, id: string): Promise<void> {
  if (!GIST_ID.test(id)) throw new SourceError('Invalid Gist id.');
  await gistRequest(token, `/${id}`, { method: 'DELETE' });
}

/** Replaces the Gist's single file with the note's body, renaming the file when the note moved. */
async function updateGist(token: string, id: string, note: PublishedNote): Promise<void> {
  const file = gistFile(note);
  const current = await (await gistRequest(token, `/${id}`)).json() as { files?: Record<string, unknown>; };
  const [existing] = Object.keys(current.files || {});
  await gistRequest(token, `/${id}`, { method: 'PATCH', body: JSON.stringify({ description: gistDescription(note), files: { [existing || file.filename]: file } }) });
}

/** Pushes each note that names a Gist to that Gist, one at a time; a failure is reported for its note and never undoes the commit. */
export async function syncGists(token: string, notes: PublishedNote[]): Promise<GistSync[]> {
  const results: GistSync[] = [];
  for (const note of notes) {
    const gist = noteGist(note.metadata);
    if (!gist) continue;
    try {
      await updateGist(token, gist, note);
      results.push({ path: note.path, gist });
    } catch (error) {
      results.push({ path: note.path, gist, error: error instanceof Error ? error.message : 'Gist update failed.', ...(error instanceof GistAuthorizationError ? { reauthorize: true } : {}) });
    }
  }
  return results;
}

/** The signed-in GitHub token of a request whose home repository is on GitHub, or undefined for any other request. */
export function gistToken(res: Response): string | undefined {
  return workspaceOf(res).home.ref.source.type === 'github' ? requestToken(res) : undefined;
}

/** Publishes note bodies as secret Gists of the signed-in GitHub account, and deletes them again. */
export function createGistRouter(): Router {
  const router = Router();
  const token = (res: Response) => {
    if (workspaceOf(res).home.ref.source.type !== 'github') throw new SourceError('Gists require a GitHub workspace.');
    const value = requestToken(res);
    if (!value) throw new SourceError('Sign in with GitHub to publish Gists.', 401);
    return value;
  };
  const fail = (res: Response, error: unknown) => res.status(error instanceof SourceError ? error.status : 500).json({ error: error instanceof Error ? error.message : 'Gist request failed.', ...(error instanceof GistAuthorizationError ? { reauthorize: true } : {}) });
  router.post('/api/gists', async (req, res) => {
    try {
      const { path: file, content, metadata } = req.body ?? {};
      if (typeof file !== 'string' || !file || typeof content !== 'string') throw new SourceError('path and content are required.');
      res.json(await createGist(token(res), { path: file, content, metadata: metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? metadata : {} }));
    } catch (error) {
      fail(res, error);
    }
  });
  router.delete('/api/gists/:id', async (req, res) => {
    try {
      await deleteGist(token(res), req.params.id);
      res.json({ success: true });
    } catch (error) {
      fail(res, error);
    }
  });
  return router;
}
