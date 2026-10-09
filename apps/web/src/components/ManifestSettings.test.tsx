// @vitest-environment jsdom
import { createElement } from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import YAML from 'yaml';
import { DEFAULT_WORKSPACE_PREFERENCES } from '@mygitnotes/core/workspace-preferences';
import type { WorkspaceConfig } from '@mygitnotes/core';
import type { WorkspaceRepository } from '../lib/workspace-repositories.js';
import { ManifestSettings, type ManifestSettingsProps } from './ManifestSettings.js';

const updateWorkspaceConfig = vi.hoisted(() => vi.fn(async (_repository: string, _yaml: string, _revision: string) => ({ success: true, configRevision: 'next' })));
vi.mock('../lib/api.js', async importOriginal => ({ ...await importOriginal<typeof import('../lib/api.js')>(), updateWorkspaceConfig }));

beforeAll(() => {
  // Radix Select measures and captures the pointer, which jsdom does not implement.
  Element.prototype.scrollIntoView = () => {};
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.releasePointerCapture = () => {};
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  updateWorkspaceConfig.mockReset();
  updateWorkspaceConfig.mockImplementation(async () => ({ success: true, configRevision: 'next' }));
});

const config = (title: string, id: string): WorkspaceConfig => ({ schema_version: 4, workspace: { title, default_notebook: id }, notebooks: [{ id, title: id, root: `notes/${id}` }], preferences: DEFAULT_WORKSPACE_PREFERENCES });
const repository = (id: string, alias: string, overrides: Partial<WorkspaceRepository> = {}): WorkspaceRepository => ({ id, alias, type: 'github', repository: `me/${alias}`, branch: 'main', revision: 'a'.repeat(40), write: true, notebooks: [`${alias}~${alias}`], title: alias, defaultNotebook: `${alias}~${alias}`, preferences: DEFAULT_WORKSPACE_PREFERENCES, config: config(alias, alias), configRevision: `${alias}-rev`, ...overrides });
const home = repository('github:me/home@main', 'home', { title: 'Knowledge base', config: config('Knowledge base', 'home') });
const campaign = repository('github:me/campaign@main', 'campaign', { title: 'Campaign', config: config('Campaign', 'campaign') });
const settings = (props: Partial<ManifestSettingsProps> = {}) => render(createElement(ManifestSettings, { repositories: [home, campaign], defaultRepository: home.id, initialRepository: home.id, onManifestRevision: () => {}, onRefreshWorkspace: async () => {}, ...props }));
const props = (repositories: WorkspaceRepository[], overrides: Partial<ManifestSettingsProps> = {}): ManifestSettingsProps => ({ repositories, defaultRepository: home.id, initialRepository: campaign.id, onManifestRevision: () => {}, onRefreshWorkspace: async () => {}, ...overrides });
const editorText = () => (screen.getByRole('textbox', { name: 'Workspace Manifest (.mygitnotes.yaml)' }) as HTMLTextAreaElement).value;
const showYaml = () => fireEvent.click(screen.getByRole('tab', { name: 'Advanced (YAML)' }));

it("opens on the current notebook's repository and saves its manifest there, with that repository's revision", async () => {
  const onManifestRevision = vi.fn();
  settings({ initialRepository: campaign.id, onManifestRevision });
  showYaml();
  expect(YAML.parse(editorText()).workspace.title).toBe('Campaign');
  fireEvent.click(screen.getByTitle('Save & Commit'));
  await waitFor(() => expect(updateWorkspaceConfig).toHaveBeenCalledTimes(1));
  expect(updateWorkspaceConfig.mock.calls[0][0]).toBe(campaign.id);
  expect(updateWorkspaceConfig.mock.calls[0][2]).toBe('campaign-rev');
  await waitFor(() => expect(onManifestRevision).toHaveBeenCalledWith(campaign.id, 'next'));
});

it('keeps the outcome of a save shown when the saved manifest comes back with its new revision', async () => {
  const view = settings({ initialRepository: campaign.id });
  fireEvent.click(screen.getByTitle('Save & Commit'));
  await screen.findByText('Workspace configuration saved and committed.');
  const saved = { ...campaign, title: 'Campaign renamed', config: config('Campaign renamed', 'campaign'), configRevision: 'next' };
  view.rerender(createElement(ManifestSettings, { repositories: [home, saved], defaultRepository: home.id, initialRepository: campaign.id, onManifestRevision: () => {}, onRefreshWorkspace: async () => {} }));
  expect(screen.getByText('Workspace configuration saved and committed.')).toBeInTheDocument();
  expect(screen.getByRole('textbox', { name: 'Workspace Title' })).toHaveValue('Campaign renamed');
});

it('switches the editor to the repository chosen in the selector, and keeps that choice', async () => {
  const view = settings();
  showYaml();
  expect(YAML.parse(editorText()).workspace.title).toBe('Knowledge base');
  const selector = screen.getByRole('combobox', { name: 'Repository' });
  fireEvent.keyDown(selector, { key: 'ArrowDown' });
  const listbox = await screen.findByRole('listbox');
  fireEvent.click(within(listbox).getByRole('option', { name: /Campaign/ }));
  // The editor opens afresh for the chosen repository.
  await waitFor(() => expect(screen.getByRole('textbox', { name: 'Workspace Title' })).toHaveValue('Campaign'));
  // A refreshed workspace does not take the person back to the repository Settings opened on.
  view.rerender(createElement(ManifestSettings, props([{ ...home, configRevision: 'moved' }, campaign], { initialRepository: home.id })));
  expect(screen.getByRole('textbox', { name: 'Workspace Title' })).toHaveValue('Campaign');
});

