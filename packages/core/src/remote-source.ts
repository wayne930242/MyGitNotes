import { STUDY_FILE } from './study.js';
import { managedNotebook } from './file-manager.js';
import path from 'node:path';
import { assetInfo, assetPath, assetRoot, decodeAsset, isAssetPath } from './assets.js';
import { LEGACY_WORKSPACE_CONFIG_FILENAME, parseWorkspaceConfig, serializeWorkspaceConfig, WORKSPACE_CONFIG_FILENAME } from './config.js';
import { parseNoteContent, serializeNoteContent } from './frontmatter.js';
import { formatTemplateDate, renderNoteTemplate } from './templates.js';
import { isNotebookContent, parseFolderConfig, sortFolders } from './folders.js';
import { FolderItem, NotebookConfig, NoteItem, NoteMetadata, WorkspaceConfig } from './types.js';
import { SourceError } from './github-api.js';
import { workspaceAgentKind } from './workspace-agent.js';
import { type CommitScope, readWorkspaceDocument, serializeWorkspaceDocument, validateWorkspaceDocument, type WorkspaceDocument, workspaceDocument } from './workspace-documents.js';
import { gitBlobId, hashJson, REMOTE_CACHE_BATCH_BYTES, REMOTE_CACHE_MAX_VALUE, REMOTE_CACHE_TTL, type RemoteCache } from './remote-cache.js';
import type { NoteCatalog } from './note-catalog.js';
import type { NoteListItem } from './note-query.js';

export { SourceError } from './github-api.js';
const NOTE_FILE = /\.(md|markdown|mdx|txt)$/i;
const CACHEABLE_FILE = /\.(md|markdown|mdx|txt|ya?ml)$/i;
const INDEX_VERSION = 'v1';
/** Blobs kept in memory for one request. */
const LOADED_MAX_BYTES = 64 * 1024 * 1024;
export interface RemoteEntry {
  path: string;
  type: string;
  mode: string;
  sha: string;
  size?: number;
}
export interface RepositoryInfo {
  private: boolean;
  permissions?: { push?: boolean; };
  default_branch: string;
}
export interface RemoteSnapshot {
  sha: string;
  treeSha: string;
  entries: RemoteEntry[];
  info: RepositoryInfo;
}
export type RemoteChange = { path: string; content?: string; base64?: string; sha?: string | null; };

/** Shared workspace rules, independent of the Git hosting provider. */
export abstract class RemoteSource {
  private snapshot?: Promise<RemoteSnapshot>;
  private manifest?: Promise<{ config: WorkspaceConfig; file: string; prefixed: ReadonlySet<string>; }>;
  protected fresh = false;
  /** Blobs loaded from the shared cache or verified platform reads, by sha. */
  private loaded = new Map<string, Buffer>();
  private loadedBytes = 0;
  private cacheChecked = new Set<string>();
  constructor(public repository: string, public branch: string, protected token?: string, protected cache?: RemoteCache) {}
  protected abstract loadSnapshot(): Promise<RemoteSnapshot>;
  protected abstract readBlob(sha: string): Promise<Buffer>;
  protected abstract publishChanges(changes: RemoteChange[], snapshot: RemoteSnapshot, message: string): Promise<string>;
  protected invalidate() {}
  /** Loads cached blobs for the given files; providers extend this with batched platform reads. */
  async prefetchFiles(files: string[]): Promise<void> {
    const { entries } = await this.getSnapshot();
    const wanted = new Set(files);
    await this.loadCached(entries.filter(entry => wanted.has(entry.path) && entry.type === 'blob' && entry.mode !== '120000'));
  }

  private blobKey(sha: string) {
    return `mgn:blob:v1:${this.repository.toLowerCase()}:${sha}`;
  }
  protected cacheable(entry: RemoteEntry) {
    return Boolean(this.cache) && CACHEABLE_FILE.test(entry.path) && (entry.size === undefined || entry.size * 4 / 3 <= REMOTE_CACHE_MAX_VALUE);
  }

