import path from 'node:path';
import { callNoteShell, type NoteSearchOptions, noteShellWrites, noteWebPath, RemoteSource, searchNotes, serializeNoteContent, withNoteStatus } from '@mygitnotes/core';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { type AssetUpload, deleteR2Asset, listR2Assets, uploadR2Asset } from './tools/assets.js';

type Schema = Record<string, any>;
const str = (description: string, extra: Schema = {}): Schema => ({ type: 'string', description, ...extra });
const int = (description: string, minimum: number, maximum: number): Schema => ({ type: 'integer', description, minimum, maximum });
const bool = (description: string): Schema => ({ type: 'boolean', description });
const object = (properties: Schema, required = Object.keys(properties), additionalProperties = false): Schema => ({ type: 'object', properties, required, additionalProperties });
const array = (items: Schema): Schema => ({ type: 'array', items });
const pathField = str('Exact repository-relative path inside a configured notebook.', { minLength: 1, maxLength: 1024 });
const revisionField = str('Commit revision returned by ls, glob or read. A stale revision rejects the entire mutation.', { minLength: 1, maxLength: 64 });
const contentField = str('UTF-8 file text. Shell tools include YAML frontmatter in file content and line numbers.', { maxLength: 5 * 1024 * 1024 });
const patternField = str('Repository-relative Bash glob, e.g. notes/example/**/*.md. Supports *, **, ?, brackets and braces.', { maxLength: 256, minLength: 1 });
const metadata: Schema = { type: 'object', additionalProperties: true };
const noteSchema = object({ id: str('Note identifier'), path: pathField, notebookId: str('Notebook ID'), title: str('Title'), content: str('Markdown body'), metadata, tags: array(str('Tag')), revision: str('Read commit SHA') }, ['path', 'title', 'content', 'metadata', 'revision'], true);
const nullableInteger: Schema = { type: ['integer', 'null'] };
const receiptSchema = object({ success: { const: true }, committed: { const: true }, pushed: { const: true }, repository: str('Repository project path'), branch: str('Updated branch'), revision: str('Resulting commit SHA'), changedPaths: array(pathField), commit: object({ commitHash: str('Resulting commit SHA'), message: str('Program-generated commit message') }) }, undefined, true);
const noteReceiptSchema = object({ ...receiptSchema.properties, path: pathField, url: str('Web page of the note; present when the app URL is configured.') }, [...receiptSchema.required, 'path'], true);
const noteWriteTools = new Set(['write', 'append', 'edit', 'save_note', 'update_note_metadata']);

const mutatingTools = new Set(['save_note', 'delete_note', 'add_asset', 'delete_asset', 'replace_notes', 'update_note_metadata']);

export function isMutationTool(name: string) {
  return mutatingTools.has(name) || noteShellWrites.has(name);
}

function tool(name: string, description: string, properties: Schema, required: string[], output: Schema): Tool {
  const mutation = isMutationTool(name);
  return { name, description, inputSchema: object(properties, required) as Tool['inputSchema'], outputSchema: output as Tool['outputSchema'], annotations: { title: name, readOnlyHint: !mutation, destructiveHint: ['write', 'edit', 'mv', 'rm', 'cp', 'save_note', 'delete_note', 'delete_asset', 'replace_notes', 'add_asset', 'update_note_metadata', 'update_folder_metadata', 'mkdir'].includes(name), idempotentHint: !mutation, openWorldHint: true } };
}

const page = { offset: int('Zero-based result offset.', 0, 100000), limit: int('Maximum returned entries; default 100.', 1, 500) };
const transfer = { source: pathField, destination: str('Destination path; an existing directory receives the source basename.'), revision: revisionField, recursive: bool('Required for copying or moving a directory.'), overwrite: bool('Explicitly allow replacement of destination files; default false.') };

