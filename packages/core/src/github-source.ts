import path from 'node:path';
import { assetInfo, assetRoot, assetPath, isAssetPath, decodeAsset } from './assets.js';
import { parseWorkspaceConfig } from './config.js';
import { parseNoteContent, serializeNoteContent } from './frontmatter.js';
import { isNotebookContent, parseFolderConfig, sortFolders } from './folders.js';
import { WorkspaceConfig, NotebookConfig, NoteItem, FolderItem, NoteMetadata } from './types.js';
import { GitHubApi, SourceError } from './github-api.js';
import { readGitHubArchive } from './github-archive.js';
import { workspaceAgentKind } from './workspace-agent.js';
import { SCREEN_PAGE_FILE, ScreenPageSchema } from './screen-page.js';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';

export { SourceError } from './github-api.js';
export interface GitHubEntry { path: string; type: string; mode: string; sha: string; size?: number }
export interface RepositoryInfo { private: boolean; permissions?: { push?: boolean }; default_branch: string }

/** A request-scoped reader pins all files to a single commit. Credentials never enter browser responses. */
export class GitHubSource {
  private snapshot?: Promise<{ sha: string; treeSha: string; entries: GitHubEntry[]; info: RepositoryInfo }>;
  private manifest?: Promise<WorkspaceConfig>;
  private client: GitHubApi;
  private fresh = false;
  constructor(public repository: string, public branch: string, private token?: string, private request: typeof fetch = fetch) {
    this.client = new GitHubApi(repository, token, request);
  }

  async api(endpoint: string, init: RequestInit = {}): Promise<any> {
    return this.client.json(endpoint, init, this.fresh && (endpoint === '' || endpoint.startsWith('/commits/')));
  }

  async getSnapshot(fresh = false) {
    if (fresh && !this.fresh) { this.snapshot = undefined; this.manifest = undefined; this.fresh = true; }
    this.snapshot ??= (async () => {
      const info: RepositoryInfo = await this.api('');
      if (info.private && !this.token) throw new SourceError('Sign in to read this private repository.', 401);
      const commit = await this.api(`/commits/${encodeURIComponent(this.branch)}`);
      const treeSha: string = commit.commit.tree.sha;
      const result = await this.api(`/git/trees/${treeSha}?recursive=1`);
      let entries: GitHubEntry[] = result.tree;
      if (result.truncated) {
        entries = [];
        const pending = [{ sha: treeSha, prefix: '' }];
        while (pending.length) {
          const next = pending.shift()!;
          const tree = await this.api(`/git/trees/${next.sha}`);
          if (tree.truncated) throw new SourceError('Repository directory is too large to list completely.', 422);
          for (const entry of tree.tree as GitHubEntry[]) {
            const full = { ...entry, path: `${next.prefix}${entry.path}` };
            entries.push(full);
            if (entry.type === 'tree') pending.push({ sha: entry.sha, prefix: `${full.path}/` });
          }
          if (entries.length > 100000) throw new SourceError('Repository exceeds the supported file listing size.', 422);
        }
      }
      return { sha: commit.sha as string, treeSha, entries, info };
    })();
    return this.snapshot;
  }

  async prefetchFiles(files: string[]) {
    const snapshot = await this.getSnapshot();
    const wanted = new Set(files);
    const missing = snapshot.entries.filter(entry => wanted.has(entry.path) && entry.type === 'blob' && entry.mode !== '120000' &&
      (entry.size || 0) <= 5 * 1024 * 1024 && !this.client.hasBlob(entry.sha));
    if (missing.length <= 6) return;
    await this.client.once(`archive:${snapshot.sha}`, async () => {
      if (missing.every(entry => this.client.hasBlob(entry.sha))) return;
      try {
        const archive = await this.client.archive(snapshot.sha);
        const contents = await readGitHubArchive(archive, snapshot.entries.filter(entry => entry.type === 'blob' && entry.mode !== '120000' &&
          /\.(md|markdown|txt|ya?ml)$/i.test(entry.path)));
        for (const [sha, bytes] of contents) this.client.putBlob(sha, bytes);
      } catch (error) {
        // A missing archive may still have individually readable blobs. Never fall back through a cooldown.
        if (!(error instanceof SourceError) || ![404, 413].includes(error.status)) throw error;
      }
    });
  }

