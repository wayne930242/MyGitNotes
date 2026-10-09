// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import type { ChangeEvent, ReactNode } from 'react';
import { I18nProvider } from '../lib/i18n/index.js';
import { type RenderAgentWorkspaceSection, WebFeaturesProvider } from '../lib/web-features.js';
import { AgentSystemView } from './AgentSystemView.js';
import type { AgentFile, AgentWorkspace } from '../lib/agent-workspaces.js';

const api = vi.hoisted(() => ({ fetchAgentWorkspaces: vi.fn(), fetchAgentResources: vi.fn(), fetchFileChanges: vi.fn(), fetchGitStatus: vi.fn(), readAgentResource: vi.fn(), renameAgentSkill: vi.fn(), restoreAgentResource: vi.fn(), saveAgentResource: vi.fn() }));

vi.mock('../lib/api.js', () => api);
vi.mock('./MarkdownEditor.js', () => ({ MarkdownEditor: ({ content, onChange, readOnly }: { content: string; onChange: (value: string) => void; readOnly: boolean; }) => <textarea aria-label='Agent document content' readOnly={readOnly} value={content} onChange={event => onChange(event.target.value)} />, MarkdownEditorModeSwitch: () => null }));
vi.mock('./FileSourceEditor.js', () => ({ FileSourceEditor: ({ content, label, onChange }: { content: string; label: string; onChange: (value: string) => void; }) => <textarea aria-label={`${label} (code)`} value={content} onChange={(event: ChangeEvent<HTMLTextAreaElement>) => onChange(event.target.value)} /> }));
vi.mock('./Select.js', () => ({ Select: ({ value, onValueChange, options, disabled, ...props }: { value: string; onValueChange: (value: string) => void; options: { value: string; label: string; }[]; disabled?: boolean; 'aria-label'?: string; }) => <select aria-label={props['aria-label']} value={value} disabled={disabled} onChange={event => onValueChange(event.target.value)}>{options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select> }));
vi.mock('./WorkspaceChrome.js', () => ({ useWorkspaceSidebarDrawer: () => ({ open: false, setOpen: vi.fn() }), WorkspaceSidebarPortal: ({ children }: { children: ReactNode; }) => children, WorkspaceSidebar: ({ children }: { children: ReactNode; }) => <aside>{children}</aside>, WorkspaceSidebarToggle: () => null }));
vi.mock('./EditorFooter.js', () => ({ EditorFooter: ({ content }: { content: string; }) => <div data-testid='footer-content-length'>{content.length}</div> }));

const home = 'local:home';
const repositories = [{ id: home, branch: 'main', write: true, notebooks: ['blog'], title: 'Knowledge Base' }];
const notebooks = [{ id: 'blog', title: 'Blog', root: 'blog/posts' }] as never[];
const status = (untracked: string[] = []) => ({ branch: 'main', isClean: untracked.length === 0, modified: [], staged: [], untracked, ahead: 0, behind: 0 });
const file = (path: string, folder: string, kind: AgentFile['kind'], skill?: string): AgentFile => ({ path, folder, kind, ...(skill ? { skill } : {}), editable: true });
const workspaces: AgentWorkspace[] = [{ repository: home, folder: '', hasInstructions: true, parents: [] }, { repository: home, folder: 'blog', hasInstructions: true, parents: [''] }];
const files = [file('AGENTS.md', '', 'instructions'), file('.agents/skills/review/SKILL.md', '', 'skill', 'review'), file('.agents/skills/review/references/style.md', '', 'reference', 'review'), file('.agents/skills/review/scripts/check.sh', '', 'script', 'review'), file('blog/AGENTS.md', 'blog', 'instructions'), file('blog/.agents/skills/proofread/SKILL.md', 'blog', 'skill', 'proofread')];
const contents: Record<string, string> = { 'AGENTS.md': '# Root\n', '.agents/skills/review/SKILL.md': '---\nname: review\ndescription: Review prose\n---\n# Review\nBody text.\n', '.agents/skills/review/references/style.md': '# Style\n', '.agents/skills/review/scripts/check.sh': 'echo ok\n', 'blog/AGENTS.md': '# Blog\n', 'blog/.agents/skills/proofread/SKILL.md': '---\nname: proofread\n---\nProofread.\n' };

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => {
    resolve = done;
  });
  return { promise, resolve };
}

