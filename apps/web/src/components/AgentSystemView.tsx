import { EditorNotice } from './EditorNotice.js';
import { Select } from './Select.js';
import React, { useState, useEffect, useRef } from 'react';
import {
  Bot,
  Edit3,
  RotateCcw,
  Check,
  AlertTriangle,
  Sparkles,
  BookOpen,
  Plus,
} from 'lucide-react';
import { MarkdownEditor, MarkdownEditorMode, MarkdownEditorModeSwitch } from './MarkdownEditor.js';
import { AgentResource } from '../lib/types.js';
import {
  fetchAgentResources,
  readAgentResource,
  saveAgentResource,
  restoreAgentResource,
} from '../lib/api.js';
import { useTranslation } from '../lib/i18n/index.js';

export const AgentSystemView: React.FC<{ readOnly?: boolean }> = ({ readOnly = false }) => {
  const { t } = useTranslation();
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
  const saveQueue = useRef<Promise<void>>(Promise.resolve());
  const saveTimer = useRef<ReturnType<typeof setTimeout>>();
  const current = useRef({ path: selectedPath, content }); current.current = { path: selectedPath, content };
  const pendingSaves = useRef(0);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const hasUnsavedChanges = loadedPath === selectedPath && content !== savedContent;
  const loading = initialLoading || contentLoading || (selectedPath !== '' && loadedPath !== selectedPath);

  const currentResource = instructions.find((resource) => resource.path === selectedPath);
  const isProductResource = currentResource?.scope === 'product' || selectedPath === 'AGENTS.md';
  const editable = !readOnly && !isProductResource && currentResource?.editable !== false;
  const locked = !editable || loading || switching || restoring;
  const [confirmRestore, setConfirmRestore] = useState<boolean>(false);
  const restoreTimerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    async function load() {
      setInitialLoading(true);
      try {
        const res = await fetchAgentResources();
        const all = res.instructions || [];
        setInstructions(all);

        if (all.length > 0) {
          const defaultRes =
            all.find((i) => i.path === 'notes/AGENTS.md') ||
            all.find((i) => i.scope === 'notes' || i.path.startsWith('notes/')) ||
            all.find((i) => i.path === 'AGENTS.md') ||
            all[0];
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

  useEffect(() => {
    if (!selectedPath) {
      setContent('');
      setSavedContent('');
      setLoadedPath('');
      return;
    }
    let cancelled = false;
    setContentLoading(true);
    setError(''); setLoadedPath(''); setConfirmRestore(false);
    if (restoreTimerRef.current) clearTimeout(restoreTimerRef.current);
    void readAgentResource(selectedPath)
      .then((resource) => {
        if (cancelled) return;
        setContent(resource.content);
        setSavedContent(resource.content);
        setLoadedPath(selectedPath);
      })
      .catch((error) => {
        if (!cancelled) setError((error as Error).message);
      })
      .finally(() => {
        if (!cancelled) setContentLoading(false);
      });
    return () => { cancelled = true; };
  }, [selectedPath]);

  const saveDocument = async (file: string, snapshot: string) => {
    pendingSaves.current++; setIsSaving(true);
    const request = saveQueue.current.catch(() => {}).then(async () => {
      await saveAgentResource({ path: file, content: snapshot });
      if (current.current.path === file) setSavedContent(snapshot);
    });
    saveQueue.current = request;
    try { await request; }
    finally { pendingSaves.current--; setIsSaving(pendingSaves.current > 0); }
  };

  useEffect(() => {
    if (locked || !hasUnsavedChanges) return;
    saveTimer.current = setTimeout(() => {
      void saveDocument(selectedPath, content).then(() => setError('')).catch((error) => setError(error.message));
    }, 750);
    return () => clearTimeout(saveTimer.current);
  }, [content, hasUnsavedChanges, selectedPath, locked]);

  const selectDocument = async (file: string) => {
    if (switching || restoring || file === selectedPath) return;
    clearTimeout(saveTimer.current); setSwitching(true); setError('');
    try {
      if (hasUnsavedChanges && editable) await saveDocument(selectedPath, content);
      else await saveQueue.current;
      setLoadedPath(''); setSelectedPath(file);
    } catch (error) { setError((error as Error).message); }
    finally { setSwitching(false); }
  };

  const handleRestoreClick = async () => {
    if (locked) return;
    if (!confirmRestore) {
      setConfirmRestore(true);
      restoreTimerRef.current = setTimeout(() => setConfirmRestore(false), 4000);
      return;
    }
    clearTimeout(saveTimer.current);
    if (restoreTimerRef.current) clearTimeout(restoreTimerRef.current);
    setConfirmRestore(false); setRestoring(true); setError('');
    try {
      await saveQueue.current.catch(() => {});
      const resource = await restoreAgentResource(selectedPath);
      setContent(resource.content); setSavedContent(resource.content);
    } catch (error) { setError((error as Error).message); }
    finally { setRestoring(false); }
  };
  useEffect(() => () => { if (restoreTimerRef.current) clearTimeout(restoreTimerRef.current); }, []);

  const handleCreateWorkspaceGuidelines = async () => {
    if (readOnly || isCreating) return;
    const path = 'notes/AGENTS.md';
    const defaultContent = `# Notes Workspace Guidelines\n\nOperational guidelines for AI agents working within this note repository.\n`;
    setIsCreating(true);
    setError('');
    try {
      await saveAgentResource({ path, content: defaultContent });
      const newResource: AgentResource = {
        path,
        name: t('agent.workspaceGuidelines'),
        editable: true,
        scope: 'notes',
      };
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

  const workspaceInstructions = instructions.filter(
    (i) => i.scope === 'notes' || i.path.startsWith('notes/')
  );
  const systemInstructions = instructions.filter(
    (i) => i.scope === 'product' || i.path === 'AGENTS.md'
  );

  return (
    <div
      className="agent-layout rounded-xl border shadow-sm flex h-full min-h-0 overflow-hidden transition-colors"
      style={{
        backgroundColor: 'var(--color-surface)',
        borderColor: 'var(--color-border)',
      }}
    >
      {/* Left Navigation: Notes & System Agent Files */}
      <div
        className="agent-sidebar w-80 border-r flex flex-col p-4 gap-5 shrink-0 overflow-y-auto"
        style={{
          backgroundColor: 'var(--color-sidebar)',
          borderColor: 'var(--color-border)',
        }}
      >
        <div
          className="flex items-center gap-2 font-semibold text-sm pb-2 border-b"
          style={{ borderColor: 'var(--color-border)' }}
        >
          <Bot className="w-4 h-4" style={{ color: 'var(--color-primary)' }} />
          <span className="text-slate-900 dark:text-slate-100">{t('agent.title')}</span>
        </div>

        {/* 1. Workspace Guidelines */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-[11px] font-bold text-slate-400 dark:text-slate-400 uppercase tracking-wider">
              {t('agent.workspaceGuidelines')}
            </h4>
            <span
              className="text-[10px] px-1.5 py-0.5 rounded font-semibold text-white uppercase tracking-wider"
              style={{ backgroundColor: 'var(--color-primary)' }}
            >
              {readOnly ? t('agent.readOnly') : t('agent.editable')}
            </span>
          </div>
          <div className="space-y-1">
            {workspaceInstructions.map((res) => (
              <button
                key={res.path}
                disabled={switching || restoring}
                onClick={() => void selectDocument(res.path)}
                className={`w-full text-left flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-xs font-medium transition disabled:opacity-40 disabled:cursor-not-allowed ${
                  selectedPath === res.path
                    ? 'font-semibold shadow-xs hover:opacity-90'
                    : 'text-slate-600 dark:text-slate-400 hover:bg-black/5 dark:hover:bg-white/5 hover:text-slate-900 dark:hover:text-slate-100'
                }`}
                style={
                  selectedPath === res.path
                    ? {
                        backgroundColor: 'var(--color-primary-light)',
                        color: 'var(--color-primary)',
                      }
                    : undefined
                }
              >
                <div className="flex items-center gap-2 truncate">
                  <Sparkles className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--color-primary)' }} />
                  <span className="truncate">{res.name}</span>
                </div>
                <Edit3 className="w-3 h-3 opacity-60 shrink-0" />
              </button>
            ))}

            {!readOnly && !workspaceInstructions.some((i) => i.path === 'notes/AGENTS.md') && (
              <button
                disabled={isCreating}
                onClick={() => void handleCreateWorkspaceGuidelines()}
                className="w-full text-left flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium border border-dashed border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:border-slate-400 hover:text-slate-900 dark:hover:text-slate-200 transition"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>{t('agent.createWorkspaceGuidelines')}</span>
              </button>
            )}

            {workspaceInstructions.length === 0 && readOnly && (
              <p className="text-[11px] text-slate-400 px-1 py-1">{t('agent.noDocuments')}</p>
            )}
          </div>
        </div>

        {/* 2. System Guidelines (Reference) */}
        {systemInstructions.length > 0 && (
          <div>
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-[11px] font-bold text-slate-400 dark:text-slate-400 uppercase tracking-wider">
                {t('agent.systemGuidelines')}
              </h4>
              <span className="text-[10px] px-1.5 py-0.5 rounded font-semibold bg-black/5 dark:bg-white/10 text-slate-500 uppercase tracking-wider">
                {t('agent.readOnly')}
              </span>
            </div>
            <div className="space-y-1">
              {systemInstructions.map((res) => (
                <button
                  key={res.path}
                  disabled={switching || restoring}
                  onClick={() => void selectDocument(res.path)}
                  className={`w-full text-left flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-xs font-medium transition disabled:opacity-40 disabled:cursor-not-allowed ${
                    selectedPath === res.path
                      ? 'font-semibold shadow-xs hover:opacity-90'
                      : 'text-slate-600 dark:text-slate-400 hover:bg-black/5 dark:hover:bg-white/5 hover:text-slate-900 dark:hover:text-slate-100'
                  }`}
                  style={
                    selectedPath === res.path
                      ? {
                          backgroundColor: 'var(--color-primary-light)',
                          color: 'var(--color-primary)',
                        }
                      : undefined
                  }
                >
                  <div className="flex items-center gap-2 truncate">
                    <BookOpen className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--color-primary)' }} />
                    <span className="truncate">{res.name}</span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Informational Callout */}
        <div
          className="mt-auto border rounded-xl p-3 text-[11px] leading-relaxed"
          style={{
            backgroundColor: 'var(--color-primary-light)',
            borderColor: 'var(--color-border)',
            color: 'var(--color-text)',
          }}
        >
          <strong className="block mb-1 font-semibold" style={{ color: 'var(--color-primary)' }}>
            {t('agent.guidelinesTitle')}
          </strong>
          {t('agent.guidelinesDescription')}
        </div>
      </div>

      {/* Right Content Viewer / Editor */}
      <div className="flex-1 min-w-0 min-h-0 flex flex-col overflow-hidden">
        <label className="agent-document-picker mobile-only flex-col gap-1 p-3 border-b text-xs" style={{ borderColor: 'var(--color-border)' }}>
          {t('agent.document')}
          <Select
            aria-label={t('agent.document')}
            value={selectedPath}
            disabled={switching || restoring || !instructions.length}
            onValueChange={(value) => void selectDocument(value)}
            options={instructions.map((resource) => ({
              value: resource.path,
              label: `${resource.scope === 'product' ? `[${t('agent.systemGuidelines')}] ` : ''}${resource.name}`,
            }))}
            className="w-full min-w-0 rounded-lg border bg-transparent px-2"
          />
        </label>
        {/* Top Bar */}
        <div
          className="agent-toolbar shrink-0 px-6 py-3 border-b flex items-center justify-between gap-4"
          style={{
            backgroundColor: 'var(--color-sidebar)',
            borderColor: 'var(--color-border)',
          }}
        >
          <div className="flex items-center gap-2.5 truncate">
            <span className="font-mono text-xs font-semibold text-slate-700 dark:text-slate-300 truncate">
              {selectedPath || t('agent.document')}
            </span>
            <span
              className="text-[10px] px-2 py-0.5 rounded font-bold uppercase tracking-wider text-white"
              style={{
                backgroundColor: editable ? 'var(--color-primary)' : 'var(--color-text-muted, #64748b)',
              }}
            >
              {editable ? t('agent.editableSystem') : t('agent.readOnlySystem')}
            </span>
          </div>

          <div className="agent-controls flex items-center gap-3">
            {/* Auto-save & Status indicator */}
            <div className="agent-save-status flex items-center gap-2 text-xs">
              {loading ? (
                <span className="text-slate-400">{t('agent.loading')}</span>
              ) : isSaving ? (
                <span className="text-amber-500 flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
                  {t('agent.saving')}
                </span>
              ) : hasUnsavedChanges ? (
                <span className="text-amber-500 flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-amber-500" />
                  {t('agent.editing')}
                </span>
              ) : (
                <span className="text-emerald-500 dark:text-emerald-400 flex items-center gap-1">
                  <Check className="w-3.5 h-3.5" />
                  <span className="agent-status-detail">{t('agent.savedToDisk')}</span>
                  <span className="agent-status-compact">{t('agent.saved')}</span>
                </span>
              )}
            </div>

            {/* Single-file restore button with two-click confirmation */}
            <button
              disabled={locked}
              aria-label={confirmRestore ? t('agent.confirmRestore') : t('agent.restore')}
              onClick={handleRestoreClick}
              className={`editor-action ${confirmRestore ? 'editor-confirming' : ''} flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-medium transition disabled:opacity-40 disabled:cursor-not-allowed ${
                confirmRestore
                  ? 'bg-rose-500 hover:bg-rose-600 text-white shadow-md animate-pulse'
                  : 'bg-black/5 dark:bg-white/5 border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-black/10 dark:hover:bg-white/10'
              }`}
              title={confirmRestore ? t('editor.confirmRestoreTooltip') : t('editor.restoreTooltip')}
            >
              {confirmRestore ? (
                <>
                  <AlertTriangle className="w-3.5 h-3.5" />
                  <span>{t('agent.confirmRestore')}</span>
                </>
              ) : (
                <>
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>{t('agent.restore')}</span>
                </>
              )}
            </button>

            <MarkdownEditorModeSwitch mode={viewMode} onChange={setViewMode} />
          </div>
        </div>

        {/* Notices */}
        {error && (
          <div className="editor-notices">
            <EditorNotice tone="error">{error}</EditorNotice>
          </div>
        )}
        {isProductResource && (
          <div className="px-6 py-2 border-b text-[11px] leading-relaxed text-slate-500 dark:text-slate-400 bg-slate-50/50 dark:bg-slate-900/30">
            {t('agent.systemNotice')}
          </div>
        )}
        {readOnly && !isProductResource && selectedPath.startsWith('notes/') && (
          <div className="px-6 py-2 border-b text-[11px] leading-relaxed text-amber-700 dark:text-amber-300 bg-amber-50/50 dark:bg-amber-950/20">
            {t('agent.coreBranchNotice')}
          </div>
        )}

        {loading ? (
          <p className="p-6 text-sm text-slate-400">{t('agent.loadingDocument')}</p>
        ) : selectedPath ? (
          <MarkdownEditor
            content={content}
            path={selectedPath}
            mode={viewMode}
            readOnly={locked}
            onChange={setContent}
            ariaLabel="Agent document content"
          />
        ) : (
          <div className="p-8 flex flex-col items-center justify-center text-center gap-3 my-auto">
            <Bot className="w-10 h-10 text-slate-400" />
            <p className="text-sm text-slate-500 dark:text-slate-400">{t('agent.noDocuments')}</p>
            {!readOnly && (
              <button
                disabled={isCreating}
                onClick={() => void handleCreateWorkspaceGuidelines()}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold text-white transition shadow-xs hover:opacity-90"
                style={{ backgroundColor: 'var(--color-primary)' }}
              >
                <Plus className="w-4 h-4" />
                <span>{t('agent.createWorkspaceGuidelines')}</span>
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
