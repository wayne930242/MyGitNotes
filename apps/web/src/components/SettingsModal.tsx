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
  Info,
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
    if (!local) {
      setCoreUpdateMsg('Core updates can only be executed in a local workspace environment (currently in remote GitHub mode).');
      return;
    }
    if (branch === 'core') {
      setCoreUpdateMsg('Currently on the core product branch. Core updates are used to sync updates into a user main workspace branch. To create a workspace, run: pnpm bootstrap-workspace');
      return;
    }
    if (branch !== 'main') {
      setCoreUpdateMsg(`Core updates can only be merged into the user workspace branch 'main' (current branch: ${branch}).`);
      return;
    }
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

      {/* Theme Palettes */}
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
                    ? 'border-indigo-600 dark:border-indigo-500 bg-indigo-50/40 dark:bg-indigo-950/20 shadow-xs hover:opacity-95'
                    : 'border-slate-200 dark:border-slate-800 hover:border-slate-400 dark:hover:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-800/40 bg-white dark:bg-slate-900/60'
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

                <p className="text-xs text-slate-500 dark:text-slate-400 mb-3 leading-relaxed">
                  {theme.description}
                </p>

                {/* Swatches Visual representation */}
                <div className="flex items-center gap-1.5 mt-auto pt-2 border-t border-slate-100 dark:border-slate-800/60">
                  {theme.swatches.map((color, idx) => (
                    <div
                      key={idx}
                      className="flex-1 h-5 rounded-md border border-black/10 dark:border-white/10 relative group"
                      style={{ backgroundColor: color }}
                      title={color}
                    />
                  ))}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {accountSettings}

      {/* Upstream & Core Updates Section */}
      <div className="flex flex-col gap-3 p-4 bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-800 rounded-xl">
        <div className="flex items-start sm:items-center justify-between gap-3 flex-wrap sm:flex-nowrap">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                <Shield className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                Core Product Updates
              </h3>
              {branch === 'core' && (
                <span className="text-[11px] px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 font-medium">
                  Core Branch
                </span>
              )}
              {branch === 'main' && (
                <span className="text-[11px] px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 font-medium">
                  Workspace Branch
                </span>
              )}
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Safely fetch and merge changes from the Core product branch into your workspace.
            </p>
          </div>

          <button
            onClick={handleUpdateCoreClick}
            disabled={isUpdatingCore}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-medium text-white transition shrink-0 ${
              isUpdatingCore
                ? 'bg-slate-400 dark:bg-slate-600 cursor-not-allowed opacity-50'
                : branch === 'core'
                ? 'bg-amber-600 hover:bg-amber-700 dark:bg-amber-600 dark:hover:bg-amber-500 shadow-sm active:scale-95 cursor-pointer'
                : 'bg-indigo-600 hover:bg-indigo-700 dark:bg-indigo-500 dark:hover:bg-indigo-600 shadow-sm shadow-indigo-100 dark:shadow-none active:scale-95 cursor-pointer'
            }`}
            title={
              branch === 'core'
                ? 'View Core branch status and workspace instructions'
                : 'Run Core update merge'
            }
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isUpdatingCore ? 'animate-spin' : ''}`} />
            <span>
              {isUpdatingCore
                ? 'Updating...'
                : branch === 'core'
                ? 'Check Core Status'
                : 'Check & Update Core'}
            </span>
          </button>
        </div>

        {/* Branch Context Guidance */}
        {branch === 'core' && (
          <div className="text-xs bg-amber-50/80 dark:bg-amber-950/30 border border-amber-200/80 dark:border-amber-800/50 text-amber-800 dark:text-amber-300 rounded-lg p-3 flex items-start gap-2.5">
            <Info className="w-4 h-4 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
            <div className="space-y-1">
              <p className="font-semibold">Currently on the core development branch (`core`):</p>
              <p className="text-amber-700 dark:text-amber-400 leading-relaxed text-[11px]">
                Core Update safely merges upstream Core code into your personal workspace branch (<code>main</code>). In the <code>core</code> development branch itself, updates cannot be merged into itself.
              </p>
              <p className="text-[11px] text-amber-800 dark:text-amber-200">
                💡 To create your personal workspace branch, run in your terminal: <code className="font-mono bg-amber-100/70 dark:bg-amber-900/50 px-1 py-0.5 rounded text-amber-900 dark:text-amber-100 font-semibold">pnpm bootstrap-workspace</code>
              </p>
            </div>
          </div>
        )}

        {!local && (
          <div className="text-xs bg-slate-100 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 rounded-lg p-2.5 flex items-center gap-2">
            <Info className="w-4 h-4 shrink-0 text-slate-500" />
            <span>Currently in remote GitHub view mode. Core updates and workspace config changes are only supported in a local workspace.</span>
          </div>
        )}

        {coreUpdateMsg && (
          <div className={`p-3 rounded-lg text-xs flex items-start gap-2 ${
            coreUpdateMsg.startsWith('Error:')
              ? 'bg-rose-50 dark:bg-rose-950/40 text-rose-800 dark:text-rose-300 border border-rose-200 dark:border-rose-800'
              : 'bg-indigo-50 dark:bg-indigo-950/40 text-indigo-800 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800'
          }`}>
            <Info className="w-4 h-4 shrink-0 mt-0.5" />
            <span className="leading-relaxed">{coreUpdateMsg}</span>
          </div>
        )}
      </div>

      {!local && <p className="text-xs text-slate-500 dark:text-slate-400">This manifest comes from the selected GitHub repository. Edit workspace configuration in that repository or a local workspace. Core updates run in the local workspace.</p>}

      {/* Manifest YAML Editor */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
              Workspace Manifest (.github-notes.yaml)
            </label>
            {branch === 'core' && (
              <span className="text-[11px] px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 font-mono">
                core branch read-only
              </span>
            )}
          </div>
          <button
            onClick={handleSaveConfig}
            disabled={!local || isSaving || branch === 'core'}
            className="flex items-center gap-1.5 px-3 py-1 bg-indigo-600 hover:bg-indigo-700 dark:bg-indigo-500 dark:hover:bg-indigo-600 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-indigo-600 text-white rounded-md text-xs font-medium transition cursor-pointer"
            title={branch === 'core' ? 'Workspace config can only be edited on the main branch' : 'Save & Commit changes'}
          >
            <Save className="w-3.5 h-3.5" />
            <span>{isSaving ? 'Saving...' : 'Save & Commit'}</span>
          </button>
        </div>

        <p className="text-xs text-slate-500 dark:text-slate-400">
          Each notebook can define <code>statuses: [inbox, working, done, archived]</code>.
          Omit it or use an empty list for these defaults. Order sets Kanban columns and
          the initial status of new notes. Statuses found in notes also appear as options.
          {branch === 'core' && (
            <span className="block mt-1 text-amber-600 dark:text-amber-400 text-[11px]">
              Note: This repository is currently on the <code>core</code> product branch. <code>.github-notes.yaml</code> belongs to user workspace branches (<code>main</code>), and is read-only on <code>core</code>.
            </span>
          )}
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