  async readFile(file: string): Promise<Buffer> {
    if (file.startsWith('/') || file.includes('\\') || file.split('/').some(p => p === '..' || p === '.' || !p) || file.includes('\0')) throw new SourceError('Invalid repository path.');
    const { entries } = await this.getSnapshot();
    const entry = entries.find(e => e.path === file && e.type === 'blob' && e.mode !== '120000');
    if (!entry) throw new SourceError('File unavailable.', 404);
    if ((entry.size || 0) > 5 * 1024 * 1024) throw new SourceError('File exceeds the 5 MiB read limit.', 413);
    const blob = await this.api(`/git/blobs/${entry.sha}`);
    if (blob.encoding !== 'base64') throw new SourceError('Unsupported GitHub file encoding.', 422);
    const buffer = Buffer.from(blob.content, 'base64');
    if (buffer.length > 5 * 1024 * 1024) throw new SourceError('File exceeds the 5 MiB read limit.', 413);
    return buffer;
  }

  async config(): Promise<WorkspaceConfig> {
    this.manifest ??= (async () => {
      const { entries } = await this.getSnapshot();
      const location = ['notes/.github-notes.yaml', '.github-notes.yaml'].find(p => entries.some(e => e.path === p && e.type === 'blob'));
      if (!location) throw new SourceError('Workspace manifest missing. Run pnpm bootstrap-workspace in the note repository and push its workspace branch.', 422);
      const config = parseWorkspaceConfig((await this.readFile(location)).toString('utf8'));
      if (location.startsWith('notes/')) config.notebooks = config.notebooks.map(nb => ({ ...nb,
        root: !nb.root.startsWith('notes/') && nb.root !== 'notes' && entries.some(e => e.path === `notes/${nb.root}` && e.type === 'tree') ? `notes/${nb.root}` : nb.root }));
      return config;
    })();
    return this.manifest;
  }

  async note(file: string): Promise<NoteItem> {
    const config = await this.config();
    const nb = config.notebooks.find(n => file.startsWith(`${n.root}/`) && isNotebookContent(file.slice(n.root.length + 1), n));
    if (!nb || !/\.(md|markdown|txt)$/i.test(file)) throw new SourceError('Path is not a configured note.', 403);
    const raw = (await this.readFile(file)).toString('utf8');
    const { metadata, content, title } = parseNoteContent(raw, path.posix.basename(file));
    return { id: typeof metadata.id === 'string' ? metadata.id : file, path: file, notebookId: nb.id, title, metadata, content,
      tags: Array.isArray(metadata.tags) ? metadata.tags.map(String) : [], status: typeof metadata.status === 'string' ? metadata.status : undefined,
      size: Buffer.byteLength(raw), revision: (await this.getSnapshot()).sha };
  }

  async notes(notebookId?: string): Promise<NoteItem[]> {
    const config = await this.config();
    const { entries } = await this.getSnapshot();
    const output: NoteItem[] = [];
    for (const nb of config.notebooks.filter(n => !notebookId || n.id === notebookId)) {
      const files = entries.filter(e => e.type === 'blob' && e.mode !== '120000' && e.path.startsWith(`${nb.root}/`) &&
        isNotebookContent(e.path.slice(nb.root.length + 1), nb) && /\.(md|markdown|txt)$/i.test(e.path));
      await this.prefetchFiles(files.map(file => file.path));
      // The shared transport coalesces cache misses and serializes upstream requests.
      for (let i = 0; i < files.length; i += 6) output.push(...await Promise.all(files.slice(i, i + 6).map(f => this.note(f.path))));
    }
    return output;
  }

  async readNotes(files: string[], expected: string): Promise<NoteItem[]> {
    if (!Array.isArray(files) || !files.length || files.length > 200 || files.some(file => typeof file !== 'string' || file.length > 2048)) {
      throw new SourceError('Select between 1 and 200 note paths.');
    }
    const snapshot = await this.getSnapshot(true);
    if (!expected || snapshot.sha !== expected) throw new SourceError('The repository changed. Review the latest version before committing.', 409);
    await this.prefetchFiles(files);
    const notes: NoteItem[] = [];
    for (const file of files) {
      try { notes.push(await this.note(file)); }
      catch (error) {
        // A deleted selected note is absent from the result so the browser can preserve and mark its draft.
        if (!(error instanceof SourceError) || error.status !== 404 || snapshot.entries.some(entry => entry.path === file)) throw error;
      }
    }
    return notes;
  }

