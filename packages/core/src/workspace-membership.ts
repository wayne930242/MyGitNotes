import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import YAML from 'yaml';
import { loadedWorkspaceConfigFile } from './config.js';
import { SourceError } from './github-api.js';
import { deriveAlias, repositoryName } from './notebook-key.js';
import { type RepositoryId, repositoryRef } from './repository.js';
import { normalizeNotebookFolder } from './source-config.js';
import { type DeploymentMembers, environmentSetting, type MembershipStore, type NewMember, readDeploymentMembers, sameMember, type WorkspaceMember } from './workspace-config-source.js';

/** Why a membership change was refused; the browser tells a stale read (`stale`) from a refusal. */
export type MembershipErrorCode = 'stale' | 'not-member' | 'duplicate' | 'default-hidden' | 'default-removed' | 'environment' | 'not-worktree' | 'folder-required' | 'folder-unused' | 'invalid';

export class MembershipError extends SourceError {
  constructor(readonly code: MembershipErrorCode, message: string, status = 422) {
    super(message, status);
  }
}

const memberOf = (members: WorkspaceMember[], id: RepositoryId) => {
  const found = members.find(member => member.ref.id === id);
  if (!found) throw new MembershipError('not-member', 'That repository is not a member of this workspace.', 404);
  return found;
};
/** Whether a member is the visible default. */
const visibleDefault = (members: WorkspaceMember[]) => members.find(member => member.default && !member.hidden);

/**
 * The membership after `candidate` joins at the end. A repository is a member once, even on two branches; its alias
 * derives from its name, avoiding only the current members' aliases (a removed member's alias is free again, decision
 * C11). It becomes the default when no visible member is (an empty workspace, or one whose every member is hidden).
 */
export function withMemberAdded(members: WorkspaceMember[], candidate: Omit<WorkspaceMember, 'alias' | 'default' | 'hidden'>): { members: WorkspaceMember[]; member: WorkspaceMember; } {
  const twice = members.find(member => sameMember(member, candidate));
  if (twice) throw new MembershipError('duplicate', `${twice.ref.source.type === 'local' ? twice.localPath ?? twice.ref.id : twice.ref.id} is already a member of this workspace as ${twice.alias}.`);
  const alias = deriveAlias(repositoryName(candidate.ref.source), new Set(members.map(member => member.alias)));
  const isDefault = !visibleDefault(members);
  const member: WorkspaceMember = { ...candidate, alias, default: isDefault, hidden: false };
  return { members: [...members.map(existing => isDefault ? { ...existing, default: false } : existing), member], member };
}

/**
 * The membership without one member. A member the deployment's environment names cannot be removed here
 * (`environment` names the setting to change, decision C9); the default only when it is the last member, which leaves
 * the workspace empty (decision C8). The server never picks another default.
 */
export function withMemberRemoved(members: WorkspaceMember[], id: RepositoryId, environment = 'the deployment configuration'): WorkspaceMember[] {
  const member = memberOf(members, id);
  if (member.editable === 'environment') throw new MembershipError('environment', `${member.alias} is the repository the deployment names with ${environment}, so Settings cannot remove it. Change ${environment} and restart the server.`);
  if (member.default && members.length > 1) throw new MembershipError('default-removed', `${member.alias} is the default repository. Make another repository the default first.`);
  return members.filter(other => other !== member);
}

/**
 * The membership with one member hidden or shown. The default cannot be hidden; a member shown while no visible member
 * is the default becomes it (decision C8).
 */
export function withMemberHidden(members: WorkspaceMember[], id: RepositoryId, hidden: boolean): WorkspaceMember[] {
  const member = memberOf(members, id);
  if (hidden && member.default) throw new MembershipError('default-hidden', `${member.alias} is the default repository, which cannot be hidden. Make another repository the default first.`);
  if (hidden) return members.map(other => other === member ? { ...other, hidden: true } : other);
  const becomesDefault = !visibleDefault(members);
  return members.map(other => other === member ? { ...other, hidden: false, default: other.default || becomesDefault } : becomesDefault ? { ...other, default: false } : other);
}

