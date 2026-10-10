// @vitest-environment jsdom
import { createElement } from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { DEFAULT_WORKSPACE_PREFERENCES } from '@mygitnotes/core/workspace-preferences';
import type { MembersAnswer, WorkspaceMemberStatus } from '../lib/members-api.js';
import type { WorkspaceRepository } from '../lib/workspace-repositories.js';
import { workingNotesKey } from '../lib/working-notes.js';
import { type WebFeature, WebFeaturesProvider } from '../lib/web-features.js';
import { RepositoriesSettings, type RepositoriesSettingsProps } from './RepositoriesSettings.js';

const api = vi.hoisted(() => ({ fetchMembers: vi.fn(), setMemberHidden: vi.fn(), setDefaultMember: vi.fn(), removeMember: vi.fn(), reorderMembers: vi.fn(), addMember: vi.fn(), addRepositoryMember: vi.fn(), fetchMemberFolders: vi.fn() }));
vi.mock('../lib/members-api.js', async importOriginal => ({ ...await importOriginal<typeof import('../lib/members-api.js')>(), ...api }));
const { MembershipApiError } = await import('../lib/members-api.js');

const member = (alias: string, flags: Partial<WorkspaceMemberStatus> = {}): WorkspaceMemberStatus => ({ id: `local:/work/${alias}`, alias, type: 'local', path: `/work/${alias}`, default: false, hidden: false, editable: 'server-file', ...flags });
const repository = (alias: string, ids: string[] = [alias]): WorkspaceRepository => ({ id: `local:/work/${alias}`, alias, type: 'local', branch: 'main', revision: '', write: true, notebooks: ids.map(id => `${alias}~${id}`), title: alias.toUpperCase(), defaultNotebook: `${alias}~${ids[0]}`, preferences: DEFAULT_WORKSPACE_PREFERENCES, config: null, configRevision: '' });
const answer = (members: WorkspaceMemberStatus[], overrides: Partial<MembersAnswer> = {}): MembersAnswer => ({ members, changeable: true, revision: 'rev-1', sharedAssetKeys: false, environment: 'MYGITNOTES_LOCAL_PATH', ...overrides });
const kb = member('kb', { default: true, editable: 'environment' }), journal = member('journal'), archive = member('archive', { hidden: true });
const show = (props: Partial<RepositoriesSettingsProps> = {}, features: WebFeature[] = []) => render(createElement(WebFeaturesProvider, { features }, createElement(RepositoriesSettings, { repositories: [repository('kb'), repository('journal')], onMembershipChanged: vi.fn(async () => {}), onOpenChanges: vi.fn(), ...props })));
const row = (alias: string) => within(document.querySelector(`[data-member="${alias}"]`) as HTMLElement);