  /** Keeps this request's blobs available while bounding its memory. */
  private remember(sha: string, bytes: Buffer) {
    this.loaded.set(sha, bytes);
    this.loadedBytes += bytes.length;
    while (this.loadedBytes > LOADED_MAX_BYTES && this.loaded.size > 1) {
      const oldest = this.loaded.keys().next().value!;
      if (oldest === sha) break;
      this.loadedBytes -= this.loaded.get(oldest)!.length;
      this.loaded.delete(oldest);
    }
  }

  /** Fills loaded blobs from the shared cache. Only entries of this reader's authorized tree are looked up. Returns entries still missing. */
  protected async loadCached(entries: RemoteEntry[]): Promise<RemoteEntry[]> {
    const pending = [...new Map(entries.filter(entry => !this.loaded.has(entry.sha) && this.cacheable(entry) && !this.cacheChecked.has(entry.sha)).map(entry => [entry.sha, entry])).values()];
    let batch: RemoteEntry[] = [], bytes = 0;
    const flush = async () => {
      if (!batch.length) return;
      const hits = await this.cache!.get(batch.map(entry => this.blobKey(entry.sha)));
      batch.forEach((entry, i) => {
        this.cacheChecked.add(entry.sha);
        if (hits[i] === null) return;
        // Content addressing is the authorization rule for this cache, so a value is only trusted when it hashes to its key.
        const bytes = Buffer.from(hits[i]!, 'base64');
        if (gitBlobId(bytes, entry.sha.length) === entry.sha) this.remember(entry.sha, bytes);
      });
      batch = [];
      bytes = 0;
    };
    for (const entry of pending) {
      const size = (entry.size ?? 64 * 1024) * 4 / 3;
      if (batch.length && bytes + size > REMOTE_CACHE_BATCH_BYTES) await flush();
      batch.push(entry);
      bytes += size;
    }
    await flush();
    return entries.filter(entry => !this.loaded.has(entry.sha));
  }

  /** Stores verified platform reads in the shared cache. */
  protected async storeCached(blobs: [RemoteEntry, Buffer][]) {
    const verified = blobs.filter(([entry, bytes]) => gitBlobId(bytes, entry.sha.length) === entry.sha);
    for (const [entry, bytes] of verified) this.remember(entry.sha, bytes);
    const values = verified.filter(([entry]) => this.cacheable(entry)).map(([entry, bytes]) => [this.blobKey(entry.sha), bytes.toString('base64')] as [string, string]).filter(([, value]) => Buffer.byteLength(value) <= REMOTE_CACHE_MAX_VALUE);
    if (values.length) await this.cache!.set(values, REMOTE_CACHE_TTL);
  }
  async getSnapshot(fresh = false): Promise<RemoteSnapshot> {
    if (fresh) {
      this.snapshot = undefined;
      this.manifest = undefined;
      this.fresh = true;
    }
    this.snapshot ??= this.loadSnapshot();
    return this.snapshot;
  }
  async readFile(file: string): Promise<Buffer> {
    if (file.startsWith('/') || file.includes('\\') || file.split('/').some(p => p === '..' || p === '.' || !p) || file.includes('\0')) throw new SourceError('Invalid repository path.');
    const { entries } = await this.getSnapshot();
    const entry = entries.find(e => e.path === file && e.type === 'blob' && e.mode !== '120000');
    if (!entry) throw new SourceError('File unavailable.', 404);
    if ((entry.size || 0) > 5 * 1024 * 1024) throw new SourceError('File exceeds the 5 MiB read limit.', 413);
    if (!this.loaded.has(entry.sha)) await this.loadCached([entry]);
    const loaded = this.loaded.get(entry.sha);
    if (loaded) return loaded;
    const buffer = await this.readBlob(entry.sha);
    if (buffer.length > 5 * 1024 * 1024) throw new SourceError('File exceeds the 5 MiB read limit.', 413);
    if (this.cacheable(entry)) await this.storeCached([[entry, buffer]]);
    return buffer;
  }

