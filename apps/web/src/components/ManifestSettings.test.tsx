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
vi.mock('../lib/api.js', () => ({ updateWorkspaceConfig }));

beforeAll(() => {
  // Radix Select measures and captures the pointer, which jsdom does not implement.
  Element.prototype.scrollIntoView = () => {};
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.releasePointerCapture = () => {};
});
afterEach(() => {
  cleanup();
  updateWorkspaceConfig.mockClear();
});

const config = (title: string, id: string): WorkspaceConfig => ({ schema_version: 3, workspace: { title, default_notebook: id }, notebooks: [{ id, title: id, root: `notes/${id}` }], preferences: DEFAULT_WORKSPACE_PREFERENCES });
const repository = (id: string, alias: string, overrides: Partial<WorkspaceRepository> = {}): WorkspaceRepository => ({ id, alias, type: 'github', repository: `me/${alias}`, branch: 'main', revision: 'a'.repeat(40), write: true, notebooks: [`${alias}~${alias}`], title: alias, defaultNotebook: `${alias}~${alias}`, preferences: DEFAULT_WORKSPACE_PREFERENCES, config: config(alias, alias), configRevision: `${alias}-rev`, ...overrides });
const home = repository('github:me/home@main', 'home', { title: 'Knowledge base', config: config('Knowledge base', 'home') });
const campaign = repository('github:me/campaign@main', 'campaign', { title: 'Campaign', config: config('Campaign', 'campaign') });
const settings = (props: Partial<ManifestSettingsProps> = {}) => render(createElement(ManifestSettings, { repositories: [home, campaign], homeRepository: home.id, initialRepository: home.id, onManifestRevision: () => {}, onRefreshWorkspace: async () => {}, ...props }));
const editorText = () => (screen.getByRole('textbox', { name: 'Workspace Manifest (.mygitnotes.yaml)' }) as HTMLTextAreaElement).value;
const showYaml = () => fireEvent.click(screen.getByRole('tab', { name: 'Advanced (YAML)' }));

it("opens on the current notebook's repository and saves its manifest there, with that repository's revision", async () => {
  const onManifestRevision = vi.fn();
  settings({ initialRepository: campaign.id, onManifestRevision });
  showYaml();
  expect(YAML.parse(editorText()).workspace.title).toBe('Campaign');
  expect(screen.getByText(/still comes from the home manifest/)).toBeInTheDocument();
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
  view.rerender(createElement(ManifestSettings, { repositories: [home, saved], homeRepository: home.id, initialRepository: campaign.id, onManifestRevision: () => {}, onRefreshWorkspace: async () => {} }));
  expect(screen.getByText('Workspace configuration saved and committed.')).toBeInTheDocument();
  expect(screen.getByRole('textbox', { name: 'Workspace Title' })).toHaveValue('Campaign renamed');
});

it('switches the editor to the repository chosen in the selector', async () => {
  settings();
  showYaml();
  expect(YAML.parse(editorText()).workspace.title).toBe('Knowledge base');
  expect(screen.queryByText(/still comes from the home manifest/)).not.toBeInTheDocument();
  const selector = screen.getByRole('combobox', { name: 'Repository' });
  fireEvent.keyDown(selector, { key: 'ArrowDown' });
  const listbox = await screen.findByRole('listbox');
  fireEvent.click(within(listbox).getByRole('option', { name: /Campaign/ }));
  // The editor opens afresh for the chosen repository.
  await waitFor(() => expect(screen.getByRole('textbox', { name: 'Workspace Title' })).toHaveValue('Campaign'));
  expect(screen.getByText(/still comes from the home manifest/)).toBeInTheDocument();
});

it('shows an unreadable manifest as its text, editable, so the person can fix and save it', async () => {
  const broken = repository('github:me/campaign@main', 'campaign', { config: null, configRevision: 'broken-rev', manifestError: { message: 'bad indentation', text: 'workspace: [broken\n' } });
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

it('warns when the default notebook names one the repository does not serve', () => {
  settings({ repositories: [home, { ...campaign, unservedDefault: 'elsewhere' }], initialRepository: campaign.id });
  expect(screen.getByRole('status')).toHaveTextContent('default_notebook names elsewhere');
});

it("keeps a repository serving its core branch read-only, whatever the other repositories' branches", () => {
  settings({ repositories: [home, { ...campaign, branch: 'core' }], initialRepository: campaign.id });
  expect(screen.getByTitle('Workspace config can only be edited on the main branch')).toBeDisabled();
  cleanup();
  settings({ repositories: [home, { ...campaign, branch: 'core' }], initialRepository: home.id });
  expect(screen.getByTitle('Save & Commit')).toBeEnabled();
});
