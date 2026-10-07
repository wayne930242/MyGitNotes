import { Button } from './Button.js';
import { useWorkspaceLinks } from './WorkspaceLinks.js';
import { AgentFileTree } from './AgentFileTree.js';
import { useWorkspaceSidebarDrawer, WorkspaceSidebar, WorkspaceSidebarPortal, WorkspaceSidebarToggle } from './WorkspaceChrome.js';
import { EditorNotice } from './EditorNotice.js';
import { EditorFooter } from './EditorFooter.js';
import { Select } from './Select.js';
import { FolderPickerDialog } from './FolderPickerDialog.js';
import React, { lazy, Suspense, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Bot, Braces, FileText, FolderPlus, History, Plus, RotateCcw } from 'lucide-react';
import { NoteHistoryPanel } from './NoteHistoryPanel.js';
import { MarkdownEditor, MarkdownEditorMode, MarkdownEditorModeSwitch } from './MarkdownEditor.js';
import type { FolderItem, GitStatus, NotebookConfig } from '../lib/types.js';
import type { RepositoryStatus } from '@mygitnotes/core/repository';
import { fetchAgentResources, fetchAgentWorkspaces, fetchFileChanges, fetchGitStatus, readAgentResource, renameAgentSkill, restoreAgentResource, saveAgentResource } from '../lib/api.js';
import { type AgentFile, type AgentSkill, type AgentWorkspace, instructionsPath, isScript, newSkillFileName, sameWorkspace, workspaceKey, workspaceName, workspaceSkills } from '../lib/agent-workspaces.js';
import { useTranslation } from '../lib/i18n/index.js';
import { useAgentWorkspaceSections } from '../lib/web-features.js';
import { LoadingStatus } from './LoadingStatus.js';
import { AgentSkillMetadataPanel } from './AgentSkillMetadataPanel.js';
import { agentSkillLocation, newAgentSkillEntryContent, newAgentSkillEntryPath, splitAgentSkillContent } from '@mygitnotes/core/agent-skill-metadata';

// CodeMirror's code editor loads only when a script opens.
const FileSourceEditor = lazy(() => import('./FileSourceEditor.js').then(module => ({ default: module.FileSourceEditor })));

export interface AgentSystemHandle {
  prepareNotebookChange: (id: string) => Promise<boolean>;
  prepareLeave: () => Promise<boolean>;
  refresh: () => Promise<void>;
}

const WORKSPACE_KEY = 'mygitnotes.agents.workspace';
type WorkspaceRef = Pick<AgentWorkspace, 'repository' | 'folder'>;

function savedWorkspace(): WorkspaceRef | undefined {
  try {
    const saved = JSON.parse(localStorage.getItem(WORKSPACE_KEY) || 'null') as Partial<WorkspaceRef> | null;
    return typeof saved?.repository === 'string' && typeof saved.folder === 'string' ? { repository: saved.repository, folder: saved.folder } : undefined;
  } catch {
    return undefined;
  }
}

function rememberWorkspace({ repository, folder }: WorkspaceRef) {
  try {
    localStorage.setItem(WORKSPACE_KEY, JSON.stringify({ repository, folder }));
  } catch { /* The choice still applies until the page reloads. */ }
}

/** The file a workspace opens on: its core instructions, else its first skill. */
function defaultFile(files: AgentFile[], folder: string): string {
  return files.find(file => file.folder === folder && file.kind === 'instructions')?.path ?? workspaceSkills(files, folder)[0]?.entry?.path ?? '';
}

interface AgentSystemViewProps {
  remote?: boolean;
  onGitStatus?: (status: GitStatus) => void;
  notebooks: NotebookConfig[];
  /** The selected notebook's folders, for picking the folder of a new workspace. */
  folders: FolderItem[];
  repositories: Pick<RepositoryStatus, 'id' | 'repository' | 'branch' | 'write' | 'notebooks'>[];
  /** The home repository, whose root workspace is named by the workspace title and whose Git status the app shows. */
  homeRepository: string;
  workspaceTitle: string;
  onBusyChange: (busy: boolean) => void;
}

