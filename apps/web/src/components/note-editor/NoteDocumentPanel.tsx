import { Bot, Braces, ChevronDown, ChevronUp, History, ListTree, PanelRightClose, Search, SlidersHorizontal } from 'lucide-react';
import { NoteHistoryPanel, type NoteHistoryPanelProps } from '../NoteHistoryPanel.js';
import { Button } from '../Button.js';
import { NoteFrontmatterPanel } from './NoteFrontmatterPanel.js';
import { NoteViewPanel } from './NoteViewPanel.js';
import { NoteInfoPanel } from './NoteInfoPanel.js';
import { AgentPanel } from '../pi-agent/AgentPanel.js';
import { usePiAgentAvailable } from '../../lib/pi-agent/session.js';
import type { OutlineHeading } from '../../lib/note-navigation.js';
import type { NotebookMetadataField } from '../../lib/types.js';
import type { NotePanelMode } from './types.js';
import { useTranslation } from '../../lib/i18n/index.js';

export interface NoteDocumentPanelProps {
  includeTabs: boolean;
  isMarkdown: boolean;
  setNotePanel: (next: NotePanelMode | null) => void;
  isFindOpen: boolean;
  isOutlineOpen: boolean;
  showFrontmatter: boolean;
  isViewPanelOpen: boolean;
  isHistoryOpen: boolean;
  isAgentOpen: boolean;
  /** The note's history and versions; absent where the note has none to show. */
  history?: NoteHistoryPanelProps;
  /** The note's repository-relative path, for the info under the frontmatter. */
  notePath: string;
  /** The editor's current body, which the info under the frontmatter publishes as a Gist. */
  content: string;
  findQuery: string;
  setFindQuery: (value: string) => void;
  findIndex: number;
  matches: { from: number; to: number; }[];
  stepFind: (delta: number) => void;
  findInputRef: React.RefObject<HTMLInputElement>;
  outline: OutlineHeading[];
  /** Frontmatter lines, so a heading is listed by its line in the file rather than in the body. */
  lineNumberOffset: number;
  outlineIndex: number;
  setOutlineIndex: (index: number) => void;
  chooseOutline: (index: number, closeAfter?: boolean) => void;
  openOutline: () => void;
  newFieldKey: string;
  setNewFieldKey: (value: string) => void;
  frontmatterViewMode: 'form' | 'yaml';
  setFrontmatterViewMode: (mode: 'form' | 'yaml') => void;
  yamlText: string;
  setYamlText: (value: string) => void;
  yamlError: string;
  setYamlError: (value: string) => void;
  tagInput: string;
  setTagInput: (value: string) => void;
  isTagDropdownOpen: boolean;
  setIsTagDropdownOpen: (value: boolean) => void;
  metadata: Record<string, unknown>;
  setMetadata: (metadata: Record<string, unknown>) => void;
  statuses: string[];
  metadataFields?: NotebookMetadataField[];
  availableTags: string[];
  locked: boolean;
  notebookId: string;
  readOnly: boolean;
}

