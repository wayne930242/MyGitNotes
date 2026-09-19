import { Button } from './Button.js';
import { useWorkspaceLinks } from './WorkspaceLinks.js';
import { AgentFileTree } from './AgentFileTree.js';
import { groupAgentResources } from '../lib/agent-tree.js';
import { useWorkspaceSidebarDrawer, WorkspaceSidebar, WorkspaceSidebarPortal, WorkspaceSidebarToggle } from './WorkspaceChrome.js';
import { EditorNotice } from './EditorNotice.js';
import { EditorFooter } from './EditorFooter.js';
import { Select } from './Select.js';
import React, { useEffect, useImperativeHandle, useRef, useState } from 'react';
import { AlertTriangle, Bot, Plus, RotateCcw } from 'lucide-react';
import { MarkdownEditor, MarkdownEditorMode, MarkdownEditorModeSwitch } from './MarkdownEditor.js';
import { AgentResource, GitStatus, NotebookConfig } from '../lib/types.js';
import { fetchAgentResources, fetchFileChanges, fetchGitStatus, readAgentResource, restoreAgentResource, saveAgentResource } from '../lib/api.js';
import { useTranslation } from '../lib/i18n/index.js';

export interface AgentSystemHandle {
  prepareNotebookChange: (id: string) => Promise<boolean>;
  prepareLeave: () => Promise<boolean>;
  refresh: () => Promise<void>;
}

