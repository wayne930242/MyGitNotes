import { CoreUpdates } from './CoreUpdates.js';
import { ProductVersion } from './ProductVersion.js';
import { useWorkspaceSidebarDrawer, WorkspaceSidebar, WorkspaceSidebarPortal, WorkspaceSidebarToggle } from './WorkspaceChrome.js';
import React from 'react';
import { AlertCircle, Check, FolderGit2, Globe, History, Palette, RefreshCw, Save, Shield } from 'lucide-react';
import { Select } from './Select.js';
import { useVersionNumbering, type VersionNumbering, writeVersionNumbering } from '../lib/version-display.js';
import { ThemeChoice } from '../lib/themes.js';
import { ThemeSelector } from './ThemeSelector.js';
import { ManifestSettings, type ManifestSettingsProps } from './ManifestSettings.js';
import { RepositoriesSettings, type RepositoriesSettingsProps } from './RepositoriesSettings.js';
import { useTranslation } from '../lib/i18n/index.js';
import { useSettingsSections } from '../lib/web-features.js';

interface SettingsModalProps {
  local?: boolean;
  /** Each repository's manifest, the editor opening on the current notebook's repository. */
  manifest: Omit<ManifestSettingsProps, 'onRefreshWorkspace'>;
  /** Settings → Repositories: the workspace's members. */
  repositories?: RepositoriesSettingsProps;
  /** No repository shows notes: every one is hidden or unavailable, so Settings is where the person recovers (decision C8). */
  recovery?: boolean;
  accountSettings?: React.ReactNode;
  /** Core updates concern a deployment's own repository; a repository a visitor imported has none to update. */
  coreUpdates?: boolean;
  onRefreshWorkspace: () => Promise<void>;
  currentTheme: ThemeChoice;
  onSelectTheme: (theme: ThemeChoice) => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({ manifest, repositories, recovery = false, local = true, accountSettings, coreUpdates = true, onRefreshWorkspace, currentTheme, onSelectTheme }) => {
  const { t, language, setLanguage } = useTranslation();
  const sidebar = useWorkspaceSidebarDrawer();
  const featureSections = useSettingsSections();
  const versionNumbering = useVersionNumbering();
  return (
    <>
      <WorkspaceSidebarPortal>
        <WorkspaceSidebar label={t('settings.title')} className='settings-sidebar'>
          <div className='sidebar-section-label'>{t('nav.settings')}</div>
          {[...([['language', t('settings.language'), Globe], ['theme', t('settings.theme'), Palette], ['versions', t('settings.versionNumbers'), History], ['access', t('layout.access'), Shield], ...(coreUpdates ? [['updates', t('settings.coreUpdates'), RefreshCw] as const] : []), ...(repositories ? [['repositories', t('repositories.title'), FolderGit2] as const] : []), ['manifest', t('layout.manifest'), Save]] as const), ...featureSections.map(section => [section.id, section.title, section.icon] as const)].map(([id, label, Icon]) => (
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
            {recovery && (
              <p role='alert' className='p-3 rounded-lg text-xs flex items-start gap-2 bg-warning-soft text-warning border border-warning/40'>
                <AlertCircle className='w-4 h-4 shrink-0' />
                <span>{t('repositories.recovery')}</span>
              </p>
            )}
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
            {repositories && <RepositoriesSettings {...repositories} />}
            <ManifestSettings {...manifest} onRefreshWorkspace={onRefreshWorkspace} />
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