  async folders(): Promise<FolderItem[]> {
    const config = await this.config();
    const { entries } = await this.getSnapshot();
    await this.prefetchFiles(entries.filter(entry => entry.path.endsWith('/_dir.yml') && config.notebooks.some(nb => entry.path.startsWith(nb.root + '/'))).map(entry => entry.path));
    const folders: FolderItem[] = [];
    for (const nb of config.notebooks) {
      const list: FolderItem[] = [];
      for (const entry of entries.filter(e => e.type === 'tree' && e.path.startsWith(`${nb.root}/`))) {
        const relative = entry.path.slice(nb.root.length + 1);
        if (!isNotebookContent(relative, nb)) continue;
        const file = `${entry.path}/_dir.yml`;
        const raw = entries.some(e => e.path === file && e.mode !== '120000') ? (await this.readFile(file)).toString('utf8') : '';
        list.push({ notebookId: nb.id, path: relative, ...parseFolderConfig(raw, path.posix.basename(relative), file) });
      }
      folders.push(...sortFolders(list));
    }
    return folders;
  }

  async assets(notebookId?: string) {
    const config = await this.config();
    const nb = config.notebooks.find(n => n.id === notebookId) || config.notebooks[0];
    const prefix = assetRoot(nb) + '/';
    const snapshot = await this.getSnapshot();
    return snapshot.entries.filter(e => e.type === 'blob' && e.mode !== '120000' && isAssetPath(e.path, nb))
      .map(e => ({ ...assetInfo(e.path, prefix.slice(0, -1), e.sha, e.size || 0), revision: snapshot.sha }));
  }

  async mutateAsset(operation: 'upload' | 'move' | 'delete', args: Record<string, unknown>) {
    const config = await this.config(); const snapshot = await this.getSnapshot();
    const file = typeof args.path === 'string' ? args.path : '';
    const nb = config.notebooks.find(n => operation === 'upload' ? n.id === args.notebookId : isAssetPath(file, n));
    if (!nb) throw new SourceError('Asset notebook or path is unavailable.', 403);
    const existing = snapshot.entries.find(e => e.path === file && e.type === 'blob' && e.mode !== '120000');
    if (operation !== 'upload' && !existing) throw new SourceError('Asset not found.', 404);
    const destination = operation === 'delete' ? file : assetPath(nb, args.directory ?? '', args.filename || path.posix.basename(file));
    if (operation !== 'delete' && snapshot.entries.some(e => e.path === destination)) throw new SourceError('Destination already exists.', 409);
    const changes = operation === 'upload' ? [{ path: destination, base64: decodeAsset(args.base64Content).toString('base64') }]
      : operation === 'move' ? [{ path: destination, sha: existing!.sha }, { path: file, sha: null }]
      : [{ path: file, sha: null }];
    const receipt = await this.commitChanges(changes, String(args.revision || ''), operation, 'assets');
    return { ...receipt, path: destination };
  }