/** The zoom/pane editor's document panel: its tab strip and the find, outline, frontmatter (with the note's info), view and history sections it switches between. */
export function NoteDocumentPanel({ includeTabs, isMarkdown, setNotePanel, isFindOpen, isOutlineOpen, showFrontmatter, isViewPanelOpen, isHistoryOpen, isAgentOpen, history, notePath, content, findQuery, setFindQuery, findIndex, matches, stepFind, findInputRef, outline, lineNumberOffset, outlineIndex, setOutlineIndex, chooseOutline, openOutline, newFieldKey, setNewFieldKey, frontmatterViewMode, setFrontmatterViewMode, yamlText, setYamlText, yamlError, setYamlError, tagInput, setTagInput, isTagDropdownOpen, setIsTagDropdownOpen, metadata, setMetadata, statuses, metadataFields, availableTags, locked, notebookId, readOnly }: NoteDocumentPanelProps) {
  const { t } = useTranslation();
  const agentAvailable = usePiAgentAvailable();

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
                    onFocus={() => setOutlineIndex(index)}
                    onClick={() => chooseOutline(index)}
                  >
                    <span>{heading.label}</span>
                    <small>{heading.line + lineNumberOffset}</small>
                  </button>
                ))}
              </nav>
            )
            : <p>{t('editor.outlineEmpty')}</p>}
        </section>
      )}
      {showFrontmatter && (
        <NoteFrontmatterPanel metadata={metadata} setMetadata={setMetadata} statuses={statuses} metadataFields={metadataFields} availableTags={availableTags} locked={locked} newFieldKey={newFieldKey} setNewFieldKey={setNewFieldKey} frontmatterViewMode={frontmatterViewMode} setFrontmatterViewMode={setFrontmatterViewMode} yamlText={yamlText} setYamlText={setYamlText} yamlError={yamlError} setYamlError={setYamlError} tagInput={tagInput} setTagInput={setTagInput} isTagDropdownOpen={isTagDropdownOpen} setIsTagDropdownOpen={setIsTagDropdownOpen}>
          <NoteInfoPanel note={{ notebookId, path: notePath }} content={content} metadata={metadata} setMetadata={setMetadata} locked={locked || readOnly} />
        </NoteFrontmatterPanel>
      )}
      {isViewPanelOpen && <NoteViewPanel />}
      {isHistoryOpen && history && <NoteHistoryPanel {...history} />}
      {isAgentOpen && agentAvailable && <AgentPanel />}
    </>
  );

  if (!includeTabs) return sections;

  return (
    <>
      <div className='note-panel-tabs'>
        <div
          className='note-panel-tablist'
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
          <Button type='button' role='tab' aria-selected={isFindOpen} tabIndex={isFindOpen || !((isMarkdown && isOutlineOpen) || showFrontmatter || isViewPanelOpen || (history && isHistoryOpen) || isAgentOpen) ? 0 : -1} aria-label={t('editor.findInNote')} title={t('editor.findInNote')} onClick={() => setNotePanel(isFindOpen ? null : 'find')}>
            <Search aria-hidden='true' />
          </Button>
          {isMarkdown && (
            <Button type='button' role='tab' aria-selected={isOutlineOpen} tabIndex={isOutlineOpen ? 0 : -1} aria-label={t('editor.outline')} title={t('editor.outline')} onClick={() => isOutlineOpen ? setNotePanel(null) : openOutline()}>
              <ListTree aria-hidden='true' />
            </Button>
          )}
          <Button type='button' role='tab' aria-selected={showFrontmatter} tabIndex={showFrontmatter ? 0 : -1} aria-label={t('editor.frontmatter')} title={t('editor.frontmatter')} onClick={() => setNotePanel(showFrontmatter ? null : 'frontmatter')}>
            <Braces aria-hidden='true' />
          </Button>
          <Button type='button' role='tab' aria-selected={isViewPanelOpen} tabIndex={isViewPanelOpen ? 0 : -1} aria-label={t('editor.viewSettings')} title={t('editor.viewSettings')} onClick={() => setNotePanel(isViewPanelOpen ? null : 'view')}>
            <SlidersHorizontal aria-hidden='true' />
          </Button>
          {history && (
            <Button type='button' role='tab' aria-selected={isHistoryOpen} tabIndex={isHistoryOpen ? 0 : -1} aria-label={t('history.open')} title={t('history.open')} onClick={() => setNotePanel(isHistoryOpen ? null : 'history')}>
              <History aria-hidden='true' />
            </Button>
          )}
          {agentAvailable && (
            <Button type='button' role='tab' aria-selected={isAgentOpen} tabIndex={isAgentOpen ? 0 : -1} aria-label={t('piAgent.tab')} title={t('piAgent.tab')} onClick={() => setNotePanel(isAgentOpen ? null : 'agent')}>
              <Bot aria-hidden='true' />
            </Button>
          )}
        </div>
        <button type='button' className='note-panel-collapse ui-icon-button' aria-label={t('editor.collapseDocumentPanel')} title={t('editor.collapseDocumentPanel')} onClick={() => setNotePanel(null)}>
          <PanelRightClose aria-hidden='true' />
        </button>
      </div>
      {sections}
    </>
  );
}
