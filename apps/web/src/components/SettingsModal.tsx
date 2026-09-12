import React, { useState, useEffect } from 'react';
import {
  Settings,
  Save,
  RefreshCw,
  GitBranch,
  Check,
  AlertCircle,
  Shield,
  Palette,
  Sun,
  Moon,
} from 'lucide-react';
import { WorkspaceConfig } from '../lib/types.js';
import { updateWorkspaceConfig, runCoreUpdate } from '../lib/api.js';
import { ThemeDefinition, THEMES } from '../lib/themes.js';
import YAML from 'yaml';

interface SettingsModalProps {
  local?: boolean;
  accountSettings?: React.ReactNode;
  config: WorkspaceConfig | null;
  branch: string;
  repoRoot: string;
  onRefreshWorkspace: () => Promise<void>;
  currentTheme: ThemeDefinition;
  onSelectTheme: (theme: ThemeDefinition) => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  config,
  local = true,
  accountSettings,
  branch,
  repoRoot,
  onRefreshWorkspace,
  currentTheme,
  onSelectTheme,
}) => {
  const [yamlContent, setYamlContent] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [isUpdatingCore, setIsUpdatingCore] = useState(false);
  const [coreUpdateMsg, setCoreUpdateMsg] = useState<string | null>(null);

  useEffect(() => {
    if (config) {
      setYamlContent(YAML.stringify(config));
    }
  }, [config]);

  const handleSaveConfig = async () => {
    setIsSaving(true);
    setStatusMessage(null);
    try {
      await updateWorkspaceConfig(yamlContent);
      await onRefreshWorkspace();
      setStatusMessage({ type: 'success', text: 'Workspace configuration saved and committed.' });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setStatusMessage({ type: 'error', text: msg });
    } finally {
      setIsSaving(false);
    }
  };

  const handleUpdateCoreClick = async () => {
    setIsUpdatingCore(true);
    setCoreUpdateMsg(null);
    try {
      const res = await runCoreUpdate(false);
      setCoreUpdateMsg(res.result.message);
      await onRefreshWorkspace();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setCoreUpdateMsg(`Error: ${msg}`);
    } finally {
      setIsUpdatingCore(false);
    }
  };

  return (
    <div className="settings-panel bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm p-4 md:p-6 max-w-4xl mx-auto flex flex-col gap-6">
      <div className="flex items-center justify-between pb-4 border-b border-slate-100 dark:border-slate-800">
        <div>
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <Settings className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
            Workspace Settings
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Configure appearance theme palettes, workspace manifest, and manage Core updates.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded-lg text-xs font-mono">
            <GitBranch className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
            {branch}
          </span>
        </div>
      </div>

      {/* Theme Palettes (色票主題設定) */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
              <Palette className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
              Theme & Color Palettes (Theme Swatches)
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Select from curated light and dark color schemes with exposed palette swatches.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {THEMES.map((theme) => {
            const isSelected = theme.id === currentTheme.id;
            return (
              <button
                key={theme.id}
                onClick={() => onSelectTheme(theme)}
                className={`flex flex-col p-4 rounded-xl border text-left transition-all ${
                  isSelected
                    ? 'border-indigo-600 dark:border-indigo-500 bg-indigo-50/40 dark:bg-indigo-950/20 shadow-xs'
                    : 'border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 bg-white dark:bg-slate-900/60'
                }`}
              >
                <div className="flex items-center justify-between w-full mb-2">
                  <div className="flex items-center gap-2">
                    {theme.mode === 'dark' ? (
                      <Moon className="w-4 h-4 text-slate-400 dark:text-slate-400" />
                    ) : (
                      <Sun className="w-4 h-4 text-amber-500" />
                    )}
                    <span className="font-semibold text-sm text-slate-900 dark:text-slate-100">
                      {theme.name}
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] uppercase font-semibold px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400">
                      {theme.mode}
                    </span>
                    {isSelected && (
                      <span className="w-5 h-5 rounded-full bg-indigo-600 dark:bg-indigo-500 text-white flex items-center justify-center">
                        <Check className="w-3 h-3" />
                      </span>
                    )}
                  </div>
                </div>

                <p className="text-xs text-slate-500 dark:text-slate-400 mb-3 line-clamp-2">
                  {theme.description}
                </p>

                {/* Color Swatches (色票展示) */}
                <div className="mt-auto pt-2 border-t border-slate-100 dark:border-slate-800/80 flex items-center justify-between">
                  <span className="text-[11px] font-medium text-slate-400">Palette Swatches</span>
                  <div className="flex items-center gap-1.5 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg border border-slate-200/60 dark:border-slate-700/60">
                    {theme.swatches.map((color, idx) => (
                      <div
                        key={idx}
                        className="w-4 h-4 rounded-full border border-black/10 dark:border-white/10 shadow-xs"
                        style={{ backgroundColor: color }}
                        title={color}
                      />
                    ))}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {accountSettings}

      {/* Core Update Banner */}
      <div className="bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-800 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="font-semibold text-xs text-slate-800 dark:text-slate-200 flex items-center gap-1.5 mb-0.5">
            <Shield className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
            Core Product Updates
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Fetch and non-destructively merge canonical Core changes into your workspace branch.
          </p>
          {coreUpdateMsg && (
            <p className="text-xs font-mono mt-2 text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-950/60 px-2.5 py-1 rounded">
              {coreUpdateMsg}
            </p>
          )}
        </div>

        <button
          onClick={handleUpdateCoreClick}
          disabled={!local || isUpdatingCore || branch === 'core'}
          className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-medium text-white transition shrink-0 ${
            branch === 'core'
              ? 'bg-slate-400 dark:bg-slate-600 cursor-not-allowed'
              : 'bg-indigo-600 hover:bg-indigo-700 dark:bg-indigo-500 dark:hover:bg-indigo-600 shadow-sm shadow-indigo-100 dark:shadow-none'
          }`}
          title={branch === 'core' ? 'You are already on core branch' : 'Run safe Core update'}
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isUpdatingCore ? 'animate-spin' : ''}`} />
          <span>{isUpdatingCore ? 'Updating...' : 'Check & Update Core'}</span>
        </button>
      </div>

      {!local && <p className="text-xs text-slate-500 dark:text-slate-400">This manifest comes from the selected GitHub repository. Edit workspace configuration in that repository or a local workspace. Core updates run in the local workspace.</p>}

      {/* Manifest YAML Editor */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
            Workspace Manifest (.github-notes.yaml)
          </label>
          <button
            onClick={handleSaveConfig}
            disabled={!local || isSaving || branch === 'core'}
            className="flex items-center gap-1.5 px-3 py-1 bg-indigo-600 hover:bg-indigo-700 dark:bg-indigo-500 dark:hover:bg-indigo-600 text-white rounded-md text-xs font-medium transition"
          >
            <Save className="w-3.5 h-3.5" />
            <span>{isSaving ? 'Saving...' : 'Save & Commit'}</span>
          </button>
        </div>

        <p className="text-xs text-slate-500 dark:text-slate-400">
          Each notebook can define <code>statuses: [inbox, working, done, archived]</code>.
          Omit it or use an empty list for these defaults. Order sets Kanban columns and
          the initial status of new notes. Statuses found in notes also appear as options.
        </p>
        <textarea
          readOnly={!local || branch === 'core'}
          aria-label="Workspace manifest"
          value={yamlContent}
          onChange={(e) => setYamlContent(e.target.value)}
          rows={12}
          className="w-full p-4 font-mono text-xs bg-slate-900 text-slate-100 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 leading-relaxed border border-slate-800"
          spellCheck={false}
        />

        {statusMessage && (
          <div
            className={`p-3 rounded-lg text-xs flex items-center gap-2 ${
              statusMessage.type === 'success'
                ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800'
                : 'bg-rose-50 dark:bg-rose-950/40 text-rose-800 dark:text-rose-300 border border-rose-200 dark:border-rose-800'
            }`}
          >
            {statusMessage.type === 'success' ? (
              <Check className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
            ) : (
              <AlertCircle className="w-4 h-4 text-rose-600 dark:text-rose-400" />
            )}
            <span>{statusMessage.text}</span>
          </div>
        )}
      </div>

      {/* Information footer */}
      <div className="break-words text-[11px] text-slate-400 dark:text-slate-500 border-t border-slate-100 dark:border-slate-800 pt-3">
        {local ? 'Repository Root' : 'GitHub Source'}: <code className="text-slate-600 dark:text-slate-400 font-mono">{repoRoot}</code>
      </div>
    </div>
  );
};