export const AgentSystemView = React.forwardRef<AgentSystemHandle, { readOnly?: boolean; readOnlyNotice?: string; remote?: boolean; onGitStatus?: (status: GitStatus) => void; notebooks: NotebookConfig[]; selectedNotebookId: string; onBusyChange: (busy: boolean) => void; }>(({ readOnly = false, readOnlyNotice, remote = false, notebooks, selectedNotebookId, onBusyChange, onGitStatus }, ref) => {
  const { t } = useTranslation();
  const sidebar = useWorkspaceSidebarDrawer();
  const [instructions, setInstructions] = useState<AgentResource[]>([]);
  const [selectedPath, setSelectedPath] = useState<string>('');
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

  const currentResource = instructions.find((resource) => resource.path === selectedPath);
  const isProductResource = currentResource?.scope === 'product';
  const editable = !readOnly && !isProductResource && currentResource?.editable !== false;
  const locked = !editable || loading || switching || restoring;
  const [confirmRestore, setConfirmRestore] = useState<boolean>(false);
  const [fileStatus, setFileStatus] = useState<GitStatus | null>(null);
  const [restorableFiles, setRestorableFiles] = useState<Record<string, string>>({});
  const canRestore = !remote && !locked && !isSaving && Boolean(fileStatus && (fileStatus.modified.includes(selectedPath) || fileStatus.staged.includes(selectedPath)) && restorableFiles[selectedPath]);
  const refreshGitStatus = async () => {
    if (remote) return;
    const { status } = await fetchGitStatus();
    const changes = await fetchFileChanges();
    setRestorableFiles(Object.fromEntries(changes.filter(file => file.available && file.tracked).map(file => [file.path, file.revision])));
    setFileStatus(status);
    onGitStatus?.(status);
  };
  const restoreTimerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    async function load() {
      setInitialLoading(true);
      try {
        const res = await fetchAgentResources();
        const all = [...(res.instructions || []), ...(res.skills || []), ...(res.docs || [])];
        revision.current = res.revision;
        setInstructions(all);

        if (all.length > 0) {
          const defaultRes = all.find((i) => i.path === 'notes/AGENTS.md') || all.find((i) => i.path === 'AGENTS.md') || all.find((i) => i.scope !== 'product') || all[0];
          setSelectedPath(defaultRes.path);
        }
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setInitialLoading(false);
      }
    }
    void load();
  }, []);

  /* eslint-disable react-hooks/exhaustive-deps -- The explicit document, draft and notebook keys drive this transition; recreating local helpers must not restart it. */
  useEffect(() => {
    if (!selectedPath) {
      /* eslint-disable react/set-state-in-effect -- Document and notebook transitions initialize the resource editor and select an available resource. */
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
    void readAgentResource(selectedPath).then((resource) => {
      if (cancelled) return;
      revision.current = resource.revision;
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
  }, [selectedPath]);
  /* eslint-enable react-hooks/exhaustive-deps */

  const saveDocument = async (file: string, snapshot: string) => {
    pendingSaves.current++;
    setIsSaving(true);
    const request = saveQueue.current.catch(() => {}).then(async () => {
      const receipt = await saveAgentResource({ path: file, content: snapshot, revision: revision.current });
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

  /* eslint-disable react-hooks/exhaustive-deps -- The explicit document, draft and notebook keys drive this transition; recreating local helpers must not restart it. */
  useEffect(() => {
    if (locked || !hasUnsavedChanges) return;
    saveTimer.current = setTimeout(() => {
      void saveDocument(selectedPath, content).then(() => setError('')).catch((error) => setError(error.message));
    }, 750);
    return () => clearTimeout(saveTimer.current);
  }, [content, hasUnsavedChanges, selectedPath, locked]);
  /* eslint-enable react-hooks/exhaustive-deps */

  const selectDocument = async (file: string) => {
    if (switching || restoring) return false;
    if (file === selectedPath) return true;
    clearTimeout(saveTimer.current);
    setSwitching(true);
    setError('');
    try {
      if (hasUnsavedChanges && editable) await saveDocument(selectedPath, content);
      else await saveQueue.current;
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
      const resource = await restoreAgentResource(selectedPath, restorableFiles[selectedPath]);
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

  const handleCreateWorkspaceGuidelines = async () => {
    if (readOnly || isCreating) return;
    const path = 'AGENTS.md';
    const defaultContent = `# Notes Workspace Guidelines\n\nOperational guidelines for AI agents working within this note repository.\n`;
    setIsCreating(true);
    setError('');
    try {
      const receipt = await saveAgentResource({ path, content: defaultContent, revision: revision.current });
      revision.current = receipt.revision;
      const newResource: AgentResource = { path, name: t('agent.workspaceGuidelines'), editable: true, scope: 'workspace' };
      setInstructions((prev) => [newResource, ...prev.filter((i) => i.path !== path)]);
      setSelectedPath(path);
      setContent(defaultContent);
      setSavedContent(defaultContent);
      setLoadedPath(path);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsCreating(false);
    }
  };

  const { registerBeforeNavigate } = useWorkspaceLinks();
  const prepareLeave = async () => {
    if (switching || restoring || loading) return false;
    try {
      clearTimeout(saveTimer.current);
      if (hasUnsavedChanges && editable) await saveDocument(selectedPath, content);
      else await saveQueue.current;
      return true;
    } catch (error) {
      setError((error as Error).message);
      return false;
    }
  };
  /* eslint-disable react-hooks/exhaustive-deps -- The explicit document, draft and notebook keys drive this transition; recreating local helpers must not restart it. */
  useEffect(() => registerBeforeNavigate(prepareLeave), [registerBeforeNavigate, switching, restoring, loading, hasUnsavedChanges, editable, selectedPath, content]);
  /* eslint-enable react-hooks/exhaustive-deps */

  const groups = groupAgentResources(instructions, notebooks, selectedNotebookId);
  const visibleResources = [...groups.skills, ...groups.shared, ...groups.notebook, ...groups.product];
  const treeNavigation = { selectedPath, disabled: switching || restoring, onSelect: (path: string) => void selectDocument(path) };
  const drawerTreeNavigation = {
    ...treeNavigation,
    onSelect: (path: string) => {
      sidebar.setOpen(false);
      void selectDocument(path);
    },
  };
  const prepareNotebookChange = async (id: string) => {
    if (loading || switching || restoring || isCreating) return false;
    const next = groupAgentResources(instructions, notebooks, id);
    const visible = [...next.skills, ...next.shared, ...next.notebook, ...next.product];
    const path = visible.some(resource => resource.path === selectedPath) ? selectedPath : (next.notebook[0] || next.skills[0] || next.shared[0] || next.product[0])?.path || '';
    return selectDocument(path);
  };

  useImperativeHandle(ref, () => ({
    prepareNotebookChange,
    prepareLeave,
    refresh: async () => {
      await refreshGitStatus();
      if (!selectedPath || hasUnsavedChanges) return;
      const listing = await fetchAgentResources();
      const resources = [...listing.instructions, ...listing.skills, ...listing.docs];
      setInstructions(resources);
      if (!resources.some(resource => resource.path === selectedPath)) {
        setSelectedPath(resources[0]?.path || '');
        return;
      }
      const resource = await readAgentResource(selectedPath);
      revision.current = resource.revision;
      setContent(resource.content);
      setSavedContent(resource.content);
    },
  }));
  const navigationBusy = loading || switching || restoring || isCreating;
  useEffect(() => {
    onBusyChange(navigationBusy);
    return () => onBusyChange(false);
  }, [navigationBusy, onBusyChange]);

  // Browser history can also change the notebook without remounting the editor.
  /* eslint-disable react-hooks/exhaustive-deps -- The explicit document, draft and notebook keys drive this transition; recreating local helpers must not restart it. */
  useEffect(() => {
    if (!instructions.length || visibleResources.some(resource => resource.path === selectedPath)) return;
    const fallback = groups.notebook[0] || groups.skills[0] || groups.shared[0] || groups.product[0];
    /* eslint-disable react/set-state-in-effect -- Document and notebook transitions initialize the resource editor and select an available resource. */
    void selectDocument(fallback?.path || '');
    /* eslint-enable react/set-state-in-effect */
  }, [selectedNotebookId, instructions]);
  /* eslint-enable react-hooks/exhaustive-deps */

  return (
    <div className='agent-layout workspace-route has-sidebar-drawer' style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
      <WorkspaceSidebarToggle label={t('agent.title')} open={sidebar.open} onClick={() => sidebar.setOpen(open => !open)} />
      <WorkspaceSidebarPortal>
        <WorkspaceSidebar label={t('agent.title')} className='agent-sidebar'>
          <section aria-label={t('agent.workspaceSkills')}>
            <div className='sidebar-section-label'>{t('agent.workspaceSkills')}</div>
            <AgentFileTree resources={groups.skills} {...drawerTreeNavigation} />
            {!groups.skills.length && <p className='agent-empty-scope'>{t('agent.noWorkspaceSkills')}</p>}
          </section>
          <section aria-label={t('agent.sharedDocuments')}>
            <div className='sidebar-section-label'>{t('agent.sharedDocuments')}</div>
            <AgentFileTree resources={groups.shared} {...drawerTreeNavigation} />
            {!readOnly && !instructions.some(resource => resource.path === 'AGENTS.md') && (
              <button disabled={isCreating || switching || restoring} onClick={() => void handleCreateWorkspaceGuidelines()} className='sidebar-link'>
                <Plus aria-hidden='true' />
                <span>{t('agent.createWorkspaceGuidelines')}</span>
              </button>
            )}
          </section>
          <section aria-label={t('agent.notebookDocuments')}>
            <div className='sidebar-section-label'>{t('agent.notebookDocuments')}</div>
            <AgentFileTree resources={groups.notebook} {...drawerTreeNavigation} />
            {!groups.notebook.length && <p className='agent-empty-scope'>{t('agent.noNotebookDocuments')}</p>}
          </section>
          {groups.product.length > 0 && (
            <section aria-label={t('agent.systemGuidelines')}>
              <div className='sidebar-section-label'>
                {t('agent.systemGuidelines')}
                <span>{t('agent.readOnly')}</span>
              </div>
              <AgentFileTree resources={groups.product} {...drawerTreeNavigation} />
            </section>
          )}
          {/* Informational Callout */}
          <div className='agent-sidebar-help text-xs leading-relaxed' style={{ backgroundColor: 'var(--color-primary-light)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>
            <strong className='block mb-1 font-semibold' style={{ color: 'var(--color-primary)' }}>{t('agent.guidelinesTitle')}</strong>
            <p className='mb-2'>{t('agent.scopeDescription')}</p>
            {t(readOnly ? 'agent.guidelinesReadOnlyDescription' : remote ? 'agent.remoteGuidelinesDescription' : 'agent.guidelinesDescription')}
          </div>
        </WorkspaceSidebar>
      </WorkspaceSidebarPortal>
      {/* Right Content Viewer / Editor */}
      <div className='workspace-content agent-content'>
        <label className='agent-document-picker mobile-only flex-col gap-1 p-3 border-b text-xs' style={{ borderColor: 'var(--color-border)' }}>
          {t('agent.document')}
          <Select aria-label={t('agent.document')} value={selectedPath} disabled={switching || restoring || !visibleResources.length} onValueChange={(value) => void selectDocument(value)} options={visibleResources.map((resource) => ({ value: resource.path, label: `${resource.scope === 'product' ? `[${t('agent.systemGuidelines')}] ` : ''}${resource.path}` }))} className='w-full' />
        </label>
        {/* Top Bar */}
        <div className='agent-toolbar shrink-0 px-6 py-3 border-b flex items-center justify-between gap-4' style={{ backgroundColor: 'var(--color-sidebar)', borderColor: 'var(--color-border)' }}>
          <div className='flex items-center gap-2.5 truncate'>
            <span className='font-mono text-xs font-semibold text-fg truncate'>{selectedPath || t('agent.document')}</span>
            <span className='text-[10px] px-2 py-0.5 rounded font-bold uppercase tracking-wider' style={{ backgroundColor: editable ? 'var(--color-primary)' : 'var(--color-muted)', color: editable ? 'var(--color-on-primary)' : 'var(--color-bg)' }}>{editable ? t('agent.editable') : t('agent.readOnly')}</span>
          </div>
          <div className='agent-controls flex items-center gap-3'>
            {/* Single-file restore applies to uncommitted local edits. */}
            {!remote && (
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
            <MarkdownEditorModeSwitch mode={viewMode} onChange={setViewMode} />
          </div>
        </div>
        {/* Notices */}
        {error && (
          <div className='editor-notices'>
            <EditorNotice tone='error'>{error}</EditorNotice>
          </div>
        )}
        {isProductResource && <div className='px-6 py-2 border-b text-[11px] leading-relaxed text-muted bg-sidebar/50'>{t('agent.systemNotice')}</div>}
        {!editable && !isProductResource && selectedPath && <div className='px-6 py-2 border-b text-[11px] leading-relaxed text-warning bg-warning-soft/50'>{readOnlyNotice || t('agent.workspaceReadOnlyNotice')}</div>}
        {loading ? <p className='p-6 text-sm text-muted'>{t('agent.loadingDocument')}</p> : selectedPath ? <MarkdownEditor content={content} path={selectedPath} mode={viewMode} readOnly={locked} onChange={setContent} ariaLabel='Agent document content' /> : (
          <div className='p-8 flex flex-col items-center justify-center text-center gap-3 my-auto'>
            <Bot className='w-10 h-10 text-muted' />
            <p className='text-sm text-muted'>{t('agent.noDocuments')}</p>
            {!readOnly && (
              <Button variant='primary' disabled={isCreating} onClick={() => void handleCreateWorkspaceGuidelines()}>
                <Plus className='w-4 h-4' />
                <span>{t('agent.createWorkspaceGuidelines')}</span>
              </Button>
            )}
          </div>
        )}
        {selectedPath && <EditorFooter content={loading ? '' : content} path={selectedPath} state={loading ? 'loading' : isSaving ? 'saving' : hasUnsavedChanges ? 'pending' : 'saved'} status={t(loading ? 'agent.loading' : isSaving ? 'editor.saving' : hasUnsavedChanges ? 'editor.unsavedChanges' : editable ? 'agent.saved' : 'editor.readOnly')} />}
      </div>
    </div>
  );
});
