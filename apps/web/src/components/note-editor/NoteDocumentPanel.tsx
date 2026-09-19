import { ChevronDown, ChevronUp, Search } from 'lucide-react';
import { AlertTriangle, RotateCcw } from 'lucide-react';
import { Button } from '../Button.js';
import { FileManager } from '../FileManager.js';
import { NoteFrontmatterPanel } from './NoteFrontmatterPanel.js';
import type { OutlineHeading } from '../../lib/note-navigation.js';
import type { NotebookMetadataField } from '../../lib/types.js';
import type { NotePanelMode } from '../NoteEditor.js';
import { useTranslation } from '../../lib/i18n/index.js';

export interface NoteDocumentPanelProps {
  includeTabs: boolean;
  isMarkdown: boolean;
  setNotePanel: (next: NotePanelMode | null) => void;
  isFindOpen: boolean;
  isOutlineOpen: boolean;
  showFrontmatter: boolean;
  isAssetPickerOpen: boolean;
  isGitPanelOpen: boolean;
  findQuery: string;
  setFindQuery: (value: string) => void;
  findIndex: number;
  matches: { from: number; to: number; }[];
  stepFind: (delta: number) => void;
  findInputRef: React.RefObject<HTMLInputElement>;
  outline: OutlineHeading[];
  outlineIndex: number;
  chooseOutline: (index: number, closeAfter?: boolean) => void;
  openOutline: () => void;
  metadata: Record<string, unknown>;
  setMetadata: (metadata: Record<string, unknown>) => void;
  statuses: string[];
  metadataFields?: NotebookMetadataField[];
  availableTags: string[];
  locked: boolean;
  notebookId: string;
  onInsertAssetRef: (ref: string) => void;
  notePath: string;
  branch: string;
  editorState: 'saving' | 'pending' | 'saved';
  editorStatus: string;
  autoSave: boolean;
  readOnly: boolean;
  isDirty: boolean;
  canRestore: boolean;
  confirmRestore: boolean;
  onRestoreClick: () => void;
}

