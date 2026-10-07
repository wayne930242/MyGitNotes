import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { z } from 'zod';

/**
 * Versions a person records for a file, kept in one Git-tracked version file per file under `VERSION_ROOT`
 * of the file's repository. The file itself never carries them, so recording a version never commits it again.
 */
export const VERSION_ROOT = '.mygitnotes/versions';
export const VERSION_FILE_MAX_BYTES = 256 * 1024;
export const VERSION_NAME_MAX = 80;
export const VERSION_NOTE_MAX = 2000;
/** The trailer that marks a commit an agent made through MCP for one file's content. */
export const AGENT_EDIT_TRAILER = 'Agent-Edit';

const objectId = z.string().regex(/^[a-f0-9]{40}([a-f0-9]{24})?$/);
/** A day as `YYYY-MM-DD`. */
const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * One version of a file. `commit` names a commit that already existed when the version was recorded. A version
 * recorded in the same commit as the file's change cannot name that commit, whose id depends on its own content,
 * so it names `parent`, the branch head that commit was made on. A rebase of unpushed commits changes both ids but
 * keeps author dates, so `authored` (the commit's author date, which the app sets when it makes the commit) finds it
 * again; `blob` (the file's Git object id) is the last resort.
 */
export const NoteVersionSchema = z.object({ blob: objectId, commit: objectId.optional(), parent: objectId.optional(), authored: z.string().datetime({ offset: true }), sequence: z.number().int().min(1).max(1_000_000), date: z.string().regex(/^\d{4}\.\d{2}\.\d{2}(-\d{1,6})?$/), name: z.string().max(VERSION_NAME_MAX).regex(/^[^\r\n]*$/).optional(), note: z.string().max(VERSION_NOTE_MAX).optional(), created: z.string().datetime() }).refine(version => Boolean(version.commit) !== Boolean(version.parent), { message: 'A version names either its commit or its parent.' });
export type NoteVersion = z.infer<typeof NoteVersionSchema>;
export const NoteVersionFileSchema = z.object({ versions: z.array(NoteVersionSchema).max(5000) });
export type NoteVersionFile = z.infer<typeof NoteVersionFileSchema>;

/** The name and note a person gives a version; empty text clears either. */
export const VersionLabelSchema = z.object({ name: z.string().trim().max(VERSION_NAME_MAX).regex(/^[^\r\n]*$/).optional(), note: z.string().max(VERSION_NOTE_MAX).optional() });
export type VersionLabel = z.infer<typeof VersionLabelSchema>;

/** One commit of a file's history, newest first in a listing. */
export interface HistoryEntry {
  commit: string;
  parents: string[];
  /** ISO 8601 author date. */
  date: string;
  author: string;
  subject: string;
  body: string;
  /** The file's path in this commit; differs from the current path before a move. */
  path: string;
  /** The file's Git object id in this commit, when the source lists it. */
  blob?: string;
  /** Whether an agent made this commit through MCP. */
  agent: boolean;
}

export function versionFilePath(file: string): string {
  return `${VERSION_ROOT}/${file}.yaml`;
}

/** The file a version file records, or undefined for any other path. */
export function versionedPath(file: string): string | undefined {
  if (!file.startsWith(`${VERSION_ROOT}/`) || !file.endsWith('.yaml')) return;
  const target = file.slice(VERSION_ROOT.length + 1, -'.yaml'.length);
  return target && !target.split('/').some(part => !part || part === '.' || part === '..') ? target : undefined;
}

export const isVersionFile = (file: string) => file === VERSION_ROOT || file.startsWith(`${VERSION_ROOT}/`) || file === '.mygitnotes';

/** Reads a version file; null content is a file without versions. */
export function readVersionFile(content: string | null): NoteVersionFile {
  if (content === null) return { versions: [] };
  if (new TextEncoder().encode(content).length > VERSION_FILE_MAX_BYTES) throw new Error('This file has too many versions. Delete old versions first.');
  return NoteVersionFileSchema.parse(parseYaml(content, { maxAliasCount: 20 }) ?? { versions: [] });
}

export function serializeVersionFile(value: NoteVersionFile): string {
  const yaml = stringifyYaml(NoteVersionFileSchema.parse(value), { lineWidth: 0 });
  if (new TextEncoder().encode(yaml).length > VERSION_FILE_MAX_BYTES) throw new Error('This file has too many versions. Delete old versions first.');
  return yaml;
}

/** `today` as a version date number, `YYYY.MM.DD`. */
function dateNumber(today: string): string {
  const match = DAY.exec(today);
  if (!match) throw new Error('A day is written as YYYY-MM-DD.');
  return `${match[1]}.${match[2]}.${match[3]}`;
}

/** The numbers the next version of a file gets: the next sequence number, and today's date with a counter after the first. */
export function nextVersionNumbers(versions: readonly Pick<NoteVersion, 'sequence' | 'date'>[], today: string): { sequence: number; date: string; } {
  const base = dateNumber(today);
  let count = 0;
  for (const version of versions) {
    if (version.date === base) count = Math.max(count, 1);
    else if (version.date.startsWith(`${base}-`)) count = Math.max(count, Number(version.date.slice(base.length + 1)));
  }
  return { sequence: versions.reduce((max, version) => Math.max(max, version.sequence), 0) + 1, date: count ? `${base}-${count + 1}` : base };
}

/** Records a version for `blob` at `commit` or after `parent`; refuses a second version of the same commit. */
export function addVersion(file: NoteVersionFile, target: { blob: string; commit?: string; parent?: string; authored: string; }, label: VersionLabel, today: string, now = new Date()): NoteVersion {
  if (file.versions.some(version => target.commit ? version.commit === target.commit : version.parent === target.parent)) throw new Error('This commit already is a version.');
  const version = NoteVersionSchema.parse({ ...target, ...nextVersionNumbers(file.versions, today), ...cleanLabel(label), created: now.toISOString() });
  file.versions.push(version);
  return version;
}

function cleanLabel(label: VersionLabel): VersionLabel {
  const name = label.name?.trim(), note = label.note?.replace(/\s+$/, '');
  return { ...(name ? { name } : {}), ...(note ? { note } : {}) };
}

/** Changes a version's name and note; the numbers never change. */
export function relabelVersion(file: NoteVersionFile, sequence: number, label: VersionLabel): NoteVersion {
  const index = file.versions.findIndex(version => version.sequence === sequence);
  if (index < 0) throw new Error('This version no longer exists.');
  const { name: _name, note: _note, ...rest } = file.versions[index];
  file.versions[index] = NoteVersionSchema.parse({ ...rest, ...cleanLabel(label) });
  return file.versions[index];
}

export function removeVersion(file: NoteVersionFile, sequence: number): void {
  const index = file.versions.findIndex(version => version.sequence === sequence);
  if (index < 0) throw new Error('This version no longer exists.');
  file.versions.splice(index, 1);
}

/**
 * The listed history entry each version belongs to: by commit, else as the child of its parent, else by author date
 * (which a rebase keeps), else by content, choosing the entry nearest to when the version was recorded. A version
 * whose entry is not listed is left out.
 */
export function placeVersions<T extends Pick<HistoryEntry, 'commit' | 'parents' | 'blob' | 'date'>>(versions: readonly NoteVersion[], entries: readonly T[]): Map<string, NoteVersion[]> {
  const placed = new Map<string, NoteVersion[]>();
  for (const version of versions) {
    let entry = version.commit ? entries.find(candidate => candidate.commit === version.commit) : entries.find(candidate => candidate.parents[0] === version.parent);
    if (!entry) {
      const authored = Math.floor(Date.parse(version.authored) / 1000);
      entry = entries.find(candidate => Math.floor(Date.parse(candidate.date) / 1000) === authored);
    }
    if (!entry) {
      const created = Date.parse(version.created);
      entry = entries.filter(candidate => candidate.blob === version.blob).sort((a, b) => Math.abs(Date.parse(a.date) - created) - Math.abs(Date.parse(b.date) - created))[0];
    }
    if (entry) placed.set(entry.commit, [...placed.get(entry.commit) ?? [], version]);
  }
  return placed;
}

/** A UTC day as `YYYY-MM-DD`. */
export function utcDay(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** Marks a commit message as an agent's edit of one file: the subject names the agent and day, and a trailer repeats the day. */
export function agentEditMessage(message: string, now = new Date()): string {
  const day = utcDay(now);
  const [subject, ...rest] = message.trim().split('\n');
  const body = rest.join('\n').trim();
  const trailer = `${AGENT_EDIT_TRAILER}: ${day}`;
  const paragraphs = body ? body.split(/\n{2,}/) : [];
  const last = paragraphs.at(-1);
  // Join an existing trailer block instead of starting a second one.
  if (last && last.split('\n').every(line => /^[A-Za-z][A-Za-z0-9-]*: /.test(line))) paragraphs[paragraphs.length - 1] = `${last}\n${trailer}`;
  else paragraphs.push(trailer);
  return `${subject} (Agent, ${day})\n\n${paragraphs.join('\n\n')}`;
}

export function isAgentEdit(message: string): boolean {
  return new RegExp(`^${AGENT_EDIT_TRAILER}: \\d{4}-\\d{2}-\\d{2}$`, 'm').test(message);
}

/**
 * Where version files move when files move: each version file follows its file through `relocate`, and goes away
 * with a file `removed` reports deleted. Returns the version files that move (`to`) or are deleted (`to: null`).
 */
export function relocateVersionFiles(versionFiles: Iterable<string>, relocate: (file: string) => string, removed: (file: string) => boolean): { from: string; to: string | null; }[] {
  const changes: { from: string; to: string | null; }[] = [];
  for (const versionFile of versionFiles) {
    const file = versionedPath(versionFile);
    if (!file) continue;
    if (removed(file)) changes.push({ from: versionFile, to: null });
    else {
      const next = relocate(file);
      if (next !== file) changes.push({ from: versionFile, to: versionFilePath(next) });
    }
  }
  return changes;
}

/**
 * The commit changes that carry the version files of `files` along a remote move or deletion: a moved version file
 * keeps its object, and a deleted file's version file goes with it.
 */
export function versionFileChanges(entries: readonly { path: string; sha: string; type: string; }[], files: Iterable<string>, relocate: (file: string) => string, removed: (file: string) => boolean): { path: string; sha: string | null; }[] {
  const present = new Map(entries.filter(entry => entry.type === 'blob').map(entry => [entry.path, entry.sha]));
  const versionFiles = [...new Set([...files].map(versionFilePath))].filter(file => present.has(file));
  return relocateVersionFiles(versionFiles, relocate, removed).flatMap(({ from, to }) => to ? [{ path: to, sha: present.get(from)! }, { path: from, sha: null }] : [{ path: from, sha: null }]);
}