/** The membership with one member the default, shown if it was hidden. */
export function withDefaultMember(members: WorkspaceMember[], id: RepositoryId): WorkspaceMember[] {
  const member = memberOf(members, id);
  return members.map(other => other === member ? { ...other, default: true, hidden: false } : { ...other, default: false });
}

/** The membership in the order `order` names, which must name every member once. */
export function withMembersReordered(members: WorkspaceMember[], order: RepositoryId[]): WorkspaceMember[] {
  if (!Array.isArray(order) || order.length !== members.length || new Set(order).size !== order.length) throw new MembershipError('invalid', 'Name every member once to reorder them.', 400);
  return order.map(id => memberOf(members, id));
}

/** The membership with one member's notebook folder set. */
export function withMemberFolder(members: WorkspaceMember[], id: RepositoryId, folder: string): WorkspaceMember[] {
  const member = memberOf(members, id);
  let normalized: string;
  try {
    normalized = normalizeNotebookFolder(folder);
  } catch (error) {
    throw new MembershipError('invalid', (error as Error).message, 400);
  }
  return members.map(other => other === member ? { ...other, folder: normalized } : other);
}

/** A server configuration's revision: a hash of its text, or `none` while there is no file. */
export const serverConfigRevision = (text: string | null) => text === null ? 'none' : `sha256:${createHash('sha256').update(text).digest('hex')}`;

const readText = (file: string) => {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
};

