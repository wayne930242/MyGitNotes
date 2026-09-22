// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import type { ReactNode } from 'react';
import { I18nProvider } from '../lib/i18n/index.js';
import { AgentSystemView } from './AgentSystemView.js';

const api = vi.hoisted(() => ({ fetchAgentResources: vi.fn(), fetchFileChanges: vi.fn(), fetchGitStatus: vi.fn(), readAgentResource: vi.fn(), renameAgentSkill: vi.fn(), restoreAgentResource: vi.fn(), saveAgentResource: vi.fn() }));

vi.mock('../lib/api.js', () => api);
vi.mock('./MarkdownEditor.js', () => ({ MarkdownEditor: ({ content, onChange, readOnly }: { content: string; onChange: (value: string) => void; readOnly: boolean; }) => <textarea aria-label='Agent document content' readOnly={readOnly} value={content} onChange={event => onChange(event.target.value)} />, MarkdownEditorModeSwitch: () => null }));
vi.mock('./AgentFileTree.js', () => ({ AgentFileTree: ({ resources, onSelect, disabled }: { resources: Array<{ path: string; }>; onSelect: (path: string) => void; disabled: boolean; }) => <>{resources.map(resource => <button type='button' key={resource.path} disabled={disabled} onClick={() => onSelect(resource.path)}>{resource.path}</button>)}</> }));
vi.mock('./WorkspaceChrome.js', () => ({ useWorkspaceSidebarDrawer: () => ({ open: false, setOpen: vi.fn() }), WorkspaceSidebarPortal: ({ children }: { children: ReactNode; }) => children, WorkspaceSidebar: ({ children }: { children: ReactNode; }) => <aside>{children}</aside>, WorkspaceSidebarToggle: () => null }));
vi.mock('./EditorFooter.js', () => ({ EditorFooter: () => null }));

const docPath = 'notes/AGENTS.md';
const skillPath = '.agents/skills/fresh/SKILL.md';
const status = (untracked: string[] = []) => ({ branch: 'main', isClean: untracked.length === 0, modified: [], staged: [], untracked, ahead: 0, behind: 0 });

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe('Agent skill creation sequencing', () => {
  it('flushes an unsaved draft on the current document before creating a new skill', async () => {
    const initial = { instructions: [{ path: docPath, name: 'Notebook', editable: true, scope: 'notebook' }], skills: [], docs: [], revision: 'r1' };
    api.fetchAgentResources.mockResolvedValue(initial);
    api.fetchGitStatus.mockResolvedValue({ status: status() });
    api.fetchFileChanges.mockResolvedValue([]);
    api.readAgentResource.mockImplementation(async (path: string) => ({ path, content: path === docPath ? '# Notebook\n' : '', revision: 'r1' }));
    api.saveAgentResource.mockImplementation(async ({ path }: { path: string; }) => ({ success: true, path, revision: path === docPath ? 'r2' : 'r3' }));

    render(
      <I18nProvider>
        <AgentSystemView notebooks={[]} selectedNotebookId='' onBusyChange={() => {}} />
      </I18nProvider>,
    );
    fireEvent.click(await screen.findByRole('button', { name: docPath }));
    await waitFor(() => expect(screen.getByLabelText('Agent document content')).toHaveValue('# Notebook\n'));

    // Edit the current document, then immediately create a skill within the 750ms debounce
    // window: without an explicit flush, switching selectedPath tears down the pending
    // debounce timer's effect and the draft above is lost outright.
    fireEvent.change(screen.getByLabelText('Agent document content'), { target: { value: '# Notebook\nEdited\n' } });
    fireEvent.click(screen.getByRole('button', { name: 'New Skill' }));
    fireEvent.change(screen.getByLabelText('New skill slug'), { target: { value: 'fresh' } });
    fireEvent.click(screen.getByRole('button', { name: 'New Skill' }));

    await waitFor(() => expect(api.saveAgentResource).toHaveBeenCalledWith(expect.objectContaining({ path: docPath, content: '# Notebook\nEdited\n' })));
    await waitFor(() => expect(api.saveAgentResource).toHaveBeenCalledWith(expect.objectContaining({ path: skillPath, create: true })));
    const order = api.saveAgentResource.mock.calls.map((call: unknown[]) => (call[0] as { path: string; }).path);
    expect(order.indexOf(docPath)).toBeLessThan(order.indexOf(skillPath));
  });
});