  /** The manifest with the file it came from, so a write lands there and can undo the roots this read rewrote. */
  private manifestRecord() {
    this.manifest ??= (async () => {
      const { entries } = await this.getSnapshot();
      const location = [`notes/${WORKSPACE_CONFIG_FILENAME}`, `notes/${LEGACY_WORKSPACE_CONFIG_FILENAME}`, WORKSPACE_CONFIG_FILENAME, LEGACY_WORKSPACE_CONFIG_FILENAME].find(p => entries.some(e => e.path === p && e.type === 'blob'));
      if (!location) throw new SourceError('Workspace manifest missing. Run pnpm bootstrap-workspace in the note repository and push its workspace branch.', 422);
      const config = parseWorkspaceConfig((await this.readFile(location)).toString('utf8'));
      const prefixed = new Set<string>();
      if (location.startsWith('notes/')) {
        config.notebooks = config.notebooks.map(nb => {
          if (nb.root.startsWith('notes/') || nb.root === 'notes' || !entries.some(e => e.path === `notes/${nb.root}` && e.type === 'tree')) return nb;
          prefixed.add(nb.id);
          return { ...nb, root: `notes/${nb.root}` };
        });
      }
      return { config, file: location, prefixed };
    })();
    return this.manifest;
  }

  async config(): Promise<WorkspaceConfig> {
    return (await this.manifestRecord()).config;
  }

  /** Writes the manifest back to its own file, restoring every root this reader prefixed with `notes/`. */
  async saveWorkspaceConfig(configYaml: string, expected: string) {
    const { file, prefixed } = await this.manifestRecord();
    const validated = parseWorkspaceConfig(configYaml);
    if (prefixed.size) validated.notebooks = validated.notebooks.map(nb => prefixed.has(nb.id) && nb.root.startsWith('notes/') ? { ...nb, root: nb.root.slice('notes/'.length) } : nb);
    // The same commit subject a local checkout writes, so the history reads the same from either side.
    return this.commitChanges([{ path: file, content: serializeWorkspaceConfig(validated) }], expected, 'save', 'config', 'chore(workspace): update configuration');
  }

  async note(file: string): Promise<NoteItem> {
    const config = await this.config();
    const nb = config.notebooks.find(n => file.startsWith(`${n.root}/`) && isNotebookContent(file.slice(n.root.length + 1), n));
    if (!nb || !NOTE_FILE.test(file)) throw new SourceError('Path is not a configured note.', 403);
    const raw = (await this.readFile(file)).toString('utf8');
    const { metadata, content, title, lineNumberOffset } = parseNoteContent(raw, path.posix.basename(file));
    return { id: typeof metadata.id === 'string' ? metadata.id : file, path: file, notebookId: nb.id, title, metadata, content, lineNumberOffset, tags: Array.isArray(metadata.tags) ? metadata.tags.map(String) : [], status: typeof metadata.status === 'string' ? metadata.status : undefined, size: Buffer.byteLength(raw), revision: (await this.getSnapshot()).sha };
  }

  private notebookFiles(nb: NotebookConfig, entries: RemoteEntry[]) {
    const templateFiles = new Set((nb.templates || []).map(t => t.file));
    return entries.filter(e => e.type === 'blob' && e.mode !== '120000' && e.path.startsWith(`${nb.root}/`) && isNotebookContent(e.path.slice(nb.root.length + 1), nb) && !templateFiles.has(e.path.slice(nb.root.length + 1)) && NOTE_FILE.test(e.path));
  }

  private notebookKey(kind: string, notebooks: NotebookConfig[], entries: RemoteEntry[]) {
    return `mgn:${kind}:${INDEX_VERSION}:${this.repository.toLowerCase()}:${hashJson(notebooks.map(nb => [nb.id, nb.root, nb.assets || 'assets', (nb.templates || []).map(t => t.file), entries.find(entry => entry.type === 'tree' && entry.path === nb.root)?.sha || null]))}`;
  }

