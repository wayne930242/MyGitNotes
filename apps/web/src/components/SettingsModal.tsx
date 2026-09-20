import { ProductVersion } from './ProductVersion.js';
import { Button } from './Button.js';
import { useWorkspaceSidebarDrawer, WorkspaceSidebar, WorkspaceSidebarPortal, WorkspaceSidebarToggle } from './WorkspaceChrome.js';
import React, { useState } from 'react';
import { AlertCircle, Check, Globe, Info, Palette, RefreshCw, Save, Shield } from 'lucide-react';
import { WorkspaceConfig } from '../lib/types.js';
import { runCoreUpdate, updateWorkspaceConfig } from '../lib/api.js';
import { ThemeChoice } from '../lib/themes.js';
import { ThemeSelector } from './ThemeSelector.js';
import { useTranslation } from '../lib/i18n/index.js';
import YAML from 'yaml';

interface SettingsModalProps {
  local?: boolean;
  accountSettings?: React.ReactNode;
  config: WorkspaceConfig | null;
  branch: string;
  repoRoot: string;
  onRefreshWorkspace: () => Promise<void>;
  currentTheme: ThemeChoice;
  onSelectTheme: (theme: ThemeChoice) => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({ config, local = true, accountSettings, branch, repoRoot, onRefreshWorkspace, currentTheme, onSelectTheme }) => {
  const { t, language, setLanguage } = useTranslation();
  const sidebar = useWorkspaceSidebarDrawer();
  const [yamlContent, setYamlContent] = useState(() => config ? YAML.stringify(config) : '');
  const [isSaving, setIsSaving] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error'; text: string; } | null>(null);
  const [isUpdatingCore, setIsUpdatingCore] = useState(false);
  const [coreUpdateMsg, setCoreUpdateMsg] = useState<string | null>(null);

  const [previousConfig, setPreviousConfig] = useState(config);
  if (previousConfig !== config) {
    setPreviousConfig(config);
    if (config) setYamlContent(YAML.stringify(config));
  }

  const handleSaveConfig = async () => {
    setIsSaving(true);
    setStatusMessage(null);
    try {
      await updateWorkspaceConfig(yamlContent);
      await onRefreshWorkspace();
      setStatusMessage({ type: 'success', text: t('settings.saved') });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setStatusMessage({ type: 'error', text: msg });
    } finally {
      setIsSaving(false);
    }
  };

  const handleUpdateCoreClick = async () => {
    if (!local) {
      setCoreUpdateMsg(t('settings.coreUpdateLocalOnly'));
      return;
    }
    if (branch === 'core') {
      setCoreUpdateMsg(t('settings.coreUpdateCoreBranch'));
      return;
    }
    if (branch !== 'main') {
      setCoreUpdateMsg(t('settings.coreUpdateMainOnly', { branch }));
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
    <>
      <WorkspaceSidebarPortal>
        <WorkspaceSidebar label={t('settings.title')} className='settings-sidebar'>
          <div className='sidebar-section-label'>{t('nav.settings')}</div>
          {([['language', t('settings.language'), Globe], ['theme', t('settings.theme'), Palette], ['access', t('layout.access'), Shield], ['updates', t('settings.coreUpdates'), RefreshCw], ['manifest', t('layout.manifest'), Save]] as const).map(([id, label, Icon]) => (
            <a
              key={String(id)}
              href={`#settings-${id}`}
              className='sidebar-link'
              onClick={event => {
                event.preventDefault();
                sidebar.setOpen(false);
                document.getElementById(`settings-${id}`)?.scrollIntoView({ block: 'start', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
              }}
            >
              <Icon aria-hidden='true' className='w-4 h-4' />
              <span>{String(label)}</span>
            </a>
          ))}
        </WorkspaceSidebar>
      </WorkspaceSidebarPortal>
      <WorkspaceSidebarToggle label={t('settings.title')} open={sidebar.open} onClick={() => sidebar.setOpen(open => !open)} />
      <div className='workspace-content'>
        <div className='workspace-scroll'>
          <div className='settings-panel'>
            {/* Language Selector */}
            <div id='settings-language' className='flex flex-col gap-3'>
              <div>
                <h3 className='text-xs font-semibold text-fg uppercase tracking-wider flex items-center gap-1.5'>
                  <Globe className='w-4 h-4 text-primary' />
                  {t('settings.language')}
                </h3>
                <p className='text-xs text-muted mt-0.5'>{t('settings.languageDescription')}</p>
              </div>
              <div className='grid grid-cols-1 sm:grid-cols-2 gap-3'>
                <button type='button' onClick={() => setLanguage('en')} aria-pressed={language === 'en'} className={`flex items-center justify-between p-4 rounded-xl border text-left transition-all ${language === 'en' ? 'border-primary bg-primary-soft/40 shadow-xs' : 'border-line hover:border-muted bg-surface'}`}>
                  <div className='flex items-center gap-3'>
                    <span className='text-2xl' role='img' aria-label={t('settings.english')}>🇺🇸</span>
                    <div>
                      <div className='font-semibold text-sm text-fg'>English</div>
                      <div className='text-xs text-muted'>{t('settings.defaultLanguage')}</div>
                    </div>
                  </div>
                  {language === 'en' && (
                    <span className='w-5 h-5 rounded-full bg-primary text-on-primary flex items-center justify-center shadow-xs'>
                      <Check className='w-3 h-3' />
                    </span>
                  )}
                </button>
                <button type='button' onClick={() => setLanguage('zh-TW')} aria-pressed={language === 'zh-TW'} className={`flex items-center justify-between p-4 rounded-xl border text-left transition-all ${language === 'zh-TW' ? 'border-primary bg-primary-soft/40 shadow-xs' : 'border-line hover:border-muted bg-surface'}`}>
                  <div className='flex items-center gap-3'>
                    <span className='text-2xl' role='img' aria-label={t('settings.traditionalChinese')}>🇹🇼</span>
                    <div>
                      <div className='font-semibold text-sm text-fg'>繁體中文</div>
                      <div className='text-xs text-muted'>{t('settings.traditionalChinese')}</div>
                    </div>
                  </div>
                  {language === 'zh-TW' && (
                    <span className='w-5 h-5 rounded-full bg-primary text-on-primary flex items-center justify-center shadow-xs'>
                      <Check className='w-3 h-3' />
                    </span>
                  )}
                </button>
              </div>
            </div>
            {/* Theme Palettes */}
            <div id='settings-theme' className='flex flex-col gap-3'>
              <div className='flex items-center justify-between'>
                <div>
                  <h3 className='text-xs font-semibold text-fg uppercase tracking-wider flex items-center gap-1.5'>
                    <Palette className='w-4 h-4 text-primary' />
                    {t('settings.theme')}
                  </h3>
                  <p className='text-xs text-muted mt-0.5'>{t('settings.themeDescription')}</p>
                </div>
              </div>
              <ThemeSelector value={currentTheme} onChange={onSelectTheme} />
            </div>
            <ProductVersion />
            <div id='settings-access'>{accountSettings}</div>
            {/* Upstream & Core Updates Section */}
            <div id='settings-updates' className='flex flex-col gap-3 p-4 bg-sidebar border border-line rounded-xl'>
              <div className='flex items-start sm:items-center justify-between gap-3 flex-wrap sm:flex-nowrap'>
                <div>
                  <div className='flex items-center gap-2'>
                    <h3 className='text-xs font-semibold text-fg uppercase tracking-wider flex items-center gap-1.5'>
                      <Shield className='w-4 h-4 text-primary' />
                      {t('settings.coreUpdates')}
                    </h3>
                    {branch === 'core' && <span className='text-[11px] px-2 py-0.5 rounded-full bg-warning-soft text-warning font-medium'>{t('settings.coreBranch')}</span>}
                    {branch === 'main' && <span className='text-[11px] px-2 py-0.5 rounded-full bg-success-soft text-success font-medium'>{t('settings.workspaceBranch')}</span>}
                  </div>
                  <p className='text-xs text-muted mt-0.5'>{t('settings.coreUpdatesDesc')}</p>
                </div>
                <Button variant='primary' type='button' onClick={handleUpdateCoreClick} disabled={isUpdatingCore} title={branch === 'core' ? t('settings.viewCoreStatusTitle') : t('settings.runCoreUpdateTitle')}>
                  <RefreshCw className={`w-3.5 h-3.5 ${isUpdatingCore ? 'animate-spin' : ''}`} />
                  <span>{isUpdatingCore ? t('settings.updating') : branch === 'core' ? t('settings.checkCoreStatus') : t('settings.checkUpdateCore')}</span>
                </Button>
              </div>
              {/* Branch Context Guidance */}
              {branch === 'core' && (
                <div className='text-xs bg-warning-soft/80 border border-warning/80 text-warning rounded-lg p-3 flex items-start gap-2.5'>
                  <Info className='w-4 h-4 shrink-0 mt-0.5 text-warning' />
                  <div className='space-y-1'>
                    <p className='font-semibold'>{t('settings.coreBranchNotice')}</p>
                    <p className='text-warning leading-relaxed text-[11px]'>{t('settings.coreBranchNoticeDesc')}</p>
                    <p className='text-[11px] text-warning'>
                      {'💡 '}
                      {t('settings.coreBranchNoticeCmd')} <code className='font-mono bg-warning-soft/70 px-1 py-0.5 rounded text-warning font-semibold'>pnpm bootstrap-workspace</code>
                    </p>
                  </div>
                </div>
              )}
              {!local && (
                <div className='text-xs bg-sidebar border border-line text-muted rounded-lg p-2.5 flex items-center gap-2'>
                  <Info className='w-4 h-4 shrink-0 text-muted' />
                  <span>{t('settings.remoteGitHubMode')}</span>
                </div>
              )}
              {coreUpdateMsg && (
                <div className={`p-3 rounded-lg text-xs flex items-start gap-2 ${coreUpdateMsg.startsWith('Error:') ? 'bg-danger-soft text-danger border border-danger/40' : 'bg-primary-soft text-primary-hover border border-primary'}`}>
                  <Info className='w-4 h-4 shrink-0 mt-0.5' />
                  <span className='leading-relaxed'>{coreUpdateMsg}</span>
                </div>
              )}
            </div>
            {!local && <p className='text-xs text-muted'>{t('settings.remoteManifestHint')}</p>}
            {/* Manifest YAML Editor */}
            <div id='settings-manifest' className='flex flex-col gap-2'>
              <div className='flex items-center justify-between'>
                <div className='flex items-center gap-2'>
                  <label className='text-xs font-semibold text-fg uppercase tracking-wider'>{t('settings.manifest')}</label>
                  {branch === 'core' && <span className='text-[11px] px-2 py-0.5 rounded-full bg-sidebar text-muted font-mono'>{t('settings.coreBranchReadOnly')}</span>}
                </div>
                <Button variant='primary' type='button' onClick={handleSaveConfig} disabled={!local || isSaving || branch === 'core'} title={branch === 'core' ? t('settings.coreBranchConfigReadOnlyTitle') : t('settings.saveCommit')}>
                  <Save className='w-3.5 h-3.5' />
                  <span>{isSaving ? t('settings.saving') : t('settings.saveCommit')}</span>
                </Button>
              </div>
              <p className='text-xs text-muted'>{t('settings.manifestHint')}{branch === 'core' && <span className='block mt-1 text-warning text-[11px]'>{t('settings.coreBranchManifestWarning')}</span>}</p>
              <textarea style={{ caretColor: 'currentColor' }} readOnly={!local || branch === 'core'} aria-label={t('settings.manifest')} value={yamlContent} onChange={(e) => setYamlContent(e.target.value)} rows={12} className='w-full p-4 font-mono text-xs bg-code text-fg rounded-xl focus:outline-none focus:ring-2 focus:ring-primary leading-relaxed border border-line' spellCheck={false} />
              {statusMessage && (
                <div className={`p-3 rounded-lg text-xs flex items-center gap-2 ${statusMessage.type === 'success' ? 'bg-success-soft text-success border border-success/40' : 'bg-danger-soft text-danger border border-danger/40'}`}>
                  {statusMessage.type === 'success' ? <Check className='w-4 h-4 text-success' /> : <AlertCircle className='w-4 h-4 text-danger' />}
                  <span>{statusMessage.text}</span>
                </div>
              )}
            </div>
            {/* Information footer */}
            <div className='break-words text-[11px] text-muted border-t border-line pt-3'>
              {local ? t('settings.repoRoot') : t('settings.githubSource')}
              {': '}
              <code className='text-muted font-mono'>{repoRoot}</code>
            </div>
          </div>
        </div>
      </div>
    </>
  );
};
