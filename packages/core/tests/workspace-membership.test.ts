import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { deploymentConfigSource, type WorkspaceMember } from '../src/workspace-config-source.js';
import { assertVisibleLimit, MembershipError, serverConfigRevision, withDefaultMember, withMemberAdded, withMemberHidden, withMemberRemoved, withMembersReordered } from '../src/workspace-membership.js';
import { folderManifest } from '../src/folder-manifest.js';
import { localManifest, MISSING_MANIFEST_REVISION } from '../src/local-manifest.js';
import { repositoryRef } from '../src/repository.js';
import { createWorkspaceRepositories } from '../src/workspace-repositories.js';

const request = { headers: {} };
const roots: string[] = [];
const scratch = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mygitnotes-membership-'));
  roots.push(root);
  return root;
};
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});
const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, stdio: 'ignore' });
/** A Git worktree at `base/name`, with a manifest when `manifest` is given. */
const worktree = (base: string, name: string, manifest?: string) => {
  const root = path.join(base, name);
  fs.mkdirSync(root, { recursive: true });
  git(root, 'init', '-b', 'main');
  if (manifest) fs.writeFileSync(path.join(root, '.mygitnotes.yaml'), manifest);
  return root;
};
const manifest = (id: string) => `schema_version: 4\nworkspace:\n  title: ${id}\n  default_notebook: ${id}\nnotebooks:\n  - id: ${id}\n    title: ${id}\n    root: ${id}\n`;
const remoteEnv = { MYGITNOTES_SOURCE: 'github', MYGITNOTES_REPOSITORY: 'owner/kb', MYGITNOTES_BRANCH: 'main' };
const settingsOf = (base: string, env: NodeJS.ProcessEnv) => deploymentConfigSource(base, env).settings(request);