  /** Query read model over this reader's snapshot. Notebook indexes and derived results are cached by notebook content. */
  catalog(): NoteCatalog {
    const local = new Map<string, Promise<NoteListItem[]>>();
    return {
      revision: async () => (await this.getSnapshot()).sha,
      config: () => this.config(),
      index: nb => {
        let pending = local.get(nb.id);
        if (!pending) {
          pending = this.notebookIndex(nb);
          local.set(nb.id, pending);
        }
        return pending;
      },
      contents: async notes => {
        await this.prefetchFiles(notes.map(note => note.path));
        const result = new Map<string, string>();
        for (let i = 0; i < notes.length; i += 6) {
          await Promise.all(
            notes.slice(i, i + 6).map(async note => {
              result.set(note.path, parseNoteContent((await this.readFile(note.path)).toString('utf8'), path.posix.basename(note.path)).content);
            }),
          );
        }
        return result;
      },
      memo: async <T>(kind: string, notebooks: NotebookConfig[], compute: () => Promise<T>): Promise<T> => {
        const { entries } = await this.getSnapshot();
        if (!this.cache || notebooks.some(nb => !entries.some(entry => entry.type === 'tree' && entry.path === nb.root))) return compute();
        const key = this.notebookKey(kind, notebooks, entries);
        const [hit] = await this.cache.get([key]);
        if (hit !== null) {
          try {
            return JSON.parse(hit) as T;
          } catch { /* A damaged value is recomputed. */ }
        }
        const value = await compute();
        const text = JSON.stringify(value);
        if (Buffer.byteLength(text) <= REMOTE_CACHE_MAX_VALUE) await this.cache.set([[key, text]], REMOTE_CACHE_TTL);
        return value;
      },
    };
  }

  private async notebookIndex(nb: NotebookConfig): Promise<NoteListItem[]> {
    const { sha, entries } = await this.getSnapshot();
    if (!entries.some(entry => entry.type === 'tree' && entry.path === nb.root)) return [];
    const key = this.cache ? this.notebookKey('index', [nb], entries) : '';
    const hit = this.cache ? (await this.cache.get([key]))[0] : null;
    let items: NoteListItem[] | undefined;
    if (hit !== null) {
      try {
        items = JSON.parse(hit) as NoteListItem[];
      } catch { /* A damaged value is rebuilt. */ }
    }
    if (!Array.isArray(items) || items.some(item => typeof item?.path !== 'string' || typeof item?.title !== 'string' || item?.notebookId !== nb.id || !Array.isArray(item?.tags) || typeof item?.metadata !== 'object' || item?.metadata === null)) items = undefined;
    if (!items) {
      const files = this.notebookFiles(nb, entries);
      await this.prefetchFiles(files.map(file => file.path));
      items = [];
      for (let i = 0; i < files.length; i += 6) {
        items.push(
          ...await Promise.all(
            files.slice(i, i + 6).map(async file => {
              const raw = (await this.readFile(file.path)).toString('utf8');
              const { metadata, title } = parseNoteContent(raw, path.posix.basename(file.path));
              return { id: typeof metadata.id === 'string' ? metadata.id : file.path, path: file.path, notebookId: nb.id, title, metadata, tags: Array.isArray(metadata.tags) ? metadata.tags.map(String) : [], status: typeof metadata.status === 'string' ? metadata.status : undefined, size: Buffer.byteLength(raw) } satisfies NoteListItem;
            }),
          ),
        );
      }
      const text = JSON.stringify(items);
      if (this.cache && Buffer.byteLength(text) <= REMOTE_CACHE_MAX_VALUE) await this.cache.set([[key, text]], REMOTE_CACHE_TTL);
    }
    return items.map(item => ({ ...item, revision: sha }));
  }