export const legacyRemoteTools: Tool[] = [tool('get_folder_metadata', 'Read display metadata for a notebook folder (_dir.yml).', { path: pathField }, ['path'], object({ path: pathField, notebookId: str('Notebook identifier'), title: str('Folder title'), order: int('Order', -1000000, 1000000), description: str('Folder description') })), tool('update_folder_metadata', 'Update display metadata for a notebook folder (_dir.yml) and create one remote commit.', { path: pathField, title: str('Optional display title for the folder.'), order: int('Optional sort order number.', -1000000, 1000000), description: str('Optional folder description.'), metadata, revision: revisionField }, ['path', 'revision'], receiptSchema), tool('get_note_metadata', 'Fast read for note frontmatter metadata and available statuses without loading the markdown body.', { path: pathField }, ['path'], object({ path: pathField, notebookId: str('Notebook identifier'), title: str('Note title'), status: { type: ['string', 'null'], description: 'Note status' }, tags: array(str('Tag name')), metadata, revision: str('Read commit SHA'), availableStatuses: array(str('Status name')) })), tool('update_note_metadata', 'Fast update for note frontmatter metadata without re-sending markdown body.', { path: pathField, status: str('Optional status to update to'), tags: array(str('Tag name')), title: str('Optional title to update'), hidden: bool('Optional hidden boolean flag'), metadata: object({}, [], true), revision: str('Optional commit SHA. Defaults to current HEAD.') }, ['path'], { ...noteReceiptSchema, properties: { ...noteReceiptSchema.properties, note: noteSchema }, required: [...noteReceiptSchema.required, 'note'] })];