it('shows an unreadable manifest as its text, editable, so the person can fix and save it', async () => {
  // The repository is unavailable until its manifest loads, and Settings is where that manifest is fixed.
  const broken = repository('github:me/campaign@main', 'campaign', { notebooks: [], config: null, configRevision: 'broken-rev', manifestError: { message: 'bad indentation', text: 'workspace: [broken\n' }, unavailable: { reason: 'invalid-manifest', message: 'The manifest of me/campaign cannot be loaded: bad indentation' } });
  settings({ repositories: [home, broken], initialRepository: broken.id });
  expect(screen.getByRole('alert')).toHaveTextContent('bad indentation');
  showYaml();
  const editor = screen.getByRole('textbox', { name: 'Workspace Manifest (.mygitnotes.yaml)' }) as HTMLTextAreaElement;
  expect(editor.value).toBe('workspace: [broken\n');
  expect(editor).not.toHaveAttribute('readonly');
  fireEvent.change(editor, { target: { value: 'fixed' } });
  fireEvent.click(screen.getByTitle('Save & Commit'));
  await waitFor(() => expect(updateWorkspaceConfig).toHaveBeenCalledWith(broken.id, 'fixed', 'broken-rev'));
});

it('names why a repository it cannot reach is unavailable, and offers no editor for it', () => {
  settings({ repositories: [home, { ...campaign, notebooks: [], config: null, configRevision: '', write: false, unavailable: { reason: 'no-access', message: 'me/campaign is not accessible.' } }], initialRepository: campaign.id });
  expect(screen.getByRole('alert')).toHaveTextContent('me/campaign is not accessible.');
  expect(screen.queryByRole('textbox', { name: 'Workspace Title' })).not.toBeInTheDocument();
  expect(screen.getByTitle('Save & Commit')).toBeDisabled();
});

it("keeps a repository serving its core branch read-only, whatever the other repositories' branches", () => {
  settings({ repositories: [home, { ...campaign, branch: 'core' }], initialRepository: campaign.id });
  expect(screen.getByTitle('Workspace config can only be edited on the main branch')).toBeDisabled();
  cleanup();
  settings({ repositories: [home, { ...campaign, branch: 'core' }], initialRepository: home.id });
  expect(screen.getByTitle('Save & Commit')).toBeEnabled();
});

it("follows the current notebook's repository once the workspace loads", () => {
  // Settings opened from a notebook of another repository renders before the workspace answers.
  const view = render(createElement(ManifestSettings, props([], { initialRepository: '' })));
  view.rerender(createElement(ManifestSettings, props([home, campaign], { initialRepository: campaign.id })));
  expect(screen.getByRole('textbox', { name: 'Workspace Title' })).toHaveValue('Campaign');
});

it("keeps unsaved YAML when only the repository's revision moves, and saves it against the latest revision", async () => {
  const view = render(createElement(ManifestSettings, props([home, campaign])));
  showYaml();
  fireEvent.change(screen.getByRole('textbox', { name: 'Workspace Manifest (.mygitnotes.yaml)' }), { target: { value: 'edited: yes\n' } });
  // A note committed from Changes moves the branch head; the manifest text is unchanged.
  view.rerender(createElement(ManifestSettings, props([home, { ...campaign, configRevision: 'after-note' }])));
  expect(editorText()).toBe('edited: yes\n');
  // The manifest itself changes elsewhere: the person's text still stays.
  view.rerender(createElement(ManifestSettings, props([home, { ...campaign, title: 'Elsewhere', config: config('Elsewhere', 'campaign'), configRevision: 'after-manifest' }])));
  expect(editorText()).toBe('edited: yes\n');
  fireEvent.click(screen.getByTitle('Save & Commit'));
  await waitFor(() => expect(updateWorkspaceConfig).toHaveBeenCalledWith(campaign.id, 'edited: yes\n', 'after-manifest'));
});

it('follows a manifest that changes while the person has not edited it', () => {
  const view = render(createElement(ManifestSettings, props([home, campaign])));
  showYaml();
  view.rerender(createElement(ManifestSettings, props([home, { ...campaign, config: config('Renamed elsewhere', 'campaign'), configRevision: 'moved' }])));
  expect(YAML.parse(editorText()).workspace.title).toBe('Renamed elsewhere');
});

it("refreshes the repository on a conflict, keeping the person's text so it can be saved again", async () => {
  const changed = { ...campaign, title: 'Server version', config: config('Server version', 'campaign'), configRevision: 'server-rev' };
  let view: ReturnType<typeof render>;
  const onRefreshWorkspace = vi.fn(async () => {
    view.rerender(createElement(ManifestSettings, props([home, changed], { onRefreshWorkspace })));
  });
  view = render(createElement(ManifestSettings, props([home, campaign], { onRefreshWorkspace })));
  showYaml();
  fireEvent.change(screen.getByRole('textbox', { name: 'Workspace Manifest (.mygitnotes.yaml)' }), { target: { value: 'mine: yes\n' } });
  // The server's 409 goes through the real client, which must report its status.
  const { updateWorkspaceConfig: send } = await vi.importActual<typeof import('../lib/api.js')>('../lib/api.js');
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'The workspace manifest changed since it was read. Reload before saving.' }), { status: 409 })));
  updateWorkspaceConfig.mockImplementationOnce(send);
  fireEvent.click(screen.getByTitle('Save & Commit'));
  await screen.findByText(/changed on the server/);
  vi.unstubAllGlobals();
  expect(onRefreshWorkspace).toHaveBeenCalledTimes(1);
  expect(editorText()).toBe('mine: yes\n');
  fireEvent.click(screen.getByTitle('Save & Commit'));
  await waitFor(() => expect(updateWorkspaceConfig).toHaveBeenLastCalledWith(campaign.id, 'mine: yes\n', 'server-rev'));
  await screen.findByText('Workspace configuration saved and committed.');
});