  async renderTemplate(notebookId: string, templateId: string, title: string): Promise<{ metadata: NoteMetadata; content: string; }> {
    const config = await this.config();
    const nb = config.notebooks.find(n => n.id === notebookId);
    const entry = nb?.templates?.find(t => t.id === templateId);
    if (!nb || !entry) throw new SourceError('Template is not configured for this notebook.', 404);
    const raw = (await this.readFile(`${nb.root}/${entry.file}`)).toString('utf8');
    const { metadata, content } = parseNoteContent(raw, path.posix.basename(entry.file));
    return renderNoteTemplate({ metadata, content }, { title, date: formatTemplateDate() });
  }

  async notes(notebookId?: string): Promise<NoteItem[]> {
    const config = await this.config();
    const { entries } = await this.getSnapshot();
    const output: NoteItem[] = [];
    for (const nb of config.notebooks.filter(n => !notebookId || n.id === notebookId)) {
      const files = this.notebookFiles(nb, entries);
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
      try {
        notes.push(await this.note(file));
      } catch (error) {
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
    return snapshot.entries.filter(e => e.type === 'blob' && e.mode !== '120000' && isAssetPath(e.path, nb)).map(e => ({ ...assetInfo(e.path, prefix.slice(0, -1), e.sha, e.size || 0), revision: snapshot.sha }));
  }

  async mutateAsset(operation: 'upload' | 'move' | 'delete', args: Record<string, unknown>) {
    const config = await this.config();
    const snapshot = await this.getSnapshot();
    const file = typeof args.path === 'string' ? args.path : '';
    const nb = config.notebooks.find(n => operation === 'upload' ? n.id === args.notebookId : isAssetPath(file, n));
    if (!nb) throw new SourceError('Asset notebook or path is unavailable.', 403);
    const existing = snapshot.entries.find(e => e.path === file && e.type === 'blob' && e.mode !== '120000');
    if (operation !== 'upload' && !existing) throw new SourceError('Asset not found.', 404);
    const destination = operation === 'delete' ? file : assetPath(nb, args.directory ?? '', args.filename || path.posix.basename(file));
    if (operation !== 'delete' && snapshot.entries.some(e => e.path === destination)) throw new SourceError('Destination already exists.', 409);
    const changes = operation === 'upload' ? [{ path: destination, base64: decodeAsset(args.base64Content).toString('base64') }] : operation === 'move' ? [{ path: destination, sha: existing!.sha }, { path: file, sha: null }] : [{ path: file, sha: null }];
    const receipt = await this.commitChanges(changes, String(args.revision || ''), operation, 'assets');
    return { ...receipt, path: destination };
  }

  async save(file: string, content: string, metadata: NoteMetadata | undefined, expected: string, createOnly = false) {
    const snapshot = await this.getSnapshot(true);
    if (!this.token || !snapshot.info.permissions?.push || this.branch !== 'main') throw new SourceError('Write access on the main workspace branch is required.', 403);
    if (!expected || expected !== snapshot.sha) throw new SourceError('The repository changed. Reload before saving.', 409);
    const config = await this.config();
    const nb = config.notebooks.find(n => file.startsWith(`${n.root}/`));
    if (!nb || !isNotebookContent(file.slice(nb.root.length + 1), nb) || !NOTE_FILE.test(file) || file.includes('\\') || file.split('/').some(p => p === '..' || p === '.' || !p)) throw new SourceError('Path is not a configured note.', 403);
    if (createOnly && snapshot.entries.some(e => e.path === file)) throw new SourceError('A note already exists at this path.', 409);
    const existing = snapshot.entries.find(e => e.path === file);
    if (existing && (existing.type !== 'blob' || existing.mode === '120000')) throw new SourceError('Path is not a regular note file.', 403);
    if (file.includes('\0') || (metadata !== undefined && (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)))) throw new SourceError('Invalid note path or metadata.');
    const existingRaw = existing ? await this.readFile(file).then(b => b.toString('utf8')).catch(() => undefined) : undefined;
    const raw = metadata ? serializeNoteContent(metadata, content, !existing, new Date(), existingRaw) : content;
    if (Buffer.byteLength(raw) > 5 * 1024 * 1024) throw new SourceError('Note exceeds the 5 MiB limit.', 413);
    const receipt = await this.commitChanges([{ path: file, content: raw }], expected, existing ? 'write' : 'create');
    const parsed = parseNoteContent(raw, path.posix.basename(file));
    return { ...receipt, note: { id: typeof parsed.metadata.id === 'string' ? parsed.metadata.id : file, path: file, notebookId: nb.id, ...parsed, tags: Array.isArray(parsed.metadata.tags) ? parsed.metadata.tags.map(String) : [], status: typeof parsed.metadata.status === 'string' ? parsed.metadata.status : undefined, size: Buffer.byteLength(raw), revision: receipt.revision } };
  }

  /** Publish selected browser working notes as one commit after validation. */
  async commitNotes(notes: { path: string; content: string; metadata: NoteMetadata; createOnly?: boolean; }[], expected: string, message: string, documents: { path: string; page: unknown; base: unknown; }[] = []) {
    if (!Array.isArray(notes) || !Array.isArray(documents) || !notes.length && !documents.length || notes.length + documents.length > 200) throw new SourceError('Select between 1 and 200 files.');
    if (typeof message !== 'string' || !message.trim() || message.length > 4000) throw new SourceError('A commit message of at most 4000 characters is required.');
    const snapshot = await this.getSnapshot(true);
    for (const note of notes) {
      if (!note || typeof note.path !== 'string' || !NOTE_FILE.test(note.path) || typeof note.content !== 'string' || !note.metadata || typeof note.metadata !== 'object' || Array.isArray(note.metadata)) throw new SourceError('Invalid note change.');
      if (note.createOnly && snapshot.entries.some(entry => entry.path === note.path)) throw new SourceError(`A note already exists at ${note.path}.`, 409);
      if (!note.createOnly && !snapshot.entries.some(entry => entry.path === note.path)) throw new SourceError(`Note moved or deleted: ${note.path}.`, 409);
    }
    // Bounds concurrent blob reads the same way `contents()` does, so a 200-note batch cannot burst 200 uncached platform reads at once.
    await this.prefetchFiles(notes.filter(note => !note.createOnly).map(note => note.path));
    const changes: { path: string; content: string; }[] = [];
    for (let i = 0; i < notes.length; i += 6) {
      changes.push(
        ...await Promise.all(
          notes.slice(i, i + 6).map(async note => {
            const existingRaw = note.createOnly ? undefined : await this.readFile(note.path).then(b => b.toString('utf8')).catch(() => undefined);
            return { path: note.path, content: serializeNoteContent(note.metadata, note.content, Boolean(note.createOnly), new Date(), existingRaw) };
          }),
        ),
      );
    }
    const config = documents.length ? await this.config() : null;
    for (const draft of documents) {
      const document = workspaceDocument(draft?.path);
      if (!document?.scopes.includes('folders')) throw new SourceError('Path is not an allowed workspace resource.', 403);
      const page = document.schema.safeParse(draft.page), base = document.schema.safeParse(draft.base);
      if (!page.success || !base.success) throw new SourceError(`Invalid ${document.label} configuration.`);
      const current = readWorkspaceDocument(document, snapshot.entries.some(entry => entry.path === document.file) ? (await this.readFile(document.file)).toString('utf8') : null, config);
      if (JSON.stringify(current) !== JSON.stringify(base.data)) throw new SourceError(`${document.label} configuration changed. Reload and review your draft.`, 409);
      changes.push({ path: document.file, content: serializeWorkspaceDocument(page.data) });
    }
    return this.commitChanges(changes, expected, 'update', documents.length ? 'folders' : 'notes', message.trim(), snapshot);
  }

  /** One Git tree, commit and non-force ref update for the entire mutation. */
  async saveAgentResource(file: string, content: string, expected: string) {
    if (typeof file !== 'string' || !workspaceAgentKind(file)) throw new SourceError('Path is not a workspace Agent document.', 403);
    if (typeof content !== 'string') throw new SourceError('Agent document content is required.');
    return this.commitChanges([{ path: file, content }], expected, 'write', 'agents');
  }

  async saveStudyTransition(content: string, note: { path: string; content: string; }, expected: string) {
    return this.commitChanges([{ path: STUDY_FILE, content }, note], expected, 'review', 'study-transition');
  }

  async saveStudyWorkspace(content: string, expected: string) {
    return this.commitChanges([{ path: STUDY_FILE, content }], expected, 'save', 'study');
  }

  async saveWorkspaceDocument(document: WorkspaceDocument, content: string, expected: string) {
    return this.commitChanges([{ path: document.file, content }], expected, 'save', document.scopes[0]);
  }

  async commitChanges(changes: { path: string; content?: string; base64?: string; sha?: string | null; }[], expected: string, operation: string, scope: CommitScope = 'notes', requestedMessage?: string, knownSnapshot?: RemoteSnapshot) {
    const snapshot = knownSnapshot || await this.getSnapshot(true);
    if (!this.token || !snapshot.info.permissions?.push || this.branch !== 'main') throw new SourceError('Write access on the main workspace branch is required.', 403);
    if (!expected || expected !== snapshot.sha) throw new SourceError('The repository changed. Reload before saving.', 409);
    if (!changes.length || changes.length > 200) throw new SourceError('A mutation requires between 1 and 200 changed files.');
    if (new Set(changes.map(c => c.path)).size !== changes.length) throw new SourceError('Each file may appear only once in a mutation.');
    const manifest = await this.manifestRecord();
    const config = manifest.config;
    let bytes = 0;
    for (const change of changes) {
      const file = change.path;
      const nb = config.notebooks.find(n => file.startsWith(`${n.root}/`));
      const document = workspaceDocument(file);
      const documentFile = Boolean(document?.scopes.includes(scope));
      const allowed = documentFile || (scope === 'config' ? file === manifest.file : !['screen', 'study', 'focus', 'config'].includes(scope) && (scope === 'files' ? Boolean(managedNotebook(file, config.notebooks)) : scope === 'study-transition' ? nb && isNotebookContent(file.slice(nb.root.length + 1), nb) && NOTE_FILE.test(file) : scope === 'agents' ? Boolean(workspaceAgentKind(file)) : nb && (scope === 'assets' ? isAssetPath(file, nb) : isNotebookContent(file.slice(nb.root.length + 1), nb) && (NOTE_FILE.test(file) || path.posix.basename(file) === '_dir.yml'))));
      if (!allowed || file.includes('\\') || file.includes('\0') || file.split('/').some(p => !p || p === '.' || p === '..')) throw new SourceError('Path is not an allowed workspace resource.', 403);
      if (documentFile) validateWorkspaceDocument(document!, change.content);
      if (snapshot.entries.some(e => (e.path === file || file.startsWith(e.path + '/')) && (e.mode === '120000' || (e.path !== file && e.type !== 'tree')))) throw new SourceError('Path crosses a non-directory or symlink.', 403);
      const existing = snapshot.entries.find(e => e.path === file);
      if (existing && existing.type !== 'blob') throw new SourceError('A directory occupies the target path.', 409);
      if (change.sha === null && !existing) throw new SourceError('File to remove does not exist.', 404);
      if (change.base64 !== undefined) {
        if (scope !== 'assets' && scope !== 'files') throw new SourceError('Binary content requires an asset path.');
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
    const changedPaths = changes.map(c => c.path).sort();
    const summary = changedPaths.length === 1 ? path.posix.basename(changedPaths[0]) : `${changedPaths.length} files`;
    const message = requestedMessage || `docs(${scope}): ${operation.replace(/[^a-z-]/g, '')} ${summary.replace(/[\r\n]/g, ' ')}`;
    let revision: string;
    try {
      revision = await this.publishChanges(changes, snapshot, message);
    } finally {
      this.invalidate();
      this.snapshot = undefined;
      this.manifest = undefined;
      this.fresh = false;
    }
    return { success: true, committed: true, pushed: true, repository: this.repository, branch: this.branch, revision: revision, changedPaths, commit: { commitHash: revision, message } };
  }
}