export const remoteTools: Tool[] = [tool('ls', 'List a notebook directory like ls. Start with path "." to list notebooks. Returns the revision for a subsequent write.', { path: str('Directory path; default "." lists notebook roots.'), ...page }, [], object({ revision: revisionField, path: str('Listed directory'), entries: array(object({ path: pathField, type: { type: 'string', enum: ['file', 'directory'] }, size: int('Bytes', 0, Number.MAX_SAFE_INTEGER) }, ['path', 'type'])), total: int('Total entries', 0, 100000), nextOffset: nullableInteger })), tool('glob', 'Find note paths using a Bash glob without reading each file. Use before read, find, cp, mv or rm.', { pattern: patternField, ...page }, [], object({ revision: revisionField, paths: array(pathField), total: int('Total matches', 0, 100000), nextOffset: nullableInteger })), tool('read', 'Read a file like sed -n, using one-based lines including YAML frontmatter. Defaults to 200 lines. Returns the revision and next line.', { path: pathField, startLine: int('First line, inclusive; default 1.', 1, 1000000), maxLines: int('Maximum lines; default 200.', 1, 500) }, ['path'], object({ path: pathField, revision: revisionField, startLine: int('First returned line', 1, 1000000), endLine: int('Last returned line', 0, 1000000), totalLines: int('Total file lines', 0, 1000000), content: str('Exact text of returned lines'), truncated: bool('More lines remain'), nextLine: nullableInteger })), tool('find', 'Search literal text like grep -n across note files matched by a glob. Returns paths, one-based line numbers and bounded excerpts. Refine the pattern when truncated.', { query: str('Literal text to find.', { minLength: 1, maxLength: 1000 }), pattern: patternField, caseSensitive: bool('Default false.'), maxResults: int('Maximum matches; default 100.', 1, 500), fileOffset: int('File offset from the previous page.', 0, 100000), maxFiles: int('Files to scan per call; default 25.', 1, 100) }, ['query'], object({ revision: revisionField, matches: array(object({ path: pathField, line: int('One-based line', 1, 1000000), text: str('Matching line, at most 2000 characters') })), scannedFiles: int('Files searched', 0, 100), truncated: bool('The search was bounded; refine query or continue with nextFileOffset'), nextFileOffset: nullableInteger })), tool('write', 'Create or replace a complete UTF-8 note file. One successful call creates one program-named Git commit and updates the remote branch. Overwrites file content.', { path: pathField, content: contentField, revision: revisionField, createOnly: bool('Reject an existing target instead of replacing it.') }, ['path', 'content', 'revision'], noteReceiptSchema), tool('append', 'Append text to a note, creating it if absent. One successful call creates one commit and updates the remote branch.', { path: pathField, content: contentField, revision: revisionField }, ['path', 'content', 'revision'], noteReceiptSchema), tool('edit', 'Replace an inclusive line range in a previously read file. Use endLine = startLine - 1 for insertion, or empty content for deletion. Preserves surrounding text and commits once remotely.', { path: pathField, startLine: int('First replaced line, inclusive.', 1, 1000000), endLine: int('Last replaced line, inclusive; startLine - 1 inserts.', 0, 1000000), content: contentField, revision: revisionField }, ['path', 'startLine', 'endLine', 'content', 'revision'], noteReceiptSchema), tool('mkdir', 'Create a notebook folder using a _dir.yml metadata file or update existing folder metadata. Parent directories are created as needed. Creates one remote commit.', { path: pathField, title: str('Folder display title; defaults to the basename.'), order: int('Sort order number; defaults to 0.', -1000000, 1000000), description: str('Optional folder description.'), metadata, overwrite: bool('Allow updating folder metadata if folder already exists; default false.'), revision: revisionField }, ['path', 'revision'], receiptSchema), tool('cp', 'Copy a note or, with recursive true, a note directory. Keeps the source. One atomic remote commit covers all destination files. overwrite true can replace existing notes.', transfer, ['source', 'destination', 'revision'], receiptSchema), tool('mv', 'Move or rename a note or note directory. Removes old paths and adds new paths in one atomic remote commit. Relative links keep their original file text.', transfer, ['source', 'destination', 'revision'], receiptSchema), tool('rm', 'Remove explicitly listed notes, or directories with recursive true. One atomic remote commit covers all removals. Use glob first to review the exact targets.', { paths: { ...array(pathField), minItems: 1, maxItems: 200 }, recursive: bool('Required to delete a directory and its note files.'), revision: revisionField }, ['paths', 'revision'], receiptSchema), tool('get_workspace_config', 'Read the configured workspace manifest.', {}, [], object({ config: metadata })), tool('list_notebooks', 'List configured notebooks.', {}, [], object({ notebooks: array(metadata) })), tool('list_folders', 'List notebook folder display metadata, or inspect display metadata for a specific folder if path is provided.', { path: str('Optional relative path of a specific notebook folder to inspect.') }, [], object({ folders: array(metadata) })), tool('list_notes', 'Read parsed notes and their Markdown bodies. Prefer glob then read for bounded file inspection.', { notebookId: str('Optional notebook ID.') }, [], object({ notes: array(noteSchema), count: int('Number of notes', 0, 100000) })), tool('read_note', 'Read a parsed note, including metadata and the body without frontmatter (or metadata only if metadataOnly is true). Use read for line-based edits of the complete file.', { path: pathField, metadataOnly: bool('If true, returns note metadata and valid statuses without markdown body.') }, ['path'], object({ note: noteSchema })), tool('save_note', 'Create or replace a parsed note body and optional frontmatter, or update metadata only if content is omitted. Commits once and updates the remote branch with a program-generated message.', { path: pathField, content: str('Markdown body without frontmatter; if omitted, preserves existing content and updates metadata only.'), status: str('Optional status shortcut'), tags: array(str('Tag name')), title: str('Optional note title'), revision: revisionField, metadata, createOnly: bool('Reject existing paths.') }, ['path', 'revision'], { ...noteReceiptSchema, properties: { ...noteReceiptSchema.properties, note: noteSchema }, required: [...noteReceiptSchema.required, 'note'] }), tool('render_template', "Render a notebook's configured note template, substituting {{title}} and {{date}} in its frontmatter and body. Does not write any file; pass the result to save_note with createOnly true.", { notebookId: str('Notebook identifier'), templateId: str('Template ID from the notebook configuration'), title: str('Title to substitute for {{title}}') }, ['notebookId', 'templateId', 'title'], object({ metadata, content: str('Rendered Markdown body without frontmatter') })), tool('delete_note', 'Delete a note file by path, creating an atomic commit.', { path: pathField, revision: str('Optional commit SHA. Defaults to current HEAD.') }, ['path'], object({ success: { const: true }, path: pathField, commit: object({ commitHash: str('Commit SHA'), message: str('Commit message') }, undefined, true) })), tool('list_assets', 'List notebook assets and their URLs, including the objects held in private R2 storage when it is configured. Each entry names where it lives and the reference a note links it by.', { notebookId: str('Optional notebook ID.') }, [], object({ assets: array(metadata) })), tool('add_asset', 'Upload an asset file (base64 encoded) to a notebook, with optional subfolder path. With private R2 storage configured the file goes to the bucket and the response carries an r2:<object-key> reference to put in a note; otherwise it is committed into the notebook assets directory.', { notebookId: str('Notebook identifier, e.g. default'), filename: str('Asset filename, e.g. screenshot.png'), base64Content: str('Base64-encoded binary content of the asset file'), directory: str('Optional subdirectory path within assets/ folder'), revision: str('Optional commit SHA. Defaults to current HEAD.') }, ['notebookId', 'filename', 'base64Content'], object({ success: { const: true }, storage: { type: 'string', enum: ['git', 'r2'], description: 'Where the asset was stored' }, filename: str('Asset filename'), reference: str('Link target to use in a note: an r2:<object-key> for R2, otherwise a notebook-relative path'), markdownRef: str('Markdown reference for embedding the asset'), key: str('R2 object key; present for R2 storage'), path: pathField, commit: object({ commitHash: str('Commit SHA'), message: str('Commit message') }, undefined, true) }, ['success', 'storage', 'filename', 'reference', 'markdownRef'], true)), tool('delete_asset', 'Delete an asset from a notebook. A repository path is removed in an atomic commit; an r2:<object-key> reference deletes that bucket object, which is refused while a note still links it unless force is true.', { path: str('Repository-relative asset path, or an r2:<object-key> reference.', { minLength: 1, maxLength: 1024 }), force: bool('Delete an R2 object even though notes still reference it; default false.'), revision: str('Optional commit SHA. Defaults to current HEAD.') }, ['path'], object({ success: { const: true }, storage: { type: 'string', enum: ['git', 'r2'], description: 'Where the asset was deleted from' }, path: pathField, key: str('R2 object key; present for R2 storage'), reference: str('The deleted r2:<object-key> reference; present for R2 storage'), commit: object({ commitHash: str('Commit SHA'), message: str('Commit message') }, undefined, true) }, ['success', 'storage'], true)), tool('get_statuses', 'Get all valid note statuses including default, configured, and observed statuses across notes.', { notebookId: str('Optional notebook identifier') }, [], object({ notebookId: str('Notebook identifier'), defaultStatuses: array(str('Status name')), configuredStatuses: array(str('Status name')), observedStatuses: array(str('Status name')), allStatuses: array(str('Status name')) })), tool('search_notes', 'Ranked note search for finding notes by topic, phrase, citation key, slug, tag or status. Space-separated words match independently across title, path, frontmatter and body; notes covering more words rank first, and the exact phrase ranks highest. Chinese phrases also match partially. Filters narrow before ranking; filters alone list matching notes. Returns snippets and metadata so read is needed only for chosen notes. Try synonyms or English and Chinese variants when results are weak.', { query: str('Words or phrase; optional when a filter is given. With isRegex, a regular expression over title and body.', { maxLength: 1000 }), notebookId: str('Optional notebook identifier to search within'), status: str('Optional exact frontmatter status, e.g. reading'), tags: array(str('Tag that must be present (case-insensitive)')), pattern: patternField, isRegex: bool('Whether query is a regular expression; default false'), caseSensitive: bool('Whether search is case-sensitive; default false'), limit: int('Maximum ranked notes returned; default 20.', 1, 200) }, [], object({ query: str('Search query'), isRegex: bool('Whether query was treated as regex'), matches: array(object({ path: pathField, title: str('Note title'), notebookId: str('Notebook identifier'), status: { type: ['string', 'null'], description: 'Note status' }, tags: array(str('Tag')), matchCount: int('Number of title and body matches for query words', 0, Number.MAX_SAFE_INTEGER), score: { type: 'number', description: 'Relevance score; higher is better' }, matchedTerms: array(str('Matched query term')), snippet: str('Best matching body line, at most 240 characters') })), total: int('Notes matching before the limit', 0, 1000000), truncated: bool('More matching notes exist beyond limit'), totalMatches: int('Total title and body match count across returned notes', 0, Number.MAX_SAFE_INTEGER) })), tool('replace_notes', 'Search and replace text or regular expressions across note files with atomic commit support.', { search: str('Search text or regular expression to match'), replace: str('Replacement text (supports $1, $2 capture groups for regex)'), notebookId: str('Optional notebook identifier to limit replacement scope'), isRegex: bool('Whether search is a regular expression; default false'), caseSensitive: bool('Whether search is case-sensitive; default false'), dryRun: bool('If true, previews matches without saving or committing; default false'), revision: str('Optional commit SHA. Defaults to current HEAD.') }, ['search', 'replace'], object({ success: bool('Success status'), dryRun: bool('Dry run flag'), search: str('Search pattern'), replace: str('Replacement text'), matchedFiles: array(pathField), totalFiles: int('Count of matched files', 0, 100000), commit: object({ commitHash: str('Commit SHA'), message: str('Commit message') }, undefined, true) }, ['success', 'dryRun', 'search', 'replace', 'matchedFiles', 'totalFiles']))];

