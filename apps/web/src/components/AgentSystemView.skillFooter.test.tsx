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
vi.mock('./EditorFooter.js', () => ({ EditorFooter: ({ content }: { content: string; }) => <div data-testid='footer-content-length'>{content.length}</div> }));

const skillPath = '.agents/skills/review/SKILL.md';
const frontmatter = '---\nname: review\ndescription: Review prose\n---\n';
const body = '# Review\nBody text.\n';
const status = () => ({ branch: 'main', isClean: true, modified: [], staged: [], untracked: [], ahead: 0, behind: 0 });

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe('Agent skill editor footer', () => {
  it('counts only the visible body, excluding the hidden frontmatter block', async () => {
    api.fetchAgentResources.mockResolvedValue({ instructions: [], skills: [{ path: skillPath, name: 'review', editable: true, scope: 'workspace' }], docs: [], revision: 'r1' });
    api.fetchGitStatus.mockResolvedValue({ status: status() });
    api.fetchFileChanges.mockResolvedValue([]);
    api.readAgentResource.mockResolvedValue({ path: skillPath, content: frontmatter + body, revision: 'r1' });

    render(
      <I18nProvider>
        <AgentSystemView notebooks={[]} selectedNotebookId='' onBusyChange={() => {}} />
      </I18nProvider>,
    );
    fireEvent.click(await screen.findByRole('button', { name: skillPath }));
    await waitFor(() => expect(screen.getByLabelText('Agent document content')).toHaveValue(body));
    expect(screen.getByTestId('footer-content-length')).toHaveTextContent(String(body.length));
  });
});
