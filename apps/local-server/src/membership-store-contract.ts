import { MembershipError, type MembershipStore, type NewMember, repositoryRef, type WorkspaceConfigSource, type WorkspacePerson, type WorkspaceRequest } from '@mygitnotes/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { namedTo } from './workspace-members.js';

/** What the membership store contract needs from an edition that keeps each person's repositories. */
export interface MembershipStoreFixture {
  configSource: WorkspaceConfigSource;
  /** A browser request of the n-th person (1 or 2), as the members routes receive it; each starts with no repositories. */
  request(n: number): WorkspaceRequest | Promise<WorkspaceRequest>;
  /** The person `/mcp` names for the n-th person's grant (`request.person`); omit when the store reads browser sessions only. */
  person?(n: number): WorkspacePerson | Promise<WorkspacePerson>;
  /** Sets the visible limit the store applies from the next change on; omit for a store without a limit. */
  setLimit?(max: number): void | Promise<void>;
  /** A platform repository to add, as the members route passes it once it has checked it; defaults to github.com. */
  repository?(fullName: string, branch?: string): NewMember;
}

const github = (fullName: string, branch = 'main'): NewMember => ({ ref: repositoryRef({ type: 'github', repository: fullName, branch }), token: 'contract-token' });

/**
 * The behavior every membership store kept per person must have, the one an edition's database store and the
 * community's in-memory reference both pass: decision C8's default rules, C11's alias reuse, stale revisions,
 * hidden members named to their owner, and the visible limit (Pro decision P1). The reference store is
 * `memoryAccountSource` (`testing/memory-account-source`). An edition runs it against its store:
 * `membershipStoreContract('postgres', async () => ({ configSource: postgresWorkspaceSource(…), request: signIn }))`.
 * `makeFixture` is called once per test and must give each person an empty workspace.
 */