describe('the server configuration member schema', () => {
  it('reads alias, default, hidden and folder for a remote deployment, the environment member first', async () => {
    const base = scratch();
    fs.writeFileSync(path.join(base, 'mygitnotes.server.yaml'), 'repositories:\n  - type: github\n    repository: owner/trpg\n    branch: campaign\n    alias: tabletop\n    default: true\n  - type: github\n    repository: owner/draft-pile\n    branch: main\n    hidden: true\n    folder: drafts/notes\n');
    const settings = await settingsOf(base, remoteEnv);
    expect(settings.members.map(member => [member.ref.id, member.alias, member.default, member.hidden, member.folder, member.editable])).toEqual([['github:owner/kb@main', 'kb', false, false, undefined, 'none'], ['github:owner/trpg@campaign', 'tabletop', true, false, undefined, 'none'], ['github:owner/draft-pile@main', 'draft-pile', false, true, 'drafts/notes', 'none']]);
    expect(deploymentConfigSource(base, remoteEnv).membership).toBeUndefined();
  });

  it("lets an entry naming the environment's repository set only its alias, default, hidden and folder, and place it", async () => {
    const base = scratch();
    fs.writeFileSync(path.join(base, 'mygitnotes.server.yaml'), 'repositories:\n  - { type: github, repository: owner/trpg, branch: main }\n  - { type: github, repository: owner/kb, alias: knowledge, folder: notes }\n');
    const settings = await settingsOf(base, remoteEnv);
    expect(settings.members.map(member => [member.ref.id, member.alias, member.default, member.folder])).toEqual([['github:owner/trpg@main', 'trpg', false, undefined], ['github:owner/kb@main', 'knowledge', true, 'notes']]);
  });

  it('derives aliases that avoid every stored one, the environment member first, as earlier phases did', async () => {
    const base = scratch();
    fs.writeFileSync(path.join(base, 'mygitnotes.server.yaml'), 'repositories:\n  - { type: github, repository: other/kb, branch: main }\n  - { type: github, repository: third/kb, branch: main, alias: kb-2 }\n');
    expect((await settingsOf(base, remoteEnv)).members.map(member => member.alias)).toEqual(['kb', 'kb-3', 'kb-2']);
  });

  it.each([['an unknown key', '  - { type: github, repository: owner/a, branch: main, colour: red }\n', /repositories\[0\] has unknown keys: colour/], ['a malformed alias', '  - { type: github, repository: owner/a, branch: main, alias: Not_A_Slug }\n', /repositories\[0\]: alias must be a lowercase slug/], ['a duplicate alias', '  - { type: github, repository: owner/a, branch: main, alias: same }\n  - { type: github, repository: owner/b, branch: main, alias: same }\n', /repositories\[1\]: alias same is already/], ['two defaults', '  - { type: github, repository: owner/a, branch: main, default: true }\n  - { type: github, repository: owner/b, branch: main, default: true }\n', /repositories\[1\] says default: true, as repositories\[0\] does/], ['one repository on two branches', '  - { type: github, repository: owner/a, branch: main }\n  - { type: github, repository: owner/a, branch: draft }\n', /repositories\[1\] names the repository of repositories\[0\] again/], ["the environment's repository on another branch", '  - { type: github, repository: owner/kb, branch: draft }\n', /repositories\[0\] names the deployment's repository on branch draft/], ['a hidden default', '  - { type: github, repository: owner/a, branch: main, default: true, hidden: true }\n', /repositories\[0\] is the default repository and says hidden: true/], ['a member without a branch', '  - { type: github, repository: owner/a }\n', /repositories\[0\] needs a branch/], ['a worktree path', '  - { type: github, repository: owner/a, branch: main, path: ../a }\n', /repositories\[0\]: a remote deployment reaches repositories through their platform/], ['a folder outside the repository', '  - { type: github, repository: owner/a, branch: main, folder: ../up }\n', /repositories\[0\]: folder must be a folder inside the repository/], ['a malformed flag', '  - { type: github, repository: owner/a, branch: main, hidden: yes-please }\n', /repositories\[0\]: hidden must be true or false/], ['a repository on another platform', '  - { type: gitlab, repository: secret-owner/other-site, branch: main }\n', /repositories\[0\] is not on the deployment's platform and site \(github\)/], ['a repository on another site of the platform', '  - { type: github, url: https://ghe.example.com, repository: owner/a, branch: main, hidden: true }\n', /repositories\[0\] is not on the deployment's platform and site/]])('fails setup with the file and entry index on %s', async (_case, entries, error) => {
    const base = scratch();
    const file = path.join(base, 'mygitnotes.server.yaml');
    fs.writeFileSync(file, `repositories:\n${entries}`);
    await expect(settingsOf(base, remoteEnv)).rejects.toMatchObject({ status: 503, message: expect.stringContaining(file) });
    await expect(settingsOf(base, remoteEnv)).rejects.toThrow(error);
  });

  it('refuses a branch on a local worktree entry and a worktree mapped twice', async () => {
    const base = scratch();
    const env = { MYGITNOTES_SOURCE: 'local', MYGITNOTES_LOCAL_PATH: worktree(base, 'home') };
    fs.writeFileSync(path.join(base, 'mygitnotes.server.yaml'), 'repositories:\n  - { type: local, path: ./trpg, branch: main }\n');
    await expect(settingsOf(base, env)).rejects.toThrow(/repositories\[0\]: a worktree serves the branch it has checked out/);
    fs.writeFileSync(path.join(base, 'mygitnotes.server.yaml'), 'repositories:\n  - { type: local, path: ./trpg }\n  - { type: github, repository: owner/trpg, path: ./trpg/ }\n');
    await expect(settingsOf(base, env)).rejects.toThrow(/repositories\[1\] names the repository of repositories\[0\] again/);
  });
});

describe('membership changes', () => {
  const ref = (name: string) => repositoryRef({ type: 'github', repository: `owner/${name}`, branch: 'main' });
  const member = (name: string, flags: Partial<WorkspaceMember> = {}): WorkspaceMember => ({ ref: ref(name), alias: name, default: false, hidden: false, editable: 'server-file', ...flags });
  const ids = (members: WorkspaceMember[]) => members.map(entry => [entry.alias, entry.default, entry.hidden]);

  it('refuses to hide the default and to remove it while another member remains', () => {
    const members = [member('kb', { default: true }), member('trpg')];
    expect(() => withMemberHidden(members, ref('kb').id, true)).toThrow(expect.objectContaining({ code: 'default-hidden' }));
    expect(() => withMemberRemoved(members, ref('kb').id)).toThrow(expect.objectContaining({ code: 'default-removed' }));
    expect(ids(withMemberRemoved(withDefaultMember(members, ref('trpg').id), ref('kb').id))).toEqual([['trpg', true, false]]);
  });

  it('allows removing the last member, which leaves the workspace empty (decision C8)', () => {
    expect(withMemberRemoved([member('kb', { default: true })], ref('kb').id)).toEqual([]);
  });

  it("refuses to remove the environment's member and names the setting to change (decision C9)", () => {
    const members = [member('kb', { editable: 'environment' }), member('trpg', { default: true })];
    expect(() => withMemberRemoved(members, ref('kb').id, 'MYGITNOTES_LOCAL_PATH')).toThrow(/deployment names with MYGITNOTES_LOCAL_PATH, so Settings cannot remove it\. Change MYGITNOTES_LOCAL_PATH/);
  });

  it('makes the first member shown without a visible default the default, and a default shown when chosen', () => {
    const hidden = [member('kb', { hidden: true }), member('trpg', { hidden: true })];
    expect(ids(withMemberHidden(hidden, ref('trpg').id, false))).toEqual([['kb', false, true], ['trpg', true, false]]);
    expect(ids(withDefaultMember([member('kb', { default: true }), member('trpg', { hidden: true })], ref('trpg').id))).toEqual([['kb', false, false], ['trpg', true, false]]);
  });

  it("derives an added member's alias from current members only, so a removed alias is derived again (decision C11)", () => {
    const members = [member('kb', { default: true }), member('notes')];
    const removed = withMemberRemoved(members, ref('notes').id);
    const { member: again } = withMemberAdded(removed, { ref: ref('notes'), editable: 'server-file' });
    expect(again).toMatchObject({ alias: 'notes', default: false, hidden: false });
    expect(withMemberAdded(members, { ref: repositoryRef({ type: 'github', repository: 'other/notes', branch: 'main' }), editable: 'server-file' }).member.alias).toBe('notes-2');
    expect(() => withMemberAdded(members, { ref: repositoryRef({ type: 'github', repository: 'owner/notes', branch: 'draft' }), editable: 'server-file' })).toThrow(expect.objectContaining({ code: 'duplicate' }));
    expect(withMemberAdded([], { ref: ref('first'), editable: 'server-file' }).member.default).toBe(true);
  });

  it('reorders only by a permutation of every member', () => {
    const members = [member('kb', { default: true }), member('trpg')];
    expect(withMembersReordered(members, [ref('trpg').id, ref('kb').id]).map(entry => entry.alias)).toEqual(['trpg', 'kb']);
    expect(() => withMembersReordered(members, [ref('trpg').id])).toThrow(MembershipError);
  });

  it('refuses only a change that shows more members than the limit, never counting hidden ones (Pro decision P1)', () => {
    const limit = { max: 2, plan: 'Free' };
    const atLimit = [member('kb', { default: true }), member('trpg'), member('vault', { hidden: true })];
    const refusal = expect.objectContaining({ code: 'visible-limit', status: 403, message: expect.stringContaining('at most 2 repositories on Free') });
    // Adding, showing and making a hidden member the default each show a third.
    expect(() => assertVisibleLimit(atLimit, withMemberAdded(atLimit, { ref: ref('journal'), editable: 'account' }).members, limit)).toThrow(refusal);
    expect(() => assertVisibleLimit(atLimit, withMemberHidden(atLimit, ref('vault').id, false), limit)).toThrow(refusal);
    expect(() => assertVisibleLimit(atLimit, withDefaultMember(atLimit, ref('vault').id), limit)).toThrow(refusal);
    // Hidden members do not count, and a change that shows no more passes whatever the count.
    const hidden = withMemberHidden(atLimit, ref('trpg').id, true);
    expect(() => assertVisibleLimit(atLimit, hidden, limit)).not.toThrow();
    expect(() => assertVisibleLimit(hidden, withMemberAdded(hidden, { ref: ref('journal'), editable: 'account' }).members, limit)).not.toThrow();
    // Above a lowered limit nothing is refused but showing more: hiding, removing, reordering and a visible default pass.
    const lowered = { max: 1 };
    expect(() => assertVisibleLimit(atLimit, withMemberHidden(atLimit, ref('trpg').id, true), lowered)).not.toThrow();
    expect(() => assertVisibleLimit(atLimit, withMemberRemoved(atLimit, ref('trpg').id), lowered)).not.toThrow();
    expect(() => assertVisibleLimit(atLimit, withDefaultMember(atLimit, ref('trpg').id), lowered)).not.toThrow();
    expect(() => assertVisibleLimit(atLimit, withMemberAdded(atLimit, { ref: ref('journal'), editable: 'account' }).members, null)).not.toThrow();
  });
});

describe('a local deployment keeping its membership in the server configuration', () => {
  const setup = (text?: string) => {
    const base = scratch();
    const env = { MYGITNOTES_SOURCE: 'local', MYGITNOTES_LOCAL_PATH: worktree(base, 'kb', manifest('kb')) };
    const file = path.join(base, 'mygitnotes.server.yaml');
    if (text !== undefined) fs.writeFileSync(file, text);
    const source = deploymentConfigSource(base, env);
    return { base, env, file, source, store: source.membership!(request)! };
  };
  const read = (file: string) => fs.readFileSync(file, 'utf8');

  it('adds, hides, shows, makes default and removes members, keeping the comments and other keys of the file', async () => {
    const { base, file, source, store } = setup('# Machine settings, kept by hand.\nproduct_repository: owner/kb # Core updates\n# Worktrees beside the knowledge base.\nrepositories:\n  - type: local\n    path: ./trpg\n  # Scratch notes.\n  - type: local\n    path: ./scratch\n');
    worktree(base, 'trpg', manifest('trpg'));
    worktree(base, 'scratch', manifest('scratch'));
    const notes = worktree(base, 'notes', manifest('notes'));
    let { revision } = await store.add({ localPath: notes }, await store.revision());
    // Every entry stores its alias; the environment's member keeps no entry while it is first and derives the same alias.
    expect(read(file)).toBe(`# Machine settings, kept by hand.\nproduct_repository: owner/kb # Core updates\n# Worktrees beside the knowledge base.\nrepositories:\n  - type: local\n    path: ./trpg\n    alias: trpg\n  # Scratch notes.\n  - type: local\n    path: ./scratch\n    alias: scratch\n  - type: local\n    path: ${notes}\n    alias: notes\n`);
    const id = (alias: string) => (async () => (await source.settings(request)).members.find(member => member.alias === alias)!.ref.id)();
    ({ revision } = await store.setHidden(await id('notes'), true, revision));
    expect((await source.settings(request)).members.find(member => member.alias === 'notes')).toMatchObject({ hidden: true });
    ({ revision } = await store.setHidden(await id('notes'), false, revision));
    ({ revision } = await store.setDefault(await id('notes'), revision));
    await expect(store.remove(await id('kb'), revision)).rejects.toMatchObject({ code: 'environment', message: expect.stringContaining('MYGITNOTES_LOCAL_PATH') });
    ({ revision } = await store.remove(await id('trpg'), revision));
    ({ revision } = await store.reorder([await id('notes'), await id('kb'), await id('scratch')], revision));
    expect(read(file)).toBe(`# Machine settings, kept by hand.\nproduct_repository: owner/kb # Core updates\n# Worktrees beside the knowledge base.\nrepositories:\n  - type: local\n    path: ${notes}\n    alias: notes\n    default: true\n  - type: local\n    path: ${path.join(base, 'kb')}\n    alias: kb\n  # Scratch notes.\n  - type: local\n    path: ./scratch\n    alias: scratch\n`);
    expect((await source.settings(request)).members.map(member => [member.alias, member.default, member.hidden])).toEqual([['notes', true, false], ['kb', false, false], ['scratch', false, false]]);
    expect(revision).toBe(serverConfigRevision(read(file)));
    expect(fs.readdirSync(base).filter(name => name.endsWith('.tmp'))).toEqual([]);
  });

  it('refuses a change read at an earlier revision and leaves the file as it was', async () => {
    const { base, file, store } = setup('repositories: []\n');
    const stale = await store.revision();
    fs.writeFileSync(file, '# edited by hand\nrepositories: []\n');
    await expect(store.add({ localPath: worktree(base, 'notes', manifest('notes')) }, stale)).rejects.toMatchObject({ status: 409, code: 'stale' });
    expect(read(file)).toBe('# edited by hand\nrepositories: []\n');
  });

  it("creates the file when there is none, and writes the environment member's entry only when its state needs one", async () => {
    const { base, env, file, store } = setup();
    expect(await store.revision()).toBe('none');
    const notes = worktree(base, 'notes', manifest('notes'));
    await store.add({ localPath: notes }, 'none');
    expect(read(file)).toBe(`repositories:\n  - type: local\n    path: ${notes}\n    alias: notes\n`);
    // Hiding the environment's member needs an entry to say so.
    const settings = await deploymentConfigSource(base, env).settings(request);
    await store.setDefault(settings.members[1].ref.id, serverConfigRevision(read(file)));
    await store.setHidden(settings.members[0].ref.id, true, serverConfigRevision(read(file)));
    expect(read(file)).toBe(`repositories:\n  - type: local\n    path: ${env.MYGITNOTES_LOCAL_PATH}\n    alias: kb\n    hidden: true\n  - type: local\n    path: ${notes}\n    alias: notes\n    default: true\n`);
  });

  it('keeps a symbolically linked configuration a link, writing the file it points at', async () => {
    const { base, env } = setup();
    const kept = path.join(scratch(), 'dotfiles', 'mygitnotes.server.yaml');
    fs.mkdirSync(path.dirname(kept), { recursive: true });
    fs.writeFileSync(kept, '# kept with dotfiles\nproduct_repository: owner/kb\n');
    const file = path.join(base, 'mygitnotes.server.yaml');
    fs.symlinkSync(kept, file);
    const store = deploymentConfigSource(base, env).membership!(request)!;
    const notes = worktree(base, 'notes', manifest('notes'));
    await store.add({ localPath: notes }, await store.revision());
    expect(fs.lstatSync(file).isSymbolicLink()).toBe(true);
    expect(read(kept)).toBe(`# kept with dotfiles\nproduct_repository: owner/kb\nrepositories:\n  - type: local\n    path: ${notes}\n    alias: notes\n`);
    expect(fs.readdirSync(path.dirname(kept)).filter(name => name.endsWith('.tmp'))).toEqual([]);
  });

  it('changes the entry of the text whose revision it checked, even when the file is edited while the change reads it', async () => {
    const trpg = (base: string) => worktree(base, 'trpg', manifest('trpg')), scrap = (base: string) => worktree(base, 'scratch', manifest('scratch'));
    const { base, file, source, store } = setup('repositories:\n  - { type: local, path: ./trpg, alias: trpg }\n  - { type: local, path: ./scratch, alias: scratch }\n');
    trpg(base);
    scrap(base);
    const scratchId = (await source.settings(request)).members.find(member => member.alias === 'scratch')!.ref.id;
    const revision = await store.revision();
    // Someone reorders the entries by hand just after the change read the file.
    const nativeRead = fs.readFileSync;
    let edited = false;
    vi.spyOn(fs, 'readFileSync').mockImplementation(
      ((target: fs.PathOrFileDescriptor, options?: unknown) => {
        const result = nativeRead(target, options as BufferEncoding);
        if (!edited && target === file) {
          edited = true;
          fs.writeFileSync(file, 'repositories:\n  - { type: local, path: ./scratch, alias: scratch }\n  - { type: local, path: ./trpg, alias: trpg }\n');
        }
        return result;
      }) as typeof fs.readFileSync,
    );
    await store.setHidden(scratchId, true, revision);
    vi.restoreAllMocks();
    expect(read(file)).toBe('repositories:\n  - { type: local, path: ./trpg, alias: trpg }\n  - { type: local, path: ./scratch, alias: scratch, hidden: true }\n');
  });

  it('asks for a folder for a worktree without a manifest, and refuses one that is no worktree root or has a manifest', async () => {
    const { base, source, store } = setup();
    const bare = worktree(base, 'bare');
    await expect(store.add({ localPath: bare }, 'none')).rejects.toMatchObject({ code: 'folder-required' });
    await expect(store.add({ localPath: path.join(base, 'kb', 'kb') }, 'none')).rejects.toMatchObject({ code: 'not-worktree' });
    await expect(store.add({ localPath: worktree(base, 'full', manifest('full')), folder: 'notes' }, 'none')).rejects.toMatchObject({ code: 'folder-unused' });
    await expect(store.add({ localPath: 'relative/path' }, 'none')).rejects.toMatchObject({ code: 'invalid' });
    await store.add({ localPath: bare, folder: 'journal/daily/' }, 'none');
    expect((await source.settings(request)).members.find(member => member.alias === 'bare')).toMatchObject({ folder: 'journal/daily', localPath: bare });
  });
});

describe('a member with a picked folder', () => {
  it('serves one notebook at the folder until the repository keeps a manifest, which then wins', async () => {
    const root = scratch();
    const commit = vi.fn(async () => undefined);
    const store = folderManifest(localManifest(root, commit, '.mygitnotes.yaml'), 'journal/Daily Notes', 'journal-repo');
    const read = await store.read();
    expect(read).toMatchObject({ state: 'derived', revision: MISSING_MANIFEST_REVISION, config: { workspace: { title: 'journal-repo', default_notebook: 'daily-notes' }, notebooks: [{ id: 'daily-notes', title: 'Daily Notes', root: 'journal/Daily Notes' }] } });
    // "Create manifest" writes the notebook as configured; afterwards the manifest is the source.
    await store.save(manifest('journal'), MISSING_MANIFEST_REVISION);
    expect(await store.read()).toMatchObject({ state: 'file', config: { notebooks: [{ id: 'journal' }] } });
  });

  it('refuses to create a manifest that appeared meanwhile, and never falls back from an invalid one', async () => {
    const root = scratch();
    const store = folderManifest(localManifest(root, vi.fn(async () => undefined), '.mygitnotes.yaml'), 'notes', 'repo');
    const { revision } = await store.read();
    fs.writeFileSync(path.join(root, '.mygitnotes.yaml'), 'schema_version: 4\nnotebooks: [oops\n');
    await expect(store.save(manifest('notes'), revision)).rejects.toMatchObject({ status: 409 });
    expect(await store.read()).toMatchObject({ state: 'invalid' });
  });

  it('opens as that notebook in a local workspace, under its alias', async () => {
    const base = scratch();
    const env = { MYGITNOTES_SOURCE: 'local', MYGITNOTES_LOCAL_PATH: worktree(base, 'kb', manifest('kb')) };
    const bare = worktree(base, 'scraps');
    fs.writeFileSync(path.join(base, 'mygitnotes.server.yaml'), `repositories:\n  - { type: local, path: ${bare}, folder: inbox }\n`);
    const settings = await deploymentConfigSource(base, env).settings(request);
    const repositories = createWorkspaceRepositories({ members: settings.members, openRepository: async member => ({ root: member.localPath! }), manifest: (member, handle) => settings.manifest(member, () => localManifest(handle.root, vi.fn(), '.mygitnotes.yaml')) });
    expect((await repositories.forNotebook('scraps~inbox')).notebook).toMatchObject({ id: 'inbox', root: 'inbox' });
  });
});
