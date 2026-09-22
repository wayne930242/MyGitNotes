// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import type { ReactNode } from 'react';
import { I18nProvider } from '../lib/i18n/index.js';
import { AgentSystemView } from './AgentSystemView.js';

const api = vi.hoisted(() => ({
  fetchAgentResources: vi.fn(),
  fetchFileChanges: vi.fn(),
  fetchGitStatus: vi.fn(),
  readAgentResource: vi.fn(),
  renameAgentSkill: vi.fn(),
  restoreAgentResource: vi.fn(),
  saveAgentResource: vi.fn(),
}));

vi.mock('../lib/api.js', () => api);
vi.mock('./MarkdownEditor.js', () => ({
  MarkdownEditor: ({ content, onChange, readOnly }: { content: string; onChange: (value: string) => void; readOnly: boolean; }) => <textarea aria-label='Agent document content' readOnly={readOnly} value={content} onChange={event => onChange(event.target.value)} />,
  MarkdownEditorModeSwitch: () => null,
}));
vi.mock('./AgentFileTree.js', () => ({
  AgentFileTree: ({ resources, onSelect, disabled }: { resources: Array<{ path: string; }>; onSelect: (path: string) => void; disabled: boolean; }) => <>{resources.map(resource => <button type='button' key={resource.path} disabled={disabled} onClick={() => onSelect(resource.path)}>{resource.path}</button>)}</>,
}));
vi.mock('./WorkspaceChrome.js', () => ({
  useWorkspaceSidebarDrawer: () => ({ open: false, setOpen: vi.fn() }),
  WorkspaceSidebarPortal: ({ children }: { children: ReactNode; }) => children,
  WorkspaceSidebar: ({ children }: { children: ReactNode; }) => <aside>{children}</aside>,
  WorkspaceSidebarToggle: () => null,
}));
vi.mock('./EditorFooter.js', () => ({ EditorFooter: () => null }));

const oldPath = '.agents/skills/old-name/SKILL.md';
const newPath = '.agents/skills/new-name/SKILL.md';
const otherPath = 'notes/AGENTS.md';
const oldContent = '---\nname: old-name\ndescription: Old\n---\nBody\n';
const newContent = '---\nname: old-name\ndescription: Changed\n---\nBody\n';
const status = (untracked: string[] = []) => ({ branch: 'main', isClean: untracked.length === 0, modified: [], staged: [], untracked, ahead: 0, behind: 0 });

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe('Agent skill rename sequencing', () => {
  it('saves the draft before moving, locks document selection, and hides Restore for the renamed untracked skill', async () => {
    const initial = { instructions: [{ path: otherPath, name: 'Notebook', editable: true, scope: 'notebook' }], skills: [{ path: oldPath, name: 'Old', editable: true, scope: 'workspace' }], docs: [], revision: 'r1' };
    const renamed = { instructions: initial.instructions, skills: [{ path: newPath, name: 'New', editable: true, scope: 'workspace' }], docs: [], revision: 'r3' };
    api.fetchAgentResources.mockResolvedValueOnce(initial).mockResolvedValueOnce(renamed);
    api.fetchGitStatus.mockResolvedValue({ status: status([newPath]) });
    api.fetchFileChanges.mockResolvedValue([]);
    api.readAgentResource.mockImplementation(async (path: string) => ({ path, content: path === oldPath ? oldContent : '# Notebook\n', revision: 'r1' }));
    const save = deferred<{ revision: string; }>();
    const rename = deferred<{ path: string; revision: string; }>();
    api.saveAgentResource.mockReturnValue(save.promise);
    api.renameAgentSkill.mockReturnValue(rename.promise);

    render(<I18nProvider><AgentSystemView notebooks={[]} selectedNotebookId='' onBusyChange={() => {}} /></I18nProvider>);
    fireEvent.click(await screen.findByRole('button', { name: oldPath }));
    await waitFor(() => expect(screen.getByLabelText('Agent document content')).toHaveValue(oldContent));
    const editor = screen.getByLabelText('Agent document content');
    fireEvent.change(editor, { target: { value: newContent } });
    fireEvent.change(screen.getByLabelText('Slug'), { target: { value: 'new-name' } });
    fireEvent.click(screen.getByRole('button', { name: 'Rename' }));

    await waitFor(() => expect(api.saveAgentResource).toHaveBeenCalledWith(expect.objectContaining({ path: oldPath, content: newContent })));
    expect(api.renameAgentSkill).not.toHaveBeenCalled();
    expect(editor).toHaveAttribute('readonly');
    expect(screen.getByRole('combobox', { name: 'Agent document' })).toBeDisabled();
    const other = screen.getByRole('button', { name: otherPath });
    const otherReads = api.readAgentResource.mock.calls.filter(([path]) => path === otherPath).length;
    expect(other).toBeDisabled();
    fireEvent.click(other);
    expect(api.readAgentResource.mock.calls.filter(([path]) => path === otherPath)).toHaveLength(otherReads);

    await act(async () => save.resolve({ revision: 'r2' }));
    await waitFor(() => expect(api.renameAgentSkill).toHaveBeenCalledWith(expect.objectContaining({ path: oldPath, slug: 'new-name', content: newContent, revision: 'r2' })));
    expect(api.saveAgentResource.mock.invocationCallOrder[0]).toBeLessThan(api.renameAgentSkill.mock.invocationCallOrder[0]);
    await act(async () => rename.resolve({ path: newPath, revision: 'r3' }));

    await screen.findAllByText(newPath);
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Restore' })).not.toBeInTheDocument());
    expect(screen.getByRole('status')).toHaveTextContent('Skill renames cannot be undone here. Use Git to restore the directory and updated references together.');
    expect(api.saveAgentResource).toHaveBeenCalledTimes(1);
  });
});