export function membershipStoreContract(name: string, makeFixture: () => MembershipStoreFixture | Promise<MembershipStoreFixture>) {
  describe(`${name} membership store contract`, () => {
    let fixture: MembershipStoreFixture;
    beforeEach(async () => {
      fixture = await makeFixture();
    });
    const candidate = (fullName: string, branch?: string) => (fixture.repository ?? github)(fullName, branch);
    /** The n-th person's workspace: their members, their store, and changes that follow its revision. */
    const person = async (n = 1) => {
      const request = await fixture.request(n);
      const store = () => {
        const found = fixture.configSource.membership?.(request);
        if (!found) throw new Error('The configuration source offers no membership store for this request.');
        return found;
      };
      const members = async () => (await fixture.configSource.settings(request)).members;
      const idOf = async (alias: string) => (await members()).find(member => member.alias === alias)!.ref.id;
      const flags = async () => (await members()).map(member => [member.alias, member.default, member.hidden]);
      /** Runs one change at the store's current revision. */
      const apply = async (change: (store: MembershipStore, revision: string) => Promise<unknown>) => change(store(), await store().revision());
      const add = (fullName: string, branch?: string, folder?: string) => apply((store, revision) => store.add({ ...candidate(fullName, branch), ...(folder ? { folder } : {}) }, revision));
      const hide = async (alias: string, hidden = true) => apply(async (store, revision) => store.setHidden(await idOf(alias), hidden, revision));
      const makeDefault = async (alias: string) => apply(async (store, revision) => store.setDefault(await idOf(alias), revision));
      const remove = async (alias: string) => apply(async (store, revision) => store.remove(await idOf(alias), revision));
      return { request, store, members, idOf, flags, add, hide, makeDefault, remove };
    };
    const refused = (code: string, status?: number) => expect.objectContaining({ code, ...(status ? { status } : {}) });

    it('starts empty, adds platform repositories, and makes the first one the visible default', async () => {
      const me = await person();
      expect(await me.members()).toEqual([]);
      expect(me.store().adds).toBe('repository');
      await me.add('octo/notes');
      await me.add('octo/journal', 'drafts', 'daily');
      const members = await me.members();
      expect(members.map(member => [member.ref.id, member.alias, member.default, member.hidden, member.folder, member.editable])).toEqual([[candidate('octo/notes').ref!.id, 'notes', true, false, undefined, 'account'], [candidate('octo/journal', 'drafts').ref!.id, 'journal', false, false, 'daily', 'account']]);
    });

    it('refuses one repository twice, even on another branch, and derives aliases from current members only (decision C11)', async () => {
      const me = await person();
      await me.add('octo/notes');
      await expect(me.add('octo/notes', 'draft')).rejects.toThrow(refused('duplicate'));
      await me.add('hubot/notes');
      expect((await me.members()).map(member => member.alias)).toEqual(['notes', 'notes-2']);
      await me.makeDefault('notes-2');
      await me.remove('notes');
      // A removed alias is free again: the repository added back derives the alias it had.
      await me.add('octo/notes');
      expect((await me.members()).map(member => member.alias)).toEqual(['notes-2', 'notes']);
    });

    it('refuses a change made from a revision that is no longer current and leaves the members as they were', async () => {
      const me = await person();
      await me.add('octo/notes');
      const stale = await me.store().revision();
      await me.add('octo/journal');
      const before = await me.members();
      await expect(me.store().add(candidate('octo/wiki'), stale)).rejects.toThrow(refused('stale', 409));
      await expect(me.store().setHidden(await me.idOf('journal'), true, stale)).rejects.toThrow(refused('stale', 409));
      expect(await me.members()).toEqual(before);
      expect(await me.store().revision()).not.toBe(stale);
    });

    it('keeps the default visible, removes it only as the last member, and never picks another default (decision C8)', async () => {
      const me = await person();
      await me.add('octo/notes');
      await me.add('octo/journal');
      await expect(me.hide('notes')).rejects.toThrow(refused('default-hidden'));
      await expect(me.remove('notes')).rejects.toThrow(refused('default-removed'));
      await me.makeDefault('journal');
      await me.remove('notes');
      expect(await me.flags()).toEqual([['journal', true, false]]);
      await me.remove('journal');
      expect(await me.members()).toEqual([]);
    });

    it('shows a hidden member that becomes the default, puts members in the order named, and sets a folder', async () => {
      const me = await person();
      await me.add('octo/notes');
      await me.add('octo/journal');
      await me.hide('journal');
      await me.makeDefault('journal');
      expect(await me.flags()).toEqual([['notes', false, false], ['journal', true, false]]);
      const [notes, journal] = [await me.idOf('notes'), await me.idOf('journal')];
      await expect(me.store().reorder([journal], await me.store().revision())).rejects.toThrow(MembershipError);
      await me.store().reorder([journal, notes], await me.store().revision());
      expect((await me.members()).map(member => member.alias)).toEqual(['journal', 'notes']);
      await me.store().setFolder(notes, 'inbox', await me.store().revision());
      expect((await me.members()).find(member => member.alias === 'notes')?.folder).toBe('inbox');
    });

    it('lists a hidden member to its owner by name, without opening it', async () => {
      const me = await person();
      await me.add('octo/notes');
      await me.add('octo/secret-diary');
      await me.hide('secret-diary');
      const hidden = (await me.members()).find(member => member.alias === 'secret-diary')!;
      expect(hidden).toMatchObject({ hidden: true, editable: 'account' });
      // Settings names a hidden member to whoever can change it, which a person's own repository is.
      expect(namedTo(hidden)).toBe(true);
    });

    it("keeps each person's repositories apart", async () => {
      const [me, other] = [await person(1), await person(2)];
      await me.add('octo/notes');
      expect(await other.members()).toEqual([]);
      await other.add('octo/notes');
      await other.add('hubot/wiki');
      expect((await me.members()).map(member => member.alias)).toEqual(['notes']);
    });

    it('answers the members of the person a grant names, from a request without any browser cookie', async () => {
      if (!fixture.person) return;
      const me = await person(1);
      await me.add('octo/notes');
      await (await person(2)).add('hubot/wiki');
      const granted = { headers: {}, person: await fixture.person(1) };
      expect((await fixture.configSource.settings(granted)).members.map(member => member.alias)).toEqual(['notes']);
      // Beside the other person's browser cookie, the grant's person still wins.
      expect((await fixture.configSource.settings({ headers: (await fixture.request(2)).headers, person: await fixture.person(1) })).members.map(member => member.alias)).toEqual(['notes']);
    });

    it('refuses to show more repositories than the limit, never counts hidden ones, and never hides any (Pro decision P1)', async () => {
      if (!fixture.setLimit) return;
      await fixture.setLimit(2);
      const me = await person();
      await me.add('octo/notes');
      await me.add('octo/journal');
      expect(await me.store().limit?.()).toMatchObject({ visible: 2, max: 2 });
      await expect(me.add('octo/wiki')).rejects.toThrow(refused('visible-limit', 403));
      // A hidden member does not count, so one more fits; showing it again, or making it the default, does not.
      await me.hide('journal');
      await me.add('octo/wiki');
      expect(await me.store().limit?.()).toMatchObject({ visible: 2, max: 2 });
      await expect(me.hide('journal', false)).rejects.toThrow(refused('visible-limit', 403));
      await expect(me.makeDefault('journal')).rejects.toThrow(refused('visible-limit', 403));
      // Above a lowered limit every visible member stays, and hiding or removing still works; adding does not.
      await fixture.setLimit(1);
      expect(await me.flags()).toEqual([['notes', true, false], ['journal', false, true], ['wiki', false, false]]);
      await expect(me.add('octo/garden')).rejects.toThrow(refused('visible-limit', 403));
      await me.remove('journal');
      await me.hide('wiki');
      await me.remove('wiki');
      expect(await me.flags()).toEqual([['notes', true, false]]);
    });
  });
}