/** Writes a file through a temporary file in its directory and a rename, so a reader never sees half of it. */
function writeAtomic(file: string, text: string) {
  const temporary = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.${Date.now()}.tmp`);
  const mode = fs.existsSync(file) ? fs.statSync(file).mode : 0o644;
  try {
    fs.writeFileSync(temporary, text, { mode });
    fs.renameSync(temporary, file);
  } catch (error) {
    fs.rmSync(temporary, { force: true });
    throw error;
  }
}

/**
 * Whether the environment's member, which has no entry, needs one to keep its state: it is hidden, has a folder, is not
 * first (where a member without an entry stands), or its alias would derive differently from the aliases stored.
 */
function environmentNeedsEntry(member: WorkspaceMember, next: WorkspaceMember[]): boolean {
  const stored = new Set(next.filter(other => other !== member).map(other => other.alias));
  return member.hidden || Boolean(member.folder) || next[0] !== member || deriveAlias(repositoryName(member.ref.source), stored) !== member.alias;
}

/**
 * The server configuration text with `repositories` set to `next`, editing the YAML document so its other keys and
 * comments stay (a comment on the `repositories:` line itself moves to the line below it). Each entry gets its
 * member's alias stored, so later changes never shift a derived alias. The environment's member gets an entry naming
 * its worktree only when its state needs one; otherwise it stays first with the alias it derives first.
 */
export function serverConfigWithMembers(text: string | null, current: DeploymentMembers, next: WorkspaceMember[]): string {
  const document = text === null || !text.trim() ? new YAML.Document({}) : YAML.parseDocument(text);
  if (document.errors.length) throw new SourceError(`The server configuration does not parse: ${document.errors[0].message}`, 503);
  let listed = document.get('repositories', true);
  if (!YAML.isSeq(listed)) {
    listed = document.createNode([]) as YAML.YAMLSeq;
    document.set('repositories', listed);
  }
  const seq = listed as YAML.YAMLSeq;
  const items = [...seq.items];
  const entryOf = new Map(current.members.map((member, position) => [member.ref.id, current.entries[position]]));
  seq.items = next.flatMap(member => {
    const index = entryOf.get(member.ref.id);
    if (index === undefined && member.editable === 'environment' && !environmentNeedsEntry(member, next)) return [];
    const node = (index === undefined ? document.createNode({ type: 'local', path: member.localPath }) : items[index]) as YAML.YAMLMap;
    node.set('alias', member.alias);
    for (const [key, value] of [['default', member.default], ['hidden', member.hidden]] as const) {
      if (value) node.set(key, true);
      else node.delete(key);
    }
    if (member.folder) node.set('folder', member.folder);
    else node.delete('folder');
    return [node];
  });
  // A comment above the first entry belongs to the list in the document; it stays with that entry when it moves.
  const first = items[0] as YAML.YAMLMap | undefined;
  if (seq.commentBefore && first && seq.items[0] !== first && seq.items.includes(first)) {
    first.commentBefore = [seq.commentBefore, first.commentBefore].filter(Boolean).join('\n');
    seq.commentBefore = undefined;
  }
  return document.toString();
}

/** Mutations of one server configuration file, in this process, one after another. */
const queues = new Map<string, Promise<unknown>>();
async function serialized<T>(file: string, action: () => Promise<T>): Promise<T> {
  const next = (queues.get(file) ?? Promise.resolve()).catch(() => undefined).then(action);
  queues.set(file, next);
  try {
    return await next;
  } finally {
    if (queues.get(file) === next) queues.delete(file);
  }
}

/** A worktree path a person typed: absolute, or under their home directory with `~/`. */
function worktreePath(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new MembershipError('invalid', 'Enter the path of a Git worktree.', 400);
  const typed = value.trim();
  const expanded = typed === '~' ? os.homedir() : typed.startsWith('~/') ? path.join(os.homedir(), typed.slice(2)) : typed;
  if (!path.isAbsolute(expanded)) throw new MembershipError('invalid', 'Enter the absolute path of the worktree.', 400);
  return path.resolve(expanded);
}

/**
 * A local deployment's membership, kept in its server configuration (`mygitnotes.server.yaml`). Each change reads the
 * file, refuses with 409 when its revision is not the one the change was read at, applies the change to the members
 * the file and the environment give, and writes the file back atomically, keeping its other keys and comments.
 */
export function serverFileMembership(base: string, env: NodeJS.ProcessEnv = process.env): MembershipStore {
  const change = (revision: string, apply: (members: WorkspaceMember[]) => WorkspaceMember[]) => {
    const { file } = readDeploymentMembers(base, env);
    return serialized(file, async () => {
      const text = readText(file);
      if (revision !== serverConfigRevision(text)) throw new MembershipError('stale', `${file} changed since the repositories were read. Reload them and try again.`, 409);
      const current = readDeploymentMembers(base, env);
      const written = serverConfigWithMembers(text, current, apply(current.members));
      writeAtomic(file, written);
      return { revision: serverConfigRevision(written) };
    });
  };
  return {
    revision: async () => serverConfigRevision(readText(readDeploymentMembers(base, env).file)),
    async add(candidate: NewMember, revision) {
      const worktree = worktreePath(candidate.localPath);
      if (!fs.existsSync(path.join(worktree, '.git'))) throw new MembershipError('not-worktree', `${worktree} is not the root of a Git worktree.`);
      const hasManifest = Boolean(loadedWorkspaceConfigFile(worktree));
      let folder: string | undefined;
      if (candidate.folder !== undefined && candidate.folder !== '') {
        if (hasManifest) throw new MembershipError('folder-unused', `${worktree} has a manifest, which names its notebooks. Leave the folder empty.`);
        try {
          folder = normalizeNotebookFolder(candidate.folder);
        } catch (error) {
          throw new MembershipError('invalid', (error as Error).message, 400);
        }
      } else if (!hasManifest) throw new MembershipError('folder-required', `${worktree} has no manifest. Choose the folder its notebook uses.`);
      let added: WorkspaceMember | undefined;
      const result = await change(revision, members => {
        const next = withMemberAdded(members, { ref: repositoryRef({ type: 'local', path: worktree }), localPath: worktree, ...(folder ? { folder } : {}), editable: 'server-file' });
        added = next.member;
        return next.members;
      });
      return { ...result, member: added! };
    },
    remove: (id, revision) => change(revision, members => withMemberRemoved(members, id, environmentSetting(base, env))),
    setHidden: (id, hidden, revision) => change(revision, members => withMemberHidden(members, id, hidden)),
    setDefault: (id, revision) => change(revision, members => withDefaultMember(members, id)),
    reorder: (order, revision) => change(revision, members => withMembersReordered(members, order)),
    setFolder: (id, folder, revision) => change(revision, members => withMemberFolder(members, id, folder)),
    environment: () => environmentSetting(base, env),
  };
}
