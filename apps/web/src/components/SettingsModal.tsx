import { CoreUpdates } from './CoreUpdates.js';
import { ProductVersion } from './ProductVersion.js';
import { Button } from './Button.js';
import { useWorkspaceSidebarDrawer, WorkspaceSidebar, WorkspaceSidebarPortal, WorkspaceSidebarToggle } from './WorkspaceChrome.js';
import React, { useState } from 'react';
import { AlertCircle, Check, Globe, History, Palette, RefreshCw, Save, Shield } from 'lucide-react';
import { Select } from './Select.js';
import { useVersionNumbering, type VersionNumbering, writeVersionNumbering } from '../lib/version-display.js';
import { WorkspaceConfig } from '../lib/types.js';
import { updateWorkspaceConfig } from '../lib/api.js';
import { ThemeChoice } from '../lib/themes.js';
import { ThemeSelector } from './ThemeSelector.js';
import { WorkspaceManifestEditor } from './WorkspaceManifestEditor.js';
import { useTranslation } from '../lib/i18n/index.js';
import { useSettingsSections } from '../lib/web-features.js';
import YAML from 'yaml';

interface SettingsModalProps {
  local?: boolean;
  /** Whether the home repository, which keeps the manifest, may be written. */
  canWrite: boolean;
  /** The manifest's revision the editor started from. */
  configRevision: string;
  onConfigRevision: (revision: string) => void;
  accountSettings?: React.ReactNode;
  /** Core updates concern a deployment's own repository; a repository a visitor imported has none to update. */
  coreUpdates?: boolean;
  /** The manifest as the repository keeps it, every notebook by its local id; never the keyed configuration routes use. */
  config: WorkspaceConfig | null;
  branch: string;
  onRefreshWorkspace: () => Promise<void>;
  currentTheme: ThemeChoice;
  onSelectTheme: (theme: ThemeChoice) => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({ config, local = true, canWrite, configRevision, onConfigRevision, accountSettings, coreUpdates = true, branch, onRefreshWorkspace, currentTheme, onSelectTheme }) => {
  const { t, language, setLanguage } = useTranslation();
  const sidebar = useWorkspaceSidebarDrawer();
  const featureSections = useSettingsSections();
  const versionNumbering = useVersionNumbering();
  const [yamlContent, setYamlContent] = useState(() => config ? YAML.stringify(config) : '');
  const [isSaving, setIsSaving] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error'; text: string; } | null>(null);

  const [previousConfig, setPreviousConfig] = useState(config);
  if (previousConfig !== config) {
    setPreviousConfig(config);
    if (config) setYamlContent(YAML.stringify(config));
  }

  const handleSaveConfig = async () => {
    setIsSaving(true);
    setStatusMessage(null);
    try {
      // The commit result carries the new revision; a refetch may still answer from the previous snapshot.
      const saved = await updateWorkspaceConfig(yamlContent, configRevision);
      if (saved.configRevision) onConfigRevision(saved.configRevision);
      await onRefreshWorkspace();
      setStatusMessage({ type: 'success', text: t('settings.saved') });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setStatusMessage({ type: 'error', text: msg });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <>
      <WorkspaceSidebarPortal>
        <WorkspaceSidebar label={t('settings.title')} className='settings-sidebar'>
          <div className='sidebar-section-label'>{t('nav.settings')}</div>
          {[...([['language', t('settings.language'), Globe], ['theme', t('settings.theme'), Palette], ['versions', t('settings.versionNumbers'), History], ['access', t('layout.access'), Shield], ...(coreUpdates ? [['updates', t('settings.coreUpdates'), RefreshCw] as const] : []), ['manifest', t('layout.manifest'), Save]] as const), ...featureSections.map(section => [section.id, section.title, section.icon] as const)].map(([id, label, Icon]) => (
            <a
              key={id}
              href={`#settings-${id}`}
              className='sidebar-link'
              onClick={event => {
                event.preventDefault();
                sidebar.setOpen(false);
                document.getElementById(`settings-${id}`)?.scrollIntoView({ block: 'start', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
              }}
            >
              <Icon aria-hidden='true' className='w-4 h-4' />
              <span>{label}</span>
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
            <div id='settings-versions' className='flex flex-col gap-3'>
              <div>
                <h3 className='text-xs font-semibold text-fg uppercase tracking-wider flex items-center gap-1.5'>
                  <History className='w-4 h-4 text-primary' />
                  {t('settings.versionNumbers')}
                </h3>
                <p className='text-xs text-muted mt-0.5'>{t('settings.versionNumbersDescription')}</p>
              </div>
              <Select aria-label={t('settings.versionNumbers')} value={versionNumbering} onValueChange={value => writeVersionNumbering(value as VersionNumbering)} options={[{ value: 'sequence', label: t('settings.versionBySequence') }, { value: 'date', label: t('settings.versionByDate') }]} />
            </div>
            <ProductVersion />
            <div id='settings-access'>{accountSettings}</div>
            {coreUpdates && <CoreUpdates local={local} />}
            {/* Manifest YAML Editor */}
            <div id='settings-manifest' className='flex flex-col gap-2'>
              <div className='flex items-center justify-between'>
                <div className='flex items-center gap-2'>
                  <label className='text-xs font-semibold text-fg uppercase tracking-wider'>{t('settings.manifest')}</label>
                  {branch === 'core' && <span className='text-[11px] px-2 py-0.5 rounded-full bg-sidebar text-muted font-mono'>{t('settings.coreBranchReadOnly')}</span>}
                </div>
                <Button variant='primary' type='button' onClick={handleSaveConfig} disabled={!canWrite || isSaving || branch === 'core'} title={branch === 'core' ? t('settings.coreBranchConfigReadOnlyTitle') : t('settings.saveCommit')}>
                  <Save className='w-3.5 h-3.5' />
                  <span>{isSaving ? t('settings.saving') : t('settings.saveCommit')}</span>
                </Button>
              </div>
              <p className='text-xs text-muted'>{t('settings.manifestHint')}{branch === 'core' && <span className='block mt-1 text-warning text-[11px]'>{t('settings.coreBranchManifestWarning')}</span>}</p>
              <WorkspaceManifestEditor yamlContent={yamlContent} onChange={setYamlContent} readOnly={!canWrite || branch === 'core'} />
              {statusMessage && (
                <div className={`p-3 rounded-lg text-xs flex items-center gap-2 ${statusMessage.type === 'success' ? 'bg-success-soft text-success border border-success/40' : 'bg-danger-soft text-danger border border-danger/40'}`}>
                  {statusMessage.type === 'success' ? <Check className='w-4 h-4 text-success' /> : <AlertCircle className='w-4 h-4 text-danger' />}
                  <span>{statusMessage.text}</span>
                </div>
              )}
            </div>
            {featureSections.map(section => (
              <div key={section.id} id={`settings-${section.id}`} className='flex flex-col gap-3'>
                <h3 className='text-xs font-semibold text-fg uppercase tracking-wider flex items-center gap-1.5'>
                  <section.icon className='w-4 h-4 text-primary' />
                  {section.title}
                </h3>
                {section.element}
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
};