  async save(file: string, content: string, metadata: NoteMetadata | undefined, expected: string, createOnly = false) {
    const snapshot = await this.getSnapshot(true);
    if (!this.token || !snapshot.info.permissions?.push || this.branch !== 'main') throw new SourceError('Write access on the main workspace branch is required.', 403);
    if (!expected || expected !== snapshot.sha) throw new SourceError('The repository changed. Reload before saving.', 409);
    const config = await this.config();
    const nb = config.notebooks.find(n => file.startsWith(`${n.root}/`));
    if (!nb || !isNotebookContent(file.slice(nb.root.length + 1), nb) || !/\.(md|markdown|txt)$/i.test(file) || file.includes('\\') || file.split('/').some(p => p === '..' || p === '.' || !p)) throw new SourceError('Path is not a configured note.', 403);
    if (createOnly && snapshot.entries.some(e => e.path === file)) throw new SourceError('A note already exists at this path.', 409);
    const existing = snapshot.entries.find(e => e.path === file);
    if (existing && (existing.type !== 'blob' || existing.mode === '120000')) throw new SourceError('Path is not a regular note file.', 403);
    if (file.includes('\0') || (metadata !== undefined && (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)))) throw new SourceError('Invalid note path or metadata.');
    const raw = metadata ? serializeNoteContent(metadata, content) : content;
    if (Buffer.byteLength(raw) > 5 * 1024 * 1024) throw new SourceError('Note exceeds the 5 MiB limit.', 413);
    const receipt = await this.commitChanges([{ path: file, content: raw }], expected, existing ? 'write' : 'create');
    return { ...receipt, note: await new GitHubSource(this.repository, receipt.commit.commitHash, this.token, this.request).note(file) };
  }

  /** Publish selected browser working notes as one commit after validation. */
  async commitNotes(notes: { path: string; content: string; metadata: NoteMetadata; createOnly?: boolean }[], expected: string, message: string, screen?: { page: unknown; base: unknown }) {
    if (!Array.isArray(notes) || !notes.length && !screen || notes.length + (screen ? 1 : 0) > 200) throw new SourceError('Select between 1 and 200 files.');
    if (typeof message !== 'string' || !message.trim() || message.length > 4000) throw new SourceError('A commit message of at most 4000 characters is required.');
    const snapshot = await this.getSnapshot(true);
    const changes = notes.map(note => {
      if (!note || typeof note.path !== 'string' || !/\.(md|markdown|txt)$/i.test(note.path) || typeof note.content !== 'string' || !note.metadata || typeof note.metadata !== 'object' || Array.isArray(note.metadata)) throw new SourceError('Invalid note change.');
      if (note.createOnly && snapshot.entries.some(entry => entry.path === note.path)) throw new SourceError(`A note already exists at ${note.path}.`, 409);
      if (!note.createOnly && !snapshot.entries.some(entry => entry.path === note.path)) throw new SourceError(`Note moved or deleted: ${note.path}.`, 409);
      return { path: note.path, content: serializeNoteContent(note.metadata, note.content) };
    });
    if (screen) {
      const page = ScreenPageSchema.safeParse(screen.page), base = ScreenPageSchema.safeParse(screen.base);
      if (!page.success || !base.success) throw new SourceError('Invalid Screen configuration.');
      const entry = snapshot.entries.find(entry => entry.path === SCREEN_PAGE_FILE);
      const current = entry ? ScreenPageSchema.parse(parseYaml((await this.readFile(SCREEN_PAGE_FILE)).toString('utf8'), { maxAliasCount: 20 })) : { version: 1, rows: [] };
      if (JSON.stringify(current) !== JSON.stringify(base.data)) throw new SourceError('Screen configuration changed. Reload and review your draft.', 409);
      changes.push({ path: SCREEN_PAGE_FILE, content: stringifyYaml(page.data, { lineWidth: 0 }) });
    }
    return this.commitChanges(changes, expected, 'update', screen ? 'folders' : 'notes', message.trim());
  }

  /** One Git tree, commit and non-force ref update for the entire mutation. */
  async saveAgentResource(file: string, content: string, expected: string) {
    if (typeof file !== 'string' || !workspaceAgentKind(file)) throw new SourceError('Path is not a workspace Agent document.', 403);
    if (typeof content !== 'string') throw new SourceError('Agent document content is required.');
    return this.commitChanges([{path:file,content}], expected, 'write', 'agents');
  }

  async saveScreenPage(content: string, expected: string) {
    return this.commitChanges([{ path: SCREEN_PAGE_FILE, content }], expected, 'save', 'screen');
  }

  async commitChanges(changes: { path: string; content?: string; base64?: string; sha?: string | null }[], expected: string, operation: string, scope: 'notes' | 'assets' | 'agents' | 'screen' | 'folders' = 'notes', requestedMessage?: string) {
    const snapshot = await this.getSnapshot(true);
    if (!this.token || !snapshot.info.permissions?.push || this.branch !== 'main') throw new SourceError('Write access on the main workspace branch is required.', 403);
    if (!expected || expected !== snapshot.sha) throw new SourceError('The repository changed. Reload before saving.', 409);
    if (!changes.length || changes.length > 200) throw new SourceError('A mutation requires between 1 and 200 changed files.');
    if (new Set(changes.map(c => c.path)).size !== changes.length) throw new SourceError('Each file may appear only once in a mutation.');
    const config = await this.config();
    let bytes = 0;
    for (const change of changes) {
      const file = change.path;
      const nb = config.notebooks.find(n => file.startsWith(`${n.root}/`));
      const screenFile = (scope === 'screen' || scope === 'folders') && file === SCREEN_PAGE_FILE;
      const allowed = scope === 'screen' ? screenFile : screenFile || (scope === 'agents' ? Boolean(workspaceAgentKind(file)) : nb &&
        (scope === 'assets' ? isAssetPath(file, nb) : isNotebookContent(file.slice(nb.root.length + 1), nb) && (/\.(md|markdown|txt)$/i.test(file) || path.posix.basename(file) === '_dir.yml')));
      if (!allowed || file.includes('\\') || file.includes('\0') || file.split('/').some(p => !p || p === '.' || p === '..')) throw new SourceError('Path is not an allowed workspace resource.', 403);
      if (screenFile) {
        if (typeof change.content !== 'string' || Buffer.byteLength(change.content) > 512 * 1024) throw new SourceError('Screen Page YAML is required.');
        try { ScreenPageSchema.parse(parseYaml(change.content, { maxAliasCount: 20 })); }
        catch { throw new SourceError('Invalid Screen Page YAML.'); }
      }
      if (snapshot.entries.some(e => (e.path === file || file.startsWith(e.path + '/')) && (e.mode === '120000' || (e.path !== file && e.type !== 'tree')))) throw new SourceError('Path crosses a non-directory or symlink.', 403);
      const existing = snapshot.entries.find(e => e.path === file);
      if (existing && existing.type !== 'blob') throw new SourceError('A directory occupies the target path.', 409);
      if (change.sha === null && !existing) throw new SourceError('File to remove does not exist.', 404);
      if (change.base64 !== undefined) {
        if (scope !== 'assets') throw new SourceError('Binary content requires an asset path.');
        bytes += decodeAsset(change.base64).length;
      } else if (change.content !== undefined) {
        bytes += Buffer.byteLength(change.content);
        if (path.posix.basename(file) === '_dir.yml') parseFolderConfig(change.content, path.posix.basename(path.posix.dirname(file)), file);
      } else if (change.sha !== null) {
        const source = snapshot.entries.find(e => e.sha === change.sha && e.type === 'blob' && e.mode !== '120000');
        if (!source) throw new SourceError('Copy source is unavailable.');
        if (path.posix.basename(file) === '_dir.yml') parseFolderConfig((await this.readFile(source.path)).toString('utf8'), path.posix.basename(path.posix.dirname(file)), file);
      }
    }
    if (bytes > 5 * 1024 * 1024) throw new SourceError('Mutation exceeds the 5 MiB limit.', 413);
    const entries = [];
    for (const change of changes) {
      const value = change.content !== undefined ? { content: change.content } : {
        sha: change.base64 !== undefined ? (await this.api('/git/blobs', { method: 'POST', body: JSON.stringify({ content: change.base64, encoding: 'base64' }) })).sha : change.sha,
      };
      entries.push({ path: change.path, mode: '100644', type: 'blob', ...value });
    }
    const tree = await this.api('/git/trees', { method: 'POST', body: JSON.stringify({ base_tree: snapshot.treeSha, tree: entries }) });
    const changedPaths = changes.map(c => c.path).sort();
    const summary = changedPaths.length === 1 ? path.posix.basename(changedPaths[0]) : `${changedPaths.length} files`;
    const message = requestedMessage || `docs(${scope}): ${operation.replace(/[^a-z-]/g, '')} ${summary.replace(/[\r\n]/g, ' ')}`;
    const commit = await this.api('/git/commits', { method: 'POST', body: JSON.stringify({ message, tree: tree.sha, parents: [snapshot.sha] }) });
    try {
      await this.api(`/git/refs/heads/${encodeURIComponent(this.branch)}`, { method: 'PATCH', body: JSON.stringify({ sha: commit.sha, force: false }) });
    } finally { this.client.invalidate(); this.snapshot = undefined; this.manifest = undefined; this.fresh = false; }
    return { success: true, committed: true, pushed: true, repository: this.repository, branch: this.branch, revision: commit.sha as string, changedPaths, commit: { commitHash: commit.sha as string, message } };
  }
}