function view({ sections = [], writable = true }: { sections?: RenderAgentWorkspaceSection[]; writable?: boolean; } = {}) {
  return render(
    <WebFeaturesProvider features={[{ id: 'edition', agentWorkspaceSections: sections }]}>
      <I18nProvider>
        <AgentSystemView notebooks={notebooks} folders={[]} repositories={repositories.map(repository => ({ ...repository, write: writable }))} homeRepository={home} onBusyChange={() => {}} />
      </I18nProvider>
    </WebFeaturesProvider>,
  );
}

/** An edition section that shows what the page hands it. */
const echoSection: RenderAgentWorkspaceSection = ({ workspace, readOnly }) => <section aria-label='Edition section'>{`${workspace.repository}|${workspace.folder}|${readOnly}`}</section>;

beforeEach(() => {
  localStorage.clear();
  api.fetchAgentWorkspaces.mockResolvedValue(workspaces);
  api.fetchAgentResources.mockResolvedValue({ workspaces, files });
  api.fetchGitStatus.mockResolvedValue({ status: status() });
  api.fetchFileChanges.mockResolvedValue([]);
  const disk = { ...contents };
  api.readAgentResource.mockImplementation(async (path: string) => ({ path, content: disk[path] ?? '' }));
  api.saveAgentResource.mockImplementation(async ({ path, content }: { path: string; content: string; }) => {
    disk[path] = content;
    return { success: true, path };
  });
});

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe('Agents page', () => {
  it('opens the home root on its core instructions and shows only its own skills, with reference files and scripts', async () => {
    view();
    await waitFor(() => expect(screen.getByLabelText('Agent document content')).toHaveValue('# Root\n'));
    expect(screen.getByRole('combobox', { name: 'Agent workspace' })).toHaveDisplayValue('Knowledge Base');
    const skills = screen.getByRole('region', { name: 'Skills' });
    fireEvent.click(within(skills).getByRole('button', { name: 'review' }));
    expect(within(skills).getByText('Reference files')).toBeInTheDocument();
    expect(within(skills).getByRole('button', { name: 'references/style.md' })).toBeInTheDocument();
    expect(within(skills).getByRole('button', { name: 'check.sh' })).toBeInTheDocument();
    expect(within(skills).queryByRole('button', { name: 'proofread' })).not.toBeInTheDocument();
    expect(screen.queryByText(/System guidelines|Notebook documents|Shared workspace/i)).not.toBeInTheDocument();
  });

  it('switches to an inner workspace, says which workspaces it also uses, and remembers the choice', async () => {
    view();
    await waitFor(() => expect(screen.getByLabelText('Agent document content')).toHaveValue('# Root\n'));
    fireEvent.change(screen.getByRole('combobox', { name: 'Agent workspace' }), { target: { value: `${home}\nblog` } });
    await waitFor(() => expect(screen.getByLabelText('Agent document content')).toHaveValue('# Blog\n'));
    expect(screen.getByText('Also uses the core instructions and skills of Knowledge Base.')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Skills' })).getByRole('button', { name: 'proofread' })).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem('mygitnotes.agents.workspace')!)).toEqual({ repository: home, folder: 'blog' });
  });

  it('names every workspace an inner one also uses as a list in the page language', async () => {
    const nested = [...workspaces, { repository: home, folder: 'blog/posts', hasInstructions: true, parents: ['', 'blog'] }];
    api.fetchAgentWorkspaces.mockResolvedValue(nested);
    api.fetchAgentResources.mockResolvedValue({ workspaces: nested, files: [...files, file('blog/posts/AGENTS.md', 'blog/posts', 'instructions')] });
    localStorage.setItem('mygitnotes.agents.workspace', JSON.stringify({ repository: home, folder: 'blog/posts' }));
    view();
    expect(await screen.findByText(/^Also uses the core instructions and skills of Knowledge Base and .+\.$/)).toBeInTheDocument();
    expect(screen.queryByText(/、/)).not.toBeInTheDocument();
  });

  it("renders an edition's sections below the skills for the selected workspace", async () => {
    view({ sections: [echoSection] });
    await waitFor(() => expect(screen.getByLabelText('Agent document content')).toHaveValue('# Root\n'));
    const section = screen.getByRole('region', { name: 'Edition section' });
    expect(section).toHaveTextContent(`${home}||false`);
    expect(screen.getByRole('region', { name: 'Skills' }).compareDocumentPosition(section) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.change(screen.getByRole('combobox', { name: 'Agent workspace' }), { target: { value: `${home}\nblog` } });
    await waitFor(() => expect(screen.getByRole('region', { name: 'Edition section' })).toHaveTextContent(`${home}|blog|false`));
  });

  it("tells an edition's sections when the workspace is read-only", async () => {
    view({ sections: [echoSection], writable: false });
    await waitFor(() => expect(screen.getByRole('region', { name: 'Edition section' })).toHaveTextContent(`${home}||true`));
  });

  it('opens a script in the code editor and a skill entry with its metadata beside the body', async () => {
    view();
    await waitFor(() => expect(screen.getByLabelText('Agent document content')).toHaveValue('# Root\n'));
    const skills = screen.getByRole('region', { name: 'Skills' });
    fireEvent.click(within(skills).getByRole('button', { name: 'review' }));
    fireEvent.click(within(skills).getByRole('button', { name: 'check.sh' }));
    expect(await screen.findByLabelText('Agent document content (code)')).toHaveValue('echo ok\n');
    fireEvent.click(within(skills).getByRole('button', { name: 'SKILL.md' }));
    await waitFor(() => expect(screen.getByLabelText('Agent document content')).toHaveValue('# Review\nBody text.\n'));
    expect(screen.getByTestId('footer-content-length')).toHaveTextContent(String('# Review\nBody text.\n'.length));
    const details = screen.getByRole('complementary', { name: 'Skill details' });
    expect(within(details).getByLabelText('Description')).toHaveValue('Review prose');
  });

  it('saves a pending draft before creating a skill in the selected workspace', async () => {
    view();
    await waitFor(() => expect(screen.getByLabelText('Agent document content')).toHaveValue('# Root\n'));
    fireEvent.change(screen.getByLabelText('Agent document content'), { target: { value: '# Root\nEdited\n' } });
    fireEvent.click(screen.getByRole('button', { name: 'New skill' }));
    fireEvent.change(screen.getByLabelText('New skill name'), { target: { value: 'fresh' } });
    fireEvent.click(screen.getByRole('button', { name: 'New skill' }));
    await waitFor(() => expect(api.saveAgentResource).toHaveBeenCalledWith(expect.objectContaining({ path: '.agents/skills/fresh/SKILL.md', create: true, repository: home })));
    const order = api.saveAgentResource.mock.calls.map((call: unknown[]) => (call[0] as { path: string; }).path);
    expect(order.indexOf('AGENTS.md')).toBeLessThan(order.indexOf('.agents/skills/fresh/SKILL.md'));
  });

  it('adds a reference file and a script to a skill', async () => {
    view();
    await waitFor(() => expect(screen.getByLabelText('Agent document content')).toHaveValue('# Root\n'));
    const skills = screen.getByRole('region', { name: 'Skills' });
    fireEvent.click(within(skills).getByRole('button', { name: 'review' }));
    fireEvent.click(within(skills).getByRole('button', { name: 'Add reference file' }));
    fireEvent.change(screen.getByLabelText('Reference file name'), { target: { value: 'tone' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(api.saveAgentResource).toHaveBeenCalledWith(expect.objectContaining({ path: '.agents/skills/review/references/tone.md', content: '# tone\n', create: true })));
    fireEvent.click(within(skills).getByRole('button', { name: 'Add script' }));
    fireEvent.change(screen.getByLabelText('Script name'), { target: { value: 'lint.py' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(api.saveAgentResource).toHaveBeenCalledWith(expect.objectContaining({ path: '.agents/skills/review/scripts/lint.py', content: '', create: true })));
  });

  it('offers to write core instructions for a root that has none', async () => {
    const bare = [{ repository: home, folder: '', hasInstructions: false, parents: [] }];
    api.fetchAgentWorkspaces.mockResolvedValue(bare);
    api.fetchAgentResources.mockResolvedValue({ workspaces: bare, files: [] });
    view();
    const write = await within(screen.getByRole('region', { name: 'Core instructions' })).findByRole('button', { name: 'Write core instructions' });
    fireEvent.click(write);
    await waitFor(() => expect(api.saveAgentResource).toHaveBeenCalledWith(expect.objectContaining({ path: 'AGENTS.md', create: true })));
    await waitFor(() => expect((screen.getByLabelText('Agent document content') as HTMLTextAreaElement).value).toContain('# Core instructions'));
  });

  it('saves the draft before renaming a skill from its name, and locks navigation meanwhile', async () => {
    const renamedFiles = files.map(entry => entry.skill === 'review' ? { ...entry, path: entry.path.replace('/review/', '/new-name/'), skill: 'new-name' } : entry);
    api.fetchAgentResources.mockResolvedValueOnce({ workspaces, files }).mockResolvedValueOnce({ workspaces, files: renamedFiles });
    api.fetchGitStatus.mockResolvedValue({ status: status(['.agents/skills/new-name/SKILL.md']) });
    const save = deferred<{ revision: string; }>();
    const rename = deferred<{ path: string; revision: string; }>();
    api.saveAgentResource.mockReturnValue(save.promise);
    api.renameAgentSkill.mockReturnValue(rename.promise);
    view();
    await waitFor(() => expect(screen.getByLabelText('Agent document content')).toHaveValue('# Root\n'));
    const skills = screen.getByRole('region', { name: 'Skills' });
    fireEvent.click(within(skills).getByRole('button', { name: 'review' }));
    fireEvent.click(within(skills).getByRole('button', { name: 'SKILL.md' }));
    await waitFor(() => expect(screen.getByLabelText('Agent document content')).toHaveValue('# Review\nBody text.\n'));
    fireEvent.change(screen.getByLabelText('Agent document content'), { target: { value: '# Review\nChanged.\n' } });
    const name = screen.getByLabelText('Name');
    fireEvent.change(name, { target: { value: 'new-name' } });
    fireEvent.keyDown(name, { key: 'Enter' });

    const content = '---\nname: review\ndescription: Review prose\n---\n# Review\nChanged.\n';
    await waitFor(() => expect(api.saveAgentResource).toHaveBeenCalledWith(expect.objectContaining({ path: '.agents/skills/review/SKILL.md', content })));
    expect(api.renameAgentSkill).not.toHaveBeenCalled();
    expect(within(skills).getByRole('button', { name: 'references/style.md' })).toBeDisabled();
    await act(async () => save.resolve({ revision: 'r2' }));
    await waitFor(() => expect(api.renameAgentSkill).toHaveBeenCalledWith(expect.objectContaining({ path: '.agents/skills/review/SKILL.md', slug: 'new-name', content, revision: 'r2' })));
    await act(async () => rename.resolve({ path: '.agents/skills/new-name/SKILL.md', revision: 'r3' }));
    await screen.findAllByText('.agents/skills/new-name/SKILL.md');
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Restore' })).not.toBeInTheDocument());
    expect(api.saveAgentResource).toHaveBeenCalledTimes(1);
  });
});