beforeEach(() => {
  // jsdom has no modal dialogs.
  HTMLDialogElement.prototype.showModal = function(this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function(this: HTMLDialogElement) {
    this.removeAttribute('open');
  };
  api.fetchMembers.mockResolvedValue(answer([kb, journal, archive]));
  for (const change of [api.setMemberHidden, api.setDefaultMember, api.removeMember, api.reorderMembers, api.addMember, api.addRepositoryMember]) change.mockResolvedValue({ revision: 'rev-2' });
});
afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

it('lists hidden members with an unhide action, and keeps the default from being hidden or removed, saying why', async () => {
  const onMembershipChanged = vi.fn(async () => {});
  show({ onMembershipChanged });
  await screen.findByText('KB');
  expect(row('archive').getByText('Hidden')).toBeInTheDocument();
  expect(row('kb').getByRole('button', { name: 'Hide' })).toBeDisabled();
  expect(row('kb').getByRole('button', { name: 'Remove' })).toBeDisabled();
  expect(row('kb').getByText('The default repository cannot be hidden or removed. Make another repository the default first.')).toBeInTheDocument();
  expect(row('kb').getByText(/names this repository with MYGITNOTES_LOCAL_PATH, so Settings cannot remove it/)).toBeInTheDocument();
  fireEvent.click(row('archive').getByRole('button', { name: 'Show' }));
  await waitFor(() => expect(api.setMemberHidden).toHaveBeenCalledWith(archive.id, false, 'rev-1'));
  await waitFor(() => expect(onMembershipChanged).toHaveBeenCalled());
});

it('refuses to hide a repository this browser holds drafts for, names them, and offers Changes or discarding', async () => {
  const scope = `${journal.id}:main`;
  localStorage.setItem(workingNotesKey(scope), JSON.stringify({ 'notes/journal/today.md': { note: { path: 'notes/journal/today.md', notebookId: 'journal' }, base: null } }));
  const onOpenChanges = vi.fn();
  show({ onOpenChanges });
  await screen.findByText('JOURNAL');
  fireEvent.click(row('journal').getByRole('button', { name: 'Hide' }));
  const dialog = within(await screen.findByRole('dialog'));
  expect(dialog.getByText('Note · notes/journal/today.md')).toBeInTheDocument();
  expect(api.setMemberHidden).not.toHaveBeenCalled();
  fireEvent.click(dialog.getByRole('button', { name: 'Discard drafts' }));
  expect(localStorage.getItem(workingNotesKey(scope))).toBeNull();
  fireEvent.click(row('journal').getByRole('button', { name: 'Hide' }));
  await waitFor(() => expect(api.setMemberHidden).toHaveBeenCalledWith(journal.id, true, 'rev-1'));
  expect(onOpenChanges).not.toHaveBeenCalled();
});

it('refuses to remove a hidden repository this browser holds drafts for, found by the branch the list names', async () => {
  const hidden = member('archive', { hidden: true, branch: 'notes' });
  api.fetchMembers.mockResolvedValue(answer([kb, journal, hidden]));
  localStorage.setItem(workingNotesKey(`${hidden.id}:notes`), JSON.stringify({ 'notes/archive/old.md': { note: { path: 'notes/archive/old.md', notebookId: 'archive' }, base: null } }));
  show();
  await screen.findByText('JOURNAL');
  // The workspace did not load the hidden repository, so only the list says where its drafts are.
  fireEvent.click(row('archive').getByRole('button', { name: 'Remove' }));
  const dialog = within(await screen.findByRole('dialog'));
  expect(dialog.getByText('Note · notes/archive/old.md')).toBeInTheDocument();
  expect(api.removeMember).not.toHaveBeenCalled();
});

it('reloads the list and says so when it changed since it was read', async () => {
  api.setDefaultMember.mockRejectedValueOnce(new MembershipApiError('changed', 409, 'stale'));
  show();
  await screen.findByText('JOURNAL');
  fireEvent.click(row('journal').getByRole('button', { name: 'Make default' }));
  expect(await screen.findByText('The repository list changed since this page read it. It has been reloaded; try again.')).toBeInTheDocument();
  expect(api.fetchMembers).toHaveBeenCalledTimes(2);
});

it('asks for a folder when the added worktree has no manifest', async () => {
  api.addMember.mockRejectedValueOnce(new MembershipApiError('no manifest', 422, 'folder-required'));
  show();
  await screen.findByText('KB');
  fireEvent.change(screen.getByRole('textbox', { name: 'Add a repository: worktree path' }), { target: { value: '/work/scraps' } });
  fireEvent.click(screen.getByRole('button', { name: 'Add repository' }));
  const folder = await screen.findByRole('textbox', { name: 'Notebook folder' });
  fireEvent.change(folder, { target: { value: 'notes/scraps' } });
  fireEvent.click(screen.getByRole('button', { name: 'Add repository' }));
  await waitFor(() => expect(api.addMember).toHaveBeenLastCalledWith('/work/scraps', 'rev-1', 'notes/scraps'));
});

it('shows the members read-only where the administrator changes them, and the shared R2 keys of equal local ids', async () => {
  api.fetchMembers.mockResolvedValue(answer([member('kb', { default: true, editable: 'none' }), member('journal', { editable: 'none' })], { changeable: false, revision: null, sharedAssetKeys: true }));
  show({ repositories: [repository('kb', ['kb', 'inbox']), repository('journal', ['inbox'])] });
  expect(await screen.findByText(/The administrator changes them there and redeploys/)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Hide' })).toBeNull();
  expect(screen.queryByRole('textbox', { name: 'Add a repository: worktree path' })).toBeNull();
  expect(row('kb').getByText(/share keys with journal \(r2:inbox\/\)/)).toBeInTheDocument();
});

it("says how many repositories a hosted deployment's administrator hides, without names it was not told", async () => {
  api.fetchMembers.mockResolvedValue(answer([member('kb', { default: true, editable: 'none' })], { changeable: false, revision: null, hiddenUnnamed: 2 }));
  show({ repositories: [repository('kb')] });
  expect(await screen.findByText('The administrator also hides 2 repository(s), which this page does not name.')).toBeInTheDocument();
});

it("says a visitor-choice deployment's repository changes through Switch repository, not the configuration file", async () => {
  api.fetchMembers.mockResolvedValue(answer([member('notes', { default: true, editable: 'none' })], { changeable: false, revision: null, repositoryChoice: true }));
  show({ repositories: [repository('notes')] });
  expect(await screen.findByText('This deployment opens the one repository you chose. Use Switch repository to open another.')).toBeInTheDocument();
  expect(screen.queryByText(/The administrator changes them there/)).toBeNull();
});

describe('a list an account keeps', () => {
  const account = (alias: string, flags: Partial<WorkspaceMemberStatus> = {}): WorkspaceMemberStatus => ({ id: `github:octo/${alias}@main`, alias, type: 'github', repository: `octo/${alias}`, branch: 'main', default: false, hidden: false, editable: 'account', ...flags });
  const notes = account('notes', { default: true }), wiki = account('wiki'), diary = account('diary', { hidden: true });
  const repositories = [repository('notes'), repository('wiki')].map(entry => ({ ...entry, id: `github:octo/${entry.alias}@main`, type: 'github' as const, repository: `octo/${entry.alias}` }));
  /** The person's GitHub repositories, as the deployment lists them for the picker. */
  const listing = (names: string[]) =>
    vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
      if (!String(input).startsWith('/api/repositories/available')) throw new Error(`Unexpected request ${String(input)}`);
      return new Response(JSON.stringify({ repositories: names.map(fullName => ({ fullName, defaultBranch: 'main', private: true, updatedAt: '2026-10-01T00:00:00Z' })), total: names.length, githubApp: true, installUrl: 'https://github.com/apps/notes/installations/new', newRepositoryUrl: null }), { status: 200 });
    });

  it('adds a repository from the picker, marking members already added, and asks for a folder when its branch keeps no manifest', async () => {
    api.fetchMembers.mockResolvedValue(answer([notes, wiki, diary], { adds: 'repository', environment: undefined, limit: { visible: 2, max: 10 } }));
    api.addRepositoryMember.mockRejectedValueOnce(new MembershipApiError('no manifest', 422, 'folder-required'));
    api.fetchMemberFolders.mockResolvedValue({ repository: 'octo/scraps', branch: 'main', manifest: false, folders: ['inbox', 'journal'] });
    listing(['octo/notes', 'octo/diary', 'octo/scraps']);
    const onMembershipChanged = vi.fn(async () => {});
    show({ repositories, onMembershipChanged });
    await screen.findByText('NOTES');
    expect(screen.queryByRole('textbox', { name: 'Add a repository: worktree path' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Add repository' }));
    const dialog = within(await screen.findByRole('dialog'));
    const listed = (name: string) => within(dialog.getByText(name).closest('li') as HTMLElement);
    await dialog.findByText('octo/scraps');
    // Members already on the list are marked, and a hidden one offers Show instead of a second add.
    expect(listed('octo/notes').getByText('Added')).toBeInTheDocument();
    expect(listed('octo/diary').getByRole('button', { name: 'Show' })).toBeEnabled();
    fireEvent.click(dialog.getByRole('button', { name: /octo\/scraps/ }));
    fireEvent.click(dialog.getByRole('button', { name: 'Add repository' }));
    await dialog.findByText('octo/scraps has no manifest on main. Choose the folder its one notebook uses, or type a new one. Nothing is written to the repository.');
    expect(api.addRepositoryMember).toHaveBeenCalledWith('octo/scraps', undefined, 'rev-1', undefined);
    fireEvent.click(await dialog.findByRole('button', { name: 'journal' }));
    fireEvent.click(dialog.getByRole('button', { name: 'Add repository' }));
    await waitFor(() => expect(api.addRepositoryMember).toHaveBeenLastCalledWith('octo/scraps', undefined, 'rev-1', 'journal'));
    await waitFor(() => expect(onMembershipChanged).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it("lists the picker from an edition's own source, keeping the marks it gives", async () => {
    api.fetchMembers.mockResolvedValue(answer([notes, diary], { adds: 'repository', environment: undefined }));
    const fetch = vi.spyOn(globalThis, 'fetch');
    const list = vi.fn(async (query: string) => ({ repositories: [{ fullName: 'octo/renamed-diary', defaultBranch: 'main', private: true, updatedAt: '2026-10-01T00:00:00Z', member: { id: diary.id, hidden: true } }, { fullName: 'octo/fresh', defaultBranch: 'main', private: false, updatedAt: '2026-10-02T00:00:00Z' }].filter(entry => entry.fullName.includes(query)), total: 2, githubApp: true, installUrl: null, newRepositoryUrl: null }));
    show({ repositories }, [{ id: 'edition', repositoryList: list }]);
    await screen.findByText('NOTES');
    fireEvent.click(screen.getByRole('button', { name: 'Add repository' }));
    const dialog = within(await screen.findByRole('dialog'));
    fireEvent.click(within(dialog.getByText('octo/renamed-diary').closest('li') as HTMLElement).getByRole('button', { name: 'Show' }));
    await waitFor(() => expect(api.setMemberHidden).toHaveBeenCalledWith(diary.id, false, 'rev-1'));
    expect(list).toHaveBeenCalledWith('', expect.any(AbortSignal));
    expect(fetch).not.toHaveBeenCalled();
  });

  it('shows the limit as a quiet line and keeps adding and showing past it, with a refusal read as part of that line', async () => {
    api.fetchMembers.mockResolvedValue(answer([notes, wiki, diary], { adds: 'repository', environment: undefined, limit: { visible: 2, max: 2, plan: 'Free', upgradeUrl: 'https://example.com/upgrade' } }));
    show({ repositories });
    await screen.findByText('NOTES');
    const line = document.querySelector('[data-members-limit]') as HTMLElement;
    expect(line).toHaveTextContent('2 of 2 visible repositories on Free');
    expect(line).toHaveTextContent('Hide a repository to add or show another.');
    expect(within(line).getByRole('link', { name: 'Upgrade' })).toHaveAttribute('href', 'https://example.com/upgrade');
    expect(line).not.toHaveClass('text-danger');
    expect(screen.getByRole('button', { name: 'Add repository' })).toBeDisabled();
    // Faded as the other disabled actions are, not as a primary action, which keeps its colored surface when disabled.
    expect(screen.getByRole('button', { name: 'Add repository' })).not.toHaveClass('ui-button-primary');
    expect(row('diary').getByRole('button', { name: 'Show' })).toBeDisabled();
    expect(row('diary').getByRole('button', { name: 'Make default' })).toBeDisabled();
    expect(screen.queryByRole('alert')).toBeNull();
    // Another tab took the last place meanwhile: the server's refusal joins the quiet line, not an error.
    api.fetchMembers.mockResolvedValue(answer([notes, wiki, diary], { adds: 'repository', environment: undefined, limit: { visible: 1, max: 2 } }));
    cleanup();
    show({ repositories });
    await screen.findByText('NOTES');
    expect(screen.getByRole('button', { name: 'Add repository' })).toHaveClass('ui-button-primary');
    api.setMemberHidden.mockRejectedValueOnce(new MembershipApiError('This workspace shows at most 2 repositories. Hide one first.', 403, 'visible-limit'));
    fireEvent.click(row('diary').getByRole('button', { name: 'Show' }));
    await waitFor(() => expect(document.querySelector('[data-members-limit]')).toHaveTextContent('Hide a repository to add or show another.'));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('asks before hiding or removing where an edition adds a notice, and shows it', async () => {
    api.fetchMembers.mockResolvedValue(answer([notes, wiki], { adds: 'repository', environment: undefined }));
    const notice = vi.fn(({ action, repository: target }: { action: string; repository: { alias: string; repository?: string; }; }) => createElement('p', null, `Published pages of ${target.repository} stay online (${action}).`));
    show({ repositories }, [{ id: 'edition', repositoryNotice: notice }]);
    await screen.findByText('WIKI');
    fireEvent.click(row('wiki').getByRole('button', { name: 'Hide' }));
    const dialog = within(await screen.findByRole('dialog'));
    expect(dialog.getByText('Published pages of octo/wiki stay online (hide).')).toBeInTheDocument();
    expect(api.setMemberHidden).not.toHaveBeenCalled();
    fireEvent.click(dialog.getByRole('button', { name: 'Hide' }));
    await waitFor(() => expect(api.setMemberHidden).toHaveBeenCalledWith(wiki.id, true, 'rev-1'));
    fireEvent.click(row('wiki').getByRole('button', { name: 'Remove' }));
    expect(within(await screen.findByRole('dialog')).getByText('Published pages of octo/wiki stay online (remove).')).toBeInTheDocument();
  });
});
