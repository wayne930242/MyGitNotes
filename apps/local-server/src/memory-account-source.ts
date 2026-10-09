import { assertVisibleLimit, memberManifest, MembershipError, type MembershipLimit, type MembershipStore, type RepositoryId, sameSite, SourceError, visibleCount, withDefaultMember, withMemberAdded, withMemberFolder, withMemberHidden, withMemberRemoved, withMembersReordered, type WorkspaceConfigSource, type WorkspaceMember, type WorkspaceRequest, type WorkspaceSite } from '@mygitnotes/core';

/** How the in-memory reference store finds a request's person, and the limit it applies. */
export interface MemoryAccountOptions {
  /** The person a request belongs to, from `request.person` or a browser session; undefined when nobody is signed in. */
  personOf(request: WorkspaceRequest): Promise<string | undefined>;
  /** The workspace's site; github.com by default. */
  site?: WorkspaceSite;
  /** The visible limit, read on every change; null for none. */
  limit?(): Omit<MembershipLimit, 'visible'> | null;
}

/**
 * A configuration source that keeps each person's repositories in memory, the reference for the membership store an
 * edition with accounts supplies: platform repositories the members route checked, every member `editable: 'account'`,
 * changes checked against a revision per person, decision C8 by the shared change functions, and the visible limit.
 */
export function memoryAccountSource({ personOf, site = { type: 'github' }, limit = () => null }: MemoryAccountOptions): WorkspaceConfigSource {
  const accounts = new Map<string, { revision: number; members: WorkspaceMember[]; }>();
  /** The request's person's repositories; nobody's, and unchangeable, for a request nobody signed in to. */
  const account = async (request: WorkspaceRequest) => {
    const person = await personOf(request);
    if (!person) return null;
    if (!accounts.has(person)) accounts.set(person, { revision: 0, members: [] });
    return accounts.get(person)!;
  };
  const signedIn = async (request: WorkspaceRequest) => {
    const found = await account(request);
    if (!found) throw new SourceError('Sign in to change your repositories.', 401);
    return found;
  };
  const limitOf = (members: WorkspaceMember[]): MembershipLimit | null => {
    const setting = limit();
    return setting ? { ...setting, visible: visibleCount(members) } : null;
  };
  return {
    mode: 'remote',
    // Signed out, the workspace has no members yet still names its site, which sign-in itself reads.
    settings: async request => ({ site, members: (await account(request))?.members ?? [], manifest: memberManifest }),
    membership(request): MembershipStore {
      const change = async (revision: string, apply: (members: WorkspaceMember[]) => WorkspaceMember[]) => {
        const current = await signedIn(request);
        if (revision !== String(current.revision)) throw new MembershipError('stale', 'Your repositories changed since they were read. Reload them and try again.', 409);
        const next = apply(current.members);
        assertVisibleLimit(current.members, next, limitOf(current.members));
        current.members = next;
        current.revision += 1;
        return { revision: String(current.revision) };
      };
      return {
        adds: 'repository',
        revision: async () => String((await signedIn(request)).revision),
        async add(candidate, revision) {
          const { ref } = candidate;
          if (!ref || ref.source.type === 'local' || !sameSite(site, ref.source)) throw new MembershipError('invalid', "Add a repository on this workspace's site.", 400);
          let added: WorkspaceMember | undefined;
          const result = await change(revision, members => {
            const next = withMemberAdded(members, { ref, editable: 'account' });
            added = next.member;
            return candidate.folder ? withMemberFolder(next.members, ref.id, candidate.folder) : next.members;
          });
          return { ...result, member: (await signedIn(request)).members.find(member => member.ref.id === added!.ref.id)! };
        },
        remove: (id: RepositoryId, revision) => change(revision, members => withMemberRemoved(members, id)),
        setHidden: (id, hidden, revision) => change(revision, members => withMemberHidden(members, id, hidden)),
        setDefault: (id, revision) => change(revision, members => withDefaultMember(members, id)),
        reorder: (order, revision) => change(revision, members => withMembersReordered(members, order)),
        setFolder: (id, folder, revision) => change(revision, members => withMemberFolder(members, id, folder)),
        limit: async () => limitOf((await signedIn(request)).members),
      };
    },
  };
}