function validate(value: unknown, schema: Schema, label: string) {
  if (schema.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object.`);
    const object = value as Record<string, unknown>;
    for (const key of schema.required || []) if (!Object.hasOwn(object, key)) throw new Error(`${label}.${key} is required.`);
    for (const [key, item] of Object.entries(object)) {
      const child = schema.properties?.[key];
      if (child) validate(item, child, `${label}.${key}`);
      else if (schema.additionalProperties === false) throw new Error(`Unknown argument ${key}.`);
    }
  } else if (schema.type === 'array') {
    if (!Array.isArray(value) || (schema.minItems !== undefined && value.length < schema.minItems) || (schema.maxItems !== undefined && value.length > schema.maxItems)) throw new Error(`${label} has an invalid array length.`);
    value.forEach((item, index) => validate(item, schema.items, `${label}[${index}]`));
  } else if (schema.type === 'string') {
    if (typeof value !== 'string' || (schema.minLength !== undefined && value.length < schema.minLength) || (schema.maxLength !== undefined && value.length > schema.maxLength)) throw new Error(`${label} has an invalid string value.`);
  } else if (schema.type === 'boolean') {
    if (typeof value !== 'boolean') throw new Error(`${label} must be boolean.`);
  } else if (schema.type === 'integer') {
    if (!Number.isInteger(value) || Number(value) < schema.minimum || Number(value) > schema.maximum) throw new Error(`${label} is outside its integer range.`);
  }
}

/** A note write also reports where the note lives: its path and, when the app origin is known, its web page. */
export async function callRemoteTool(reader: RemoteSource, name: string, args: Record<string, unknown>, write: boolean, appUrl?: string): Promise<Record<string, unknown>> {
  const result = await runRemoteTool(reader, name, args, write);
  if (!noteWriteTools.has(name)) return result;
  const file = (result.changedPaths as string[])[0];
  const notebook = (await reader.config()).notebooks.find((nb) => file.startsWith(`${nb.root}/`));
  const url = appUrl && notebook && path.posix.basename(file) !== '_dir.yml' ? appUrl.replace(/\/$/, '') + noteWebPath(notebook.id, file.slice(notebook.root.length + 1)) : undefined;
  return { ...result, path: file, ...(url ? { url } : {}) };
}

async function runRemoteTool(reader: RemoteSource, name: string, args: Record<string, unknown>, write: boolean): Promise<Record<string, unknown>> {
  const definition = remoteTools.find((t) => t.name === name) || legacyRemoteTools.find((t) => t.name === name);
  if (!definition) throw new Error('This operation is unavailable for a remote source.');
  validate(args, definition.inputSchema, 'arguments');
  if (isMutationTool(name) && !write) throw new Error('This agent grant is read-only.');

  switch (name) {
    case 'get_workspace_config':
      return { config: await reader.config() };
    case 'list_notebooks':
      return { notebooks: (await reader.config()).notebooks };
    case 'list_folders': {
      if (args.path) {
        const folders = await reader.folders();
        const norm = String(args.path).replace(/\/(_dir\.yml)?$/, '');
        const folder = folders.find((f) => f.path === norm || `${f.notebookId}/${f.path}` === norm || norm.endsWith(`/${f.path}`));
        if (!folder) throw new Error(`Folder not found: ${args.path}`);
        return { ...folder, path: norm };
      }
      return { folders: await reader.folders() };
    }
    case 'get_folder_metadata': {
      const folders = await reader.folders();
      const norm = String(args.path).replace(/\/(_dir\.yml)?$/, '');
      const folder = folders.find((f) => f.path === norm || `${f.notebookId}/${f.path}` === norm || norm.endsWith(`/${f.path}`));
      if (!folder) throw new Error(`Folder not found: ${args.path}`);
      return { ...folder, path: norm };
    }
    case 'list_notes': {
      const notes = await reader.notes(args.notebookId as string | undefined);
      return { notes, count: notes.length };
    }
    case 'read_note': {
      if (args.metadataOnly) {
        const note = await reader.note(String(args.path));
        const config = await reader.config();
        const nb = config.notebooks.find((n) => n.id === note.notebookId);
        const availableStatuses = nb?.statuses && nb.statuses.length > 0 ? nb.statuses : ['inbox', 'working', 'done', 'archived'];
        return { path: note.path, notebookId: note.notebookId, title: note.title, status: note.status || null, tags: note.tags, metadata: note.metadata, revision: note.revision, availableStatuses };
      }
      return { note: await reader.note(String(args.path)) };
    }
    case 'save_note': {
      if (args.content === undefined) {
        const note = await reader.note(String(args.path));
        const config = await reader.config();
        const nb = config.notebooks.find((n) => n.id === note.notebookId);
        const availableStatuses = nb?.statuses && nb.statuses.length > 0 ? nb.statuses : ['inbox', 'working', 'done', 'archived'];
        if (args.status !== undefined && args.status !== '' && !availableStatuses.includes(String(args.status))) {
          throw new Error(`Invalid status '${args.status}'. Available statuses: ${availableStatuses.join(', ')}`);
        }
        let newMetadata: Record<string, unknown> = { ...note.metadata, ...args.metadata as Record<string, unknown> };
        if (args.status !== undefined) newMetadata = withNoteStatus(newMetadata, String(args.status));
        if (args.tags !== undefined) newMetadata.tags = args.tags;
        if (args.title !== undefined) newMetadata.title = args.title;
        const snapshot = await reader.getSnapshot();
        const rev = String(args.revision || snapshot.sha);
        return reader.save(note.path, note.content, newMetadata, rev, false);
      }
      let finalMetadata = args.metadata as Record<string, unknown> | undefined;
      if (args.status !== undefined || args.tags !== undefined || args.title !== undefined) {
        finalMetadata = { ...finalMetadata };
        if (args.status !== undefined) finalMetadata = withNoteStatus(finalMetadata, String(args.status));
        if (args.tags !== undefined) finalMetadata.tags = args.tags;
        if (args.title !== undefined) finalMetadata.title = args.title;
      }
      return reader.save(String(args.path), String(args.content), finalMetadata, String(args.revision), args.createOnly === true);
    }
    case 'delete_note': {
      const snapshot = await reader.getSnapshot();
      const rev = String(args.revision || snapshot.sha);
      const receipt = await reader.commitChanges([{ path: String(args.path), sha: null }], rev, 'delete', 'notes');
      return { success: true, path: String(args.path), commit: receipt.commit };
    }
    case 'render_template':
      return reader.renderTemplate(String(args.notebookId), String(args.templateId), String(args.title));
    case 'list_assets': {
      const config = await reader.config();
      const ids = config.notebooks.filter((n) => !args.notebookId || n.id === args.notebookId).map((n) => n.id);
      return { assets: [...(await reader.assets(args.notebookId as string | undefined)).map((asset) => ({ storage: 'git', ...asset })), ...await listR2Assets(ids) || []] };
    }
    case 'add_asset': {
      const config = await reader.config();
      const nb = config.notebooks.find((n) => n.id === args.notebookId) || config.notebooks[0];
      const uploaded = await uploadR2Asset(nb.id, args as unknown as AssetUpload);
      if (uploaded) return uploaded;
      const snapshot = await reader.getSnapshot();
      const rev = String(args.revision || snapshot.sha);
      const res = await reader.mutateAsset('upload', { ...args, revision: rev });
      const dest = String(res.path);
      const markdownRel = dest.slice(nb.root.length + 1);
      return { ...res, storage: 'git', filename: path.posix.basename(dest), path: dest, reference: markdownRel, markdownRef: `![${path.posix.basename(dest)}](${markdownRel})` };
    }
    case 'delete_asset': {
      const config = await reader.config();
      const removed = await deleteR2Asset(String(args.path), config.notebooks.map((n) => n.id), async () => new Map((await reader.notes()).map((note) => [note.path, note.content])), args.force === true);
      if (removed) return removed;
      const snapshot = await reader.getSnapshot();
      const rev = String(args.revision || snapshot.sha);
      const res = await reader.mutateAsset('delete', { ...args, revision: rev });
      return { success: true, storage: 'git', path: String(args.path), commit: res.commit };
    }
    case 'get_statuses': {
      const config = await reader.config();
      const defaultStatuses = ['inbox', 'working', 'done', 'archived'];
      const nb = args.notebookId ? config.notebooks.find((n) => n.id === args.notebookId) : config.notebooks[0];
      const configuredStatuses = nb?.statuses && nb.statuses.length > 0 ? nb.statuses : defaultStatuses;
      const notes = await reader.notes(args.notebookId as string | undefined);
      const observedStatuses = Array.from(new Set(notes.map((n) => n.status).filter(Boolean))) as string[];
      const allStatuses = Array.from(new Set([...configuredStatuses, ...observedStatuses]));
      return { notebookId: nb?.id || 'default', defaultStatuses, configuredStatuses, observedStatuses, allStatuses };
    }
    case 'get_note_metadata': {
      const note = await reader.note(String(args.path));
      const config = await reader.config();
      const nb = config.notebooks.find((n) => n.id === note.notebookId);
      const availableStatuses = nb?.statuses && nb.statuses.length > 0 ? nb.statuses : ['inbox', 'working', 'done', 'archived'];
      return { path: note.path, notebookId: note.notebookId, title: note.title, status: note.status || null, tags: note.tags, metadata: note.metadata, revision: note.revision, availableStatuses };
    }
    case 'update_note_metadata': {
      const note = await reader.note(String(args.path));
      const config = await reader.config();
      const nb = config.notebooks.find((n) => n.id === note.notebookId);
      const availableStatuses = nb?.statuses && nb.statuses.length > 0 ? nb.statuses : ['inbox', 'working', 'done', 'archived'];
      if (args.status !== undefined && args.status !== '' && !availableStatuses.includes(String(args.status))) {
        throw new Error(`Invalid status '${args.status}'. Available statuses: ${availableStatuses.join(', ')}`);
      }
      let newMetadata: Record<string, unknown> = { ...note.metadata, ...args.metadata as Record<string, unknown> };
      if (args.status !== undefined) newMetadata = withNoteStatus(newMetadata, String(args.status));
      if (args.tags !== undefined) newMetadata.tags = args.tags;
      if (args.title !== undefined) newMetadata.title = args.title;
      if (args.hidden !== undefined) newMetadata.hiden = Boolean(args.hidden);
      const snapshot = await reader.getSnapshot();
      const rev = String(args.revision || snapshot.sha);
      return reader.save(note.path, note.content, newMetadata, rev, false);
    }
    case 'search_notes': {
      const notes = await reader.notes(args.notebookId as string | undefined);
      const result = searchNotes(notes, args as NoteSearchOptions);
      return { query: String(args.query ?? ''), isRegex: Boolean(args.isRegex), ...result, totalMatches: result.matches.reduce((acc, m) => acc + m.matchCount, 0) };
    }
    case 'replace_notes': {
      const notes = await reader.notes(args.notebookId as string | undefined);
      const search = String(args.search);
      const replace = String(args.replace);
      const isRegex = Boolean(args.isRegex);
      const caseSensitive = Boolean(args.caseSensitive);
      const dryRun = Boolean(args.dryRun);
      let regex: RegExp;
      if (isRegex) {
        regex = new RegExp(search, caseSensitive ? 'g' : 'gi');
      } else {
        const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        regex = new RegExp(escaped, caseSensitive ? 'g' : 'gi');
      }
      const modified: { path: string; metadata: any; content: string; }[] = [];
      for (const note of notes) {
        if (regex.test(note.content)) {
          regex.lastIndex = 0;
          const newContent = note.content.replace(regex, replace);
          modified.push({ path: note.path, metadata: note.metadata, content: newContent });
        }
      }
      if (dryRun) {
        return { success: true, dryRun: true, search, replace, matchedFiles: modified.map((n) => n.path), totalFiles: modified.length };
      }
      if (modified.length === 0) {
        return { success: true, dryRun: false, search, replace, matchedFiles: [], totalFiles: 0 };
      }
      const snapshot = await reader.getSnapshot();
      const rev = String(args.revision || snapshot.sha);
      const changes = modified.map((n) => ({ path: n.path, content: serializeNoteContent(n.metadata, n.content, false) }));
      const receipt = await reader.commitChanges(changes, rev, 'replace', 'notes', `docs(notes): replace "${search}" across ${modified.length} notes`);
      return { success: true, dryRun: false, search, replace, matchedFiles: modified.map((n) => n.path), totalFiles: modified.length, commit: receipt.commit };
    }
    default:
      return callNoteShell(reader, name, args, write);
  }
}