/** The zoom/pane editor's document panel: its tab strip and the find, outline, frontmatter, asset and git sections it switches between. */
export function NoteDocumentPanel({ includeTabs, isMarkdown, setNotePanel, isFindOpen, isOutlineOpen, showFrontmatter, isAssetPickerOpen, isGitPanelOpen, findQuery, setFindQuery, findIndex, matches, stepFind, findInputRef, outline, outlineIndex, chooseOutline, openOutline, metadata, setMetadata, statuses, metadataFields, availableTags, locked, notebookId, onInsertAssetRef, notePath, branch, editorState, editorStatus, autoSave, readOnly, isDirty, canRestore, confirmRestore, onRestoreClick }: NoteDocumentPanelProps) {
  const { t } = useTranslation();

  const sections = (
    <>
      {isFindOpen && (
        <form
          className='note-find-panel'
          role='search'
          aria-label={t('editor.findInNote')}
          onSubmit={event => {
            event.preventDefault();
            stepFind(1);
          }}
        >
          <label className='note-find-field'>
            <Search aria-hidden='true' />
            <input
              ref={findInputRef}
              type='search'
              value={findQuery}
              onChange={event => setFindQuery(event.target.value)}
              onKeyDown={event => {
                if (event.key === 'Enter' && event.shiftKey) {
                  event.preventDefault();
                  stepFind(-1);
                }
              }}
              aria-label={t('editor.findInNote')}
              placeholder={t('editor.findPlaceholder')}
              autoComplete='off'
            />
          </label>
          <div className='note-find-navigation'>
            <span className='note-find-count' aria-live='polite'>{findQuery ? matches.length ? t('editor.matchCount', { current: Math.min(findIndex + 1, matches.length), total: matches.length }) : t('editor.noMatches') : ''}</span>
            <button
              type='button'
              className='ui-icon-button'
              aria-label={t('editor.previousMatch')}
              disabled={matches.length === 0}
              onClick={() => stepFind(-1)}
            >
              <ChevronUp aria-hidden='true' />
            </button>
            <button type='submit' className='ui-icon-button' aria-label={t('editor.nextMatch')} disabled={matches.length === 0}>
              <ChevronDown aria-hidden='true' />
            </button>
          </div>
        </form>
      )}
      {isOutlineOpen && (
        <section className='note-outline' aria-label={t('editor.outline')}>
          {outline.length > 0
            ? (
              <nav aria-label={t('editor.outline')}>
                {outline.map((heading, index) => (
                  <button
                    type='button'
                    key={`${heading.from}-${index}`}
                    data-outline-index={index}
                    aria-current={index === outlineIndex ? 'true' : undefined}
                    style={{ paddingInlineStart: `${12 + (heading.depth - 1) * 14}px` }}
                    title={heading.label}
                    onFocus={() => chooseOutline(index)}
                    onClick={() => chooseOutline(index)}
                  >
                    <span>{heading.label}</span>
                    <small>{heading.line}</small>
                  </button>
                ))}
              </nav>
            )
            : <p>{t('editor.outlineEmpty')}</p>}
        </section>
      )}
      {showFrontmatter && <NoteFrontmatterPanel metadata={metadata} setMetadata={setMetadata} statuses={statuses} metadataFields={metadataFields} availableTags={availableTags} locked={locked} />}
      {isAssetPickerOpen && <FileManager notebookId={notebookId} writable={false} mode='pick-image' layout='panel' onInsert={locked ? undefined : onInsertAssetRef} />}
      {isGitPanelOpen && (
        <div className='note-git-panel note-panel-scroll'>
          <dl>
            <div>
              <dt>{t('editor.filePath')}</dt>
              <dd className='font-mono'>{notePath}</dd>
            </div>
            <div>
              <dt>{t('editor.currentBranch')}</dt>
              <dd className='font-mono'>{branch}</dd>
            </div>
          </dl>
          <div className='note-git-state' data-state={editorState} role='status'>
            <span aria-hidden='true' />
            {editorStatus}
          </div>
          {autoSave && !readOnly ? <button type='button' aria-label={confirmRestore ? t('editor.confirmRestoreNote') : t('editor.restoreNote')} disabled={!canRestore} onClick={onRestoreClick} className={`ui-button ${confirmRestore ? 'ui-button-danger note-restore-confirm' : ''}`} title={confirmRestore ? t('editor.confirmRestoreTooltip') : t('editor.restoreTooltip')}>{confirmRestore ? <AlertTriangle aria-hidden='true' /> : <RotateCcw aria-hidden='true' />}{confirmRestore ? t('editor.confirmRestore') : t('editor.restore')}</button> : <p className='note-git-help'>{t('editor.restoreUnavailable')}</p>}
          {!isDirty && autoSave && !readOnly && <p className='note-git-help'>{t('editor.noFileChanges')}</p>}
        </div>
      )}
    </>
  );

  if (!includeTabs) return sections;

  return (
    <>
      <div
        className='note-panel-tabs'
        role='tablist'
        aria-label={t('editor.documentPanel')}
        onKeyDown={event => {
          const tabs = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
          const index = tabs.indexOf(document.activeElement as HTMLButtonElement);
          const target = { ArrowLeft: index - 1, ArrowRight: index + 1, Home: 0, End: tabs.length - 1 }[event.key];
          if (index < 0 || target === undefined) return;
          event.preventDefault();
          tabs[(target + tabs.length) % tabs.length].focus();
        }}
      >
        <Button type='button' role='tab' aria-selected={isFindOpen} tabIndex={isFindOpen || !((isMarkdown && isOutlineOpen) || showFrontmatter || isAssetPickerOpen || isGitPanelOpen) ? 0 : -1} aria-label={t('editor.findInNote')} title={t('editor.findInNote')} onClick={() => setNotePanel(isFindOpen ? null : 'find')}>
          <span>{t('editor.find')}</span>
        </Button>
        {isMarkdown && (
          <Button type='button' role='tab' aria-selected={isOutlineOpen} tabIndex={isOutlineOpen ? 0 : -1} aria-label={t('editor.outline')} title={t('editor.outline')} onClick={() => isOutlineOpen ? setNotePanel(null) : openOutline()}>
            <span>{t('editor.outline')}</span>
          </Button>
        )}
        <Button type='button' role='tab' aria-selected={showFrontmatter} tabIndex={showFrontmatter ? 0 : -1} aria-label={t('editor.frontmatter')} title={t('editor.frontmatter')} onClick={() => setNotePanel(showFrontmatter ? null : 'frontmatter')}>
          <span>{t('editor.frontmatter')}</span>
        </Button>
        <Button type='button' role='tab' aria-selected={isAssetPickerOpen} tabIndex={isAssetPickerOpen ? 0 : -1} aria-label={t('editor.notebookAssets')} title={t('editor.notebookAssets')} onClick={() => setNotePanel(isAssetPickerOpen ? null : 'assets')}>
          <span>{t('editor.asset')}</span>
        </Button>
        <Button type='button' role='tab' aria-selected={isGitPanelOpen} tabIndex={isGitPanelOpen ? 0 : -1} aria-label={t('editor.fileGitStatus')} title={t('editor.fileGitStatus')} onClick={() => setNotePanel(isGitPanelOpen ? null : 'git')}>
          <span>{t('editor.git')}</span>
        </Button>
      </div>
      {sections}
    </>
  );
}