/** The Agents page: pick an agent workspace, then edit its core instructions and its skills with their reference files and scripts. */
export const AgentSystemView = React.forwardRef<AgentSystemHandle, AgentSystemViewProps>(({ remote = false, notebooks, folders, repositories, homeRepository, workspaceTitle, onBusyChange, onGitStatus }, ref) => {
  const { t, language } = useTranslation();
  const sidebar = useWorkspaceSidebarDrawer();
  const sections = useAgentWorkspaceSections();
  const [workspaces, setWorkspaces] = useState<AgentWorkspace[]>([]);
  const [selected, setSelected] = useState<WorkspaceRef>(() => savedWorkspace() ?? { repository: homeRepository, folder: '' });
  const [files, setFiles] = useState<AgentFile[]>([]);
  const [selectedPath, setSelectedPath] = useState<string>('');
  const [historyOpen, setHistoryOpen] = useState(false);
  const [content, setContent] = useState<string>('');
  const [viewMode, setViewMode] = useState<MarkdownEditorMode>('live');
  const [loadedPath, setLoadedPath] = useState('');
  const [savedContent, setSavedContent] = useState('');
  const [error, setError] = useState('');
  const [switching, setSwitching] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [contentLoading, setContentLoading] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [renamingSkill, setRenamingSkill] = useState(false);
  const [addingWorkspace, setAddingWorkspace] = useState(false);
  const [metadataOpen, setMetadataOpen] = useState(true);
  /** The inline name box for a new skill, or a new reference file or script of one skill. */
  const [creating, setCreating] = useState<{ kind: 'skill'; } | { kind: 'reference' | 'script'; skill: AgentSkill; } | null>(null);
  const [newName, setNewName] = useState('');
  const repository = selected.repository;
  const revision = useRef<string>();
  const saveQueue = useRef<Promise<void>>(Promise.resolve());
  const saveTimer = useRef<ReturnType<typeof setTimeout>>();
  const current = useRef({ path: selectedPath, content });
  /* eslint-disable react/refs -- Keep the current callback in a ref for an imperative listener without recreating its subscription. */
  current.current = { path: selectedPath, content };
  /* eslint-enable react/refs */
  const pendingSaves = useRef(0);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const hasUnsavedChanges = loadedPath === selectedPath && content !== savedContent;
  const loading = initialLoading || contentLoading || (selectedPath !== '' && loadedPath !== selectedPath);

  const repositoryStatus = repositories.find(candidate => candidate.id === repository);
  const readOnly = !repositoryStatus?.write;
  const readOnlyNotice = t(remote ? 'agent.remoteReadOnlyNotice' : repositoryStatus?.branch === 'core' ? 'agent.coreBranchNotice' : 'agent.workspaceReadOnlyNotice');
  const workspace = workspaces.find(candidate => sameWorkspace(candidate, selected));
  const currentFile = files.find(file => file.path === selectedPath);
  const editable = !readOnly && currentFile?.editable !== false;
  const locked = !editable || loading || switching || restoring || renamingSkill;
  const isSkillEntry = Boolean(agentSkillLocation(selectedPath));
  const script = isScript(selectedPath);
  const skillSplit = isSkillEntry ? splitAgentSkillContent(content) : null;
  const bodyContent = skillSplit ? skillSplit.body : content;
  const handleBodyChange = (nextBody: string) => setContent(skillSplit ? skillSplit.frontmatter + nextBody : nextBody);
  const [confirmRestore, setConfirmRestore] = useState<boolean>(false);
  const [fileStatus, setFileStatus] = useState<GitStatus | null>(null);
  const [restorableFiles, setRestorableFiles] = useState<Record<string, string>>({});
  const canRestore = !remote && !locked && !isSaving && Boolean(fileStatus && (fileStatus.modified.includes(selectedPath) || fileStatus.staged.includes(selectedPath)) && restorableFiles[selectedPath]);
  // History reads again for a new file or repository, not on every render.
  const historyTarget = useMemo(() => ({ path: selectedPath, repository }), [selectedPath, repository]);
  const historyDirty = hasUnsavedChanges || Boolean(fileStatus && (fileStatus.modified.includes(selectedPath) || fileStatus.staged.includes(selectedPath)));
  // An agent file is edited as its whole text, so the history compares with and restores into that text.
  const historyCurrent = useCallback(() => content, [content]);
  const renameRestoreLimited = !remote && isSkillEntry && Boolean(fileStatus?.untracked.includes(selectedPath));
  const showRestore = !remote && !renameRestoreLimited;
  const skills = workspaceSkills(files, selected.folder);
  const instructions = files.find(file => file.folder === selected.folder && file.kind === 'instructions');
  const label = (candidate: WorkspaceRef) => workspaceName(candidate, { home: homeRepository, title: workspaceTitle, repositories });
  const refreshGitStatus = async () => {
    if (remote) return;
    const { status } = await fetchGitStatus(repository);
    const changes = (await fetchFileChanges()).filter(file => file.repository === repository);
    setRestorableFiles(Object.fromEntries(changes.filter(file => file.available && file.tracked).map(file => [file.path, file.revision])));
    setFileStatus(status);
    if (repository === homeRepository) onGitStatus?.(status);
  };
  const restoreTimerRef = useRef<NodeJS.Timeout | null>(null);

  /** Lists every workspace and the files of the chosen one's repository; a chosen workspace that is gone falls back to the home root. */
  const loadWorkspace = async (wanted: WorkspaceRef, path?: string) => {
    const all = await fetchAgentWorkspaces();
    const target = all.find(candidate => sameWorkspace(candidate, wanted)) ?? { repository: homeRepository, folder: '' };
    const listing = await fetchAgentResources(target.repository);
    revision.current = listing.revision;
    setWorkspaces(all);
    setFiles(listing.files);
    setSelected({ repository: target.repository, folder: target.folder });
    setLoadedPath('');
    setSelectedPath(path ?? defaultFile(listing.files, target.folder));
  };

  /* eslint-disable react-hooks/exhaustive-deps -- The first load runs once; later loads follow explicit workspace choices. */
  useEffect(() => {
    setInitialLoading(true);
    loadWorkspace(selected).catch(error => setError((error as Error).message)).finally(() => setInitialLoading(false));
  }, []);
  /* eslint-enable react-hooks/exhaustive-deps */

  /* eslint-disable react-hooks/exhaustive-deps -- Only a new selected path starts the read; changing save/status callbacks must not reload and overwrite an active resource draft. */
  useEffect(() => {
    if (!selectedPath) {
      /* eslint-disable react/set-state-in-effect -- The resource read clears stale content and status before its cancellable request; keep this transition ordered with queued saves. */
      setContent('');
      /* eslint-enable react/set-state-in-effect */
      setSavedContent('');
      setLoadedPath('');
      return;
    }
    let cancelled = false;
    setContentLoading(true);
    setFileStatus(null);
    void refreshGitStatus().catch(error => setError(error.message));
    setError('');
    setLoadedPath('');
    setConfirmRestore(false);
    if (restoreTimerRef.current) clearTimeout(restoreTimerRef.current);
    void readAgentResource(selectedPath, repository).then((resource) => {
      if (cancelled) return;
      if (resource.revision) revision.current = resource.revision;
      setContent(resource.content);
      setSavedContent(resource.content);
      setLoadedPath(selectedPath);
    }).catch((error) => {
      if (!cancelled) setError((error as Error).message);
    }).finally(() => {
      if (!cancelled) setContentLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [selectedPath, repository]);
  /* eslint-enable react-hooks/exhaustive-deps */

  const saveDocument = async (file: string, snapshot: string) => {
    pendingSaves.current++;
    setIsSaving(true);
    const target = repository;
    const request = saveQueue.current.catch(() => {}).then(async () => {
      const receipt = await saveAgentResource({ path: file, content: snapshot, revision: revision.current, repository: target });
      revision.current = receipt.revision;
      if (current.current.path === file) setSavedContent(snapshot);
      await refreshGitStatus();
    });
    saveQueue.current = request;
    try {
      await request;
    } finally {
      pendingSaves.current--;
      setIsSaving(pendingSaves.current > 0);
    }
  };

  /* eslint-disable react-hooks/exhaustive-deps -- The debounce restarts for draft and lock changes; helper recreation from Git-status responses must not restart its 750 ms deadline. */
  useEffect(() => {
    if (locked || !hasUnsavedChanges) return;
    saveTimer.current = setTimeout(() => {
      void saveDocument(selectedPath, content).then(() => setError('')).catch((error) => setError(error.message));
    }, 750);
    return () => clearTimeout(saveTimer.current);
  }, [content, hasUnsavedChanges, selectedPath, locked]);
  /* eslint-enable react-hooks/exhaustive-deps */

  /** Saves a pending draft of the open file; every switch, creation and rename waits for it first. */
  const flush = async () => {
    clearTimeout(saveTimer.current);
    if (hasUnsavedChanges && editable) await saveDocument(selectedPath, content);
    else await saveQueue.current;
  };

  const selectDocument = async (file: string) => {
    if (switching || restoring || renamingSkill) return false;
    if (file === selectedPath) return true;
    setSwitching(true);
    setError('');
    try {
      await flush();
      setLoadedPath('');
      setSelectedPath(file);
      return true;
    } catch (error) {
      setError((error as Error).message);
      return false;
    } finally {
      setSwitching(false);
    }
  };

  const selectWorkspace = async (next: WorkspaceRef, path?: string) => {
    if (switching || restoring || renamingSkill) return;
    setSwitching(true);
    setError('');
    try {
      await flush();
      rememberWorkspace(next);
      setCreating(null);
      await loadWorkspace(next, path);
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setSwitching(false);
    }
  };

  const handleRestoreClick = async () => {
    if (!canRestore) return;
    if (!confirmRestore) {
      setConfirmRestore(true);
      restoreTimerRef.current = setTimeout(() => setConfirmRestore(false), 4000);
      return;
    }
    clearTimeout(saveTimer.current);
    if (restoreTimerRef.current) clearTimeout(restoreTimerRef.current);
    setConfirmRestore(false);
    setRestoring(true);
    setError('');
    try {
      await saveQueue.current.catch(() => {});
      const resource = await restoreAgentResource(selectedPath, restorableFiles[selectedPath], repository);
      setContent(resource.content);
      setSavedContent(resource.content);
      await refreshGitStatus();
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setRestoring(false);
    }
  };
  useEffect(() => () => {
    if (restoreTimerRef.current) clearTimeout(restoreTimerRef.current);
  }, []);

  /** Writes a new file and opens it; `create` makes the server refuse to replace one that already exists. */
  const createFile = async (path: string, fileContent: string, kind: AgentFile['kind'], skill?: string) => {
    const receipt = await saveAgentResource({ path, content: fileContent, revision: revision.current, create: true, repository });
    revision.current = receipt.revision;
    setFiles(previous => [...previous.filter(file => file.path !== path), { path, folder: selected.folder, kind, ...(skill ? { skill } : {}), editable: true }]);
    setSelectedPath(path);
    setContent(fileContent);
    setSavedContent(fileContent);
    setLoadedPath(path);
  };

  const handleCreate = async () => {
    if (readOnly || isCreating || renamingSkill || !creating) return;
    setIsCreating(true);
    setError('');
    try {
      await flush();
      if (creating.kind === 'skill') {
        const slug = newName.trim();
        await createFile(newAgentSkillEntryPath(slug, selected.folder), newAgentSkillEntryContent(slug), 'skill', slug);
      } else {
        const name = newSkillFileName(newName, creating.kind);
        const path = creating.kind === 'script' ? `${creating.skill.directory}/scripts/${name}` : `${creating.skill.directory}/references/${name}`;
        await createFile(path, creating.kind === 'script' ? '' : `# ${name.replace(/\.[^.]+$/, '')}\n`, creating.kind, creating.skill.name);
      }
      setCreating(null);
      setNewName('');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsCreating(false);
    }
  };

  const handleCreateInstructions = async () => {
    if (readOnly || isCreating || renamingSkill) return;
    setIsCreating(true);
    setError('');
    try {
      await flush();
      await createFile(instructionsPath(selected.folder), t('agent.instructionsStarter'), 'instructions');
      setWorkspaces(previous => previous.map(candidate => sameWorkspace(candidate, selected) ? { ...candidate, hasInstructions: true } : candidate));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsCreating(false);
    }
  };

  /** Makes a notebook folder a workspace by writing its core instructions, or opens it when it already is one. */
  const handleAddWorkspace = async (notebookId: string, folder: string | null) => {
    const notebook = notebooks.find(candidate => candidate.id === notebookId);
    const owner = repositories.find(candidate => candidate.notebooks.includes(notebookId))?.id;
    if (!notebook || !owner) return;
    const target = { repository: owner, folder: [notebook.root.replace(/\/+$/, ''), folder].filter(Boolean).join('/') };
    setIsCreating(true);
    setError('');
    try {
      await flush();
      if (!workspaces.some(candidate => sameWorkspace(candidate, target))) {
        const { revision: ownerRevision } = await fetchAgentResources(owner);
        await saveAgentResource({ path: instructionsPath(target.folder), content: t('agent.instructionsStarter'), revision: ownerRevision, create: true, repository: owner });
      }
      setAddingWorkspace(false);
      rememberWorkspace(target);
      await loadWorkspace(target, instructionsPath(target.folder));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsCreating(false);
    }
  };

  const handleRenameSkill = async (slug: string) => {
    if (!isSkillEntry || locked || renamingSkill) return;
    setRenamingSkill(true);
    setError('');
    try {
      await flush();
      const receipt = await renameAgentSkill({ path: selectedPath, slug, content, revision: revision.current, repository });
      revision.current = receipt.revision;
      const listing = await fetchAgentResources(repository);
      setFiles(listing.files);
      setSelectedPath(receipt.path);
      setLoadedPath(receipt.path);
      setSavedContent(content);
      await refreshGitStatus();
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setRenamingSkill(false);
    }
  };

  const { registerBeforeNavigate } = useWorkspaceLinks();
  const prepareLeave = async () => {
    if (switching || restoring || loading || renamingSkill) return false;
    try {
      await flush();
      return true;
    } catch (error) {
      setError((error as Error).message);
      return false;
    }
  };
  /* eslint-disable react-hooks/exhaustive-deps -- The leave subscription follows the listed draft and lock values; status helper identity must not replace an in-progress navigation guard. */
  useEffect(() => registerBeforeNavigate(prepareLeave), [registerBeforeNavigate, switching, restoring, loading, renamingSkill, hasUnsavedChanges, editable, selectedPath, content]);
  /* eslint-enable react-hooks/exhaustive-deps */

  const visibleFiles = [...instructions ? [instructions] : [], ...skills.flatMap(skill => [...skill.entry ? [skill.entry] : [], ...skill.references, ...skill.scripts])];
  const busy = switching || restoring || renamingSkill;
  const navigate = (path: string) => {
    sidebar.setOpen(false);
    void selectDocument(path);
  };

  useImperativeHandle(ref, () => ({
    // The Agents page does not follow the selected notebook; it only saves before the app moves on.
    prepareNotebookChange: async () => prepareLeave(),
    prepareLeave,
    refresh: async () => {
      await refreshGitStatus();
      if (hasUnsavedChanges) return;
      const listing = await fetchAgentResources(repository);
      revision.current = listing.revision;
      setFiles(listing.files);
      if (!selectedPath) return;
      if (!listing.files.some(file => file.path === selectedPath)) {
        setSelectedPath(defaultFile(listing.files, selected.folder));
        return;
      }
      const resource = await readAgentResource(selectedPath, repository);
      if (resource.revision) revision.current = resource.revision;
      setContent(resource.content);
      setSavedContent(resource.content);
    },
  }));
  const navigationBusy = loading || switching || restoring || isCreating || renamingSkill;
  useEffect(() => {
    onBusyChange(navigationBusy);
    return () => onBusyChange(false);
  }, [navigationBusy, onBusyChange]);

  const multipleRepositories = new Set(workspaces.map(candidate => candidate.repository)).size > 1;
  const workspaceOptions = workspaces.map(candidate => ({ value: workspaceKey(candidate), label: multipleRepositories && candidate.folder ? `${label({ repository: candidate.repository, folder: '' })} / ${label(candidate)}` : label(candidate) }));
  const parentNames = (workspace?.parents ?? []).map(folder => label({ repository, folder }));
  const fileLabel = (file: AgentFile) => file.kind === 'instructions' ? t('agent.coreInstructions') : file.path.slice(file.path.indexOf('.agents/skills/') + '.agents/skills/'.length);
  const nameForm = creating && (
    <form
      className='flex flex-col gap-1.5 px-2.5 py-1'
      onSubmit={event => {
        event.preventDefault();
        void handleCreate();
      }}
    >
      <input
        autoFocus
        aria-label={t(creating.kind === 'skill' ? 'agent.newSkillSlug' : creating.kind === 'script' ? 'agent.newScriptName' : 'agent.newReferenceName')}
        placeholder={t(creating.kind === 'skill' ? 'agent.skillSlugHint' : creating.kind === 'script' ? 'agent.scriptNameHint' : 'agent.referenceNameHint')}
        className='ui-control w-full font-mono text-xs'
        value={newName}
        onChange={event => setNewName(event.target.value)}
        onKeyDown={event => {
          if (event.key === 'Escape') {
            setCreating(null);
            setNewName('');
          }
        }}
      />
      <div className='flex gap-2'>
        <button type='submit' disabled={isCreating || !newName.trim()} className='editor-action flex-1 rounded-md border border-line bg-surface px-2 py-1 text-xs font-semibold text-fg hover:bg-fg/5 disabled:opacity-40'>{isCreating ? t('agent.creatingSkill') : t(creating.kind === 'skill' ? 'agent.createSkill' : 'agent.createFile')}</button>
        <button
          type='button'
          disabled={isCreating}
          onClick={() => {
            setCreating(null);
            setNewName('');
          }}
          className='rounded-md border border-line px-2 py-1 text-xs text-muted hover:bg-fg/5 disabled:opacity-40'
        >
          {t('common.cancel')}
        </button>
      </div>
    </form>
  );

  return (
    <div className='agent-layout workspace-route has-sidebar-drawer' style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
      <WorkspaceSidebarToggle label={t('agent.title')} open={sidebar.open} onClick={() => sidebar.setOpen(open => !open)} />
      <WorkspaceSidebarPortal>
        <WorkspaceSidebar label={t('agent.title')} className='agent-sidebar'>
          <section aria-label={t('agent.workspace')}>
            <div className='sidebar-section-label'>{t('agent.workspace')}</div>
            <div className='agent-workspace-picker'>
              <Select aria-label={t('agent.workspace')} value={workspaceKey(selected)} disabled={busy || !workspaces.length} onValueChange={value => void selectWorkspace(workspaces.find(candidate => workspaceKey(candidate) === value) ?? selected)} options={workspaceOptions.length ? workspaceOptions : [{ value: workspaceKey(selected), label: label(selected) }]} className='w-full' />
              {parentNames.length > 0 && <p className='agent-empty-scope'>{t('agent.inherits', { names: new Intl.ListFormat(language, { type: 'conjunction' }).format(parentNames) })}</p>}
            </div>
            {!readOnly && (
              <button disabled={isCreating || busy} onClick={() => setAddingWorkspace(true)} className='sidebar-link'>
                <FolderPlus aria-hidden='true' />
                <span>{t('agent.addWorkspace')}</span>
              </button>
            )}
          </section>
          <section aria-label={t('agent.coreInstructions')}>
            <div className='sidebar-section-label'>{t('agent.coreInstructions')}</div>
            {instructions
              ? (
                <ul className='agent-file-tree'>
                  <li>
                    <button type='button' className='agent-file agent-instructions sidebar-link' disabled={busy} aria-current={selectedPath === instructions.path ? 'page' : undefined} title={instructions.path} onClick={() => navigate(instructions.path)}>
                      <FileText aria-hidden='true' />
                      <span>{instructions.path.split('/').pop()}</span>
                    </button>
                  </li>
                </ul>
              )
              : (
                <>
                  <p className='agent-empty-scope'>{t('agent.noInstructions')}</p>
                  {!readOnly && (
                    <button disabled={isCreating || busy} onClick={() => void handleCreateInstructions()} className='sidebar-link'>
                      <Plus aria-hidden='true' />
                      <span>{t('agent.writeInstructions')}</span>
                    </button>
                  )}
                </>
              )}
          </section>
          <section aria-label={t('agent.skills')}>
            <div className='sidebar-section-label'>{t('agent.skills')}</div>
            <AgentFileTree
              skills={skills}
              selectedPath={selectedPath}
              disabled={busy}
              onSelect={navigate}
              onAdd={readOnly ? undefined : (skill, kind) => {
                setCreating({ kind, skill });
                setNewName('');
              }}
            />
            {!skills.length && <p className='agent-empty-scope'>{t('agent.noSkills')}</p>}
            {creating && nameForm}
            {!readOnly && !creating && (
              <button
                disabled={isCreating || busy}
                onClick={() => {
                  setCreating({ kind: 'skill' });
                  setNewName('');
                }}
                className='sidebar-link'
              >
                <Plus aria-hidden='true' />
                <span>{t('agent.createSkill')}</span>
              </button>
            )}
          </section>
          {sections.map((render, index) => <React.Fragment key={index}>{render({ workspace: selected, readOnly })}</React.Fragment>)}
          <div className='agent-sidebar-help text-xs leading-relaxed'>
            <p className='mb-2'>{t('agent.workspaceHelp')}</p>
            {t(readOnly ? 'agent.guidelinesReadOnlyDescription' : remote ? 'agent.remoteGuidelinesDescription' : 'agent.guidelinesDescription')}
          </div>
        </WorkspaceSidebar>
      </WorkspaceSidebarPortal>
      <div className='workspace-content agent-content'>
        <label className='agent-document-picker mobile-only flex-col gap-1 p-3 border-b text-xs' style={{ borderColor: 'var(--color-border)' }}>
          {t('agent.document')}
          <Select aria-label={t('agent.document')} value={selectedPath} disabled={busy || !visibleFiles.length} onValueChange={value => void selectDocument(value)} options={visibleFiles.map(file => ({ value: file.path, label: fileLabel(file) }))} className='w-full' />
        </label>
        <div className='agent-toolbar shrink-0 px-6 py-3 border-b flex items-center justify-between gap-4' style={{ backgroundColor: 'var(--color-sidebar)', borderColor: 'var(--color-border)' }}>
          <div className='flex items-center gap-2.5 truncate'>
            <span className='font-mono text-xs font-semibold text-fg truncate'>{selectedPath || t('agent.document')}</span>
            <span className='text-[10px] px-2 py-0.5 rounded font-bold uppercase tracking-wider' style={{ backgroundColor: editable ? 'var(--color-primary)' : 'var(--color-muted)', color: editable ? 'var(--color-on-primary)' : 'var(--color-bg)' }}>{editable ? t('agent.editable') : t('agent.readOnly')}</span>
          </div>
          <div className='agent-controls flex items-center gap-3'>
            {/* Single-file restore applies to uncommitted local edits. */}
            {showRestore && (
              <button disabled={!canRestore} aria-label={confirmRestore ? t('agent.confirmRestore') : t('agent.restore')} onClick={handleRestoreClick} className={`editor-action ${confirmRestore ? 'editor-confirming' : ''} flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-medium transition disabled:opacity-40 disabled:cursor-not-allowed ${confirmRestore ? 'bg-danger hover:bg-danger/90 text-on-danger shadow-md animate-pulse' : 'bg-fg/5 border border-line text-fg hover:bg-fg/10'}`} title={confirmRestore ? t('editor.confirmRestoreTooltip') : t('editor.restoreTooltip')}>
                {confirmRestore
                  ? (
                    <>
                      <AlertTriangle className='w-3.5 h-3.5' />
                      <span>{t('agent.confirmRestore')}</span>
                    </>
                  )
                  : (
                    <>
                      <RotateCcw className='w-3.5 h-3.5' />
                      <span>{t('agent.restore')}</span>
                    </>
                  )}
              </button>
            )}
            {isSkillEntry && (
              <Button
                size='icon'
                className='editor-panel-action'
                aria-pressed={metadataOpen && !historyOpen}
                title={t('editor.frontmatter')}
                aria-label={t('editor.frontmatter')}
                onClick={() => {
                  setMetadataOpen(open => historyOpen || !open);
                  setHistoryOpen(false);
                }}
              >
                <Braces aria-hidden='true' />
              </Button>
            )}
            {selectedPath && (
              <Button
                size='icon'
                className='editor-panel-action'
                aria-pressed={historyOpen}
                title={t('history.open')}
                aria-label={t('history.open')}
                onClick={() => setHistoryOpen(open => !open)}
              >
                <History aria-hidden='true' />
              </Button>
            )}
            {!script && <MarkdownEditorModeSwitch mode={viewMode} onChange={setViewMode} />}
          </div>
        </div>
        {(error || renameRestoreLimited) && <div className='editor-notices'>{error && <EditorNotice tone='error'>{error}</EditorNotice>}{renameRestoreLimited && <EditorNotice>{t('agent.renameRestoreNotice')}</EditorNotice>}</div>}
        {!editable && selectedPath && <div className='px-6 py-2 border-b text-[11px] leading-relaxed text-warning bg-warning-soft/50'>{readOnlyNotice}</div>}
        <div className='agent-editor-row'>
          <div className='agent-editor-column'>
            {loading ? <LoadingStatus className='p-6 text-sm text-muted'>{t('agent.loadingDocument')}</LoadingStatus> : selectedPath
              ? script
                ? (
                  <Suspense fallback={<LoadingStatus className='p-6 text-sm text-muted'>{t('editor.loadingEditor')}</LoadingStatus>}>
                    <FileSourceEditor path={selectedPath} content={content} readOnly={locked} label='Agent document content' onChange={setContent} />
                  </Suspense>
                )
                : <MarkdownEditor content={bodyContent} path={selectedPath} mode={viewMode} readOnly={locked} onChange={handleBodyChange} ariaLabel='Agent document content' lineNumberOffset={skillSplit?.lineNumberOffset || 0} />
              : (
                <div className='p-8 flex flex-col items-center justify-center text-center gap-3 my-auto'>
                  <Bot className='w-10 h-10 text-muted' />
                  <p className='text-sm text-muted'>{t('agent.noInstructions')}</p>
                  {!readOnly && (
                    <Button variant='primary' disabled={isCreating} onClick={() => void handleCreateInstructions()}>
                      <Plus className='w-4 h-4' />
                      <span>{t('agent.writeInstructions')}</span>
                    </Button>
                  )}
                </div>
              )}
          </div>
          {selectedPath && historyOpen && (
            <aside className='note-document-panel agent-skill-panel' data-open='true' data-panel='history' aria-label={t('history.open')}>
              <NoteHistoryPanel key={`${repository}:${selectedPath}`} target={historyTarget} dirty={historyDirty} current={historyCurrent} onRestore={locked ? undefined : setContent} />
            </aside>
          )}
          {selectedPath && isSkillEntry && !loading && !historyOpen && (
            <aside className='note-document-panel agent-skill-panel' data-open={metadataOpen} data-panel='frontmatter' aria-label={t('agent.skillMetadata')}>
              <AgentSkillMetadataPanel key={selectedPath} content={content} disabled={locked} path={selectedPath} renaming={renamingSkill} onChange={setContent} onRename={handleRenameSkill} />
            </aside>
          )}
        </div>
        {selectedPath && <EditorFooter content={loading ? '' : bodyContent} path={selectedPath} state={loading ? 'loading' : isSaving ? 'saving' : hasUnsavedChanges ? 'pending' : 'saved'} status={t(loading ? 'agent.loading' : isSaving ? 'editor.saving' : hasUnsavedChanges ? 'editor.unsavedChanges' : editable ? 'agent.saved' : 'editor.readOnly')} />}
      </div>
      {addingWorkspace && (
        <FolderPickerDialog title={t('agent.addWorkspace')} notebooks={notebooks} folders={folders} initial={{ notebookId: notebooks[0]?.id ?? '', folder: null }} confirmLabel={t('agent.addWorkspaceConfirm')} busy={isCreating} onClose={() => setAddingWorkspace(false)} onConfirm={pick => void handleAddWorkspace(pick.notebookId, pick.folder)}>
          <p className='pi-agent-hint'>{t('agent.addWorkspaceHint')}</p>
        </FolderPickerDialog>
      )}
    </div>
  );
});
