import type { Availability, CommandSpec } from '../lib/commands/registry.js';
import { useRegisterCommands } from '../lib/commands/registry.js';
import type { I18nContextValue } from '../lib/i18n/index.js';
import type { WorkspaceTab } from '../lib/routes.js';

interface Params {
  t: I18nContextValue['t'];
  activeTab: WorkspaceTab;
  setActiveTab: (tab: WorkspaceTab) => void;
  canCreateNote: boolean;
  createNote: () => void;
  /** Puts the cursor in the Notes toolbar search, opening the field first on narrow screens. */
  focusNoteSearch: () => void;
  /** The page stays put while a note is zoomed, so commands that would leave it are unavailable. */
  noteEditorOpen: boolean;
  /** Commands the displayed page adds, such as the Focus commands. */
  pageCommands: readonly CommandSpec[];
}

const available = (enabled: boolean, reason: string): Availability => enabled ? { enabled: true } : { enabled: false, reason };

/** The app's own palette commands: pages, new note, the note list search, and the page's commands. */
export function useAppCommands({ t, activeTab, setActiveTab, canCreateNote, createNote, focusNoteSearch, noteEditorOpen, pageCommands }: Params) {
  const go = (id: string, tab: WorkspaceTab, title: string, description: string): CommandSpec => ({ id, group: 'goTo', title, description, run: () => setActiveTab(tab) });
  const commands: CommandSpec[] = [go('nav.notes', 'notes', t('nav.notes'), t('shortcuts.describe.notes')), go('nav.graph', 'graph', t('command.nav.graph'), t('command.nav.graph.describe')), go('nav.assets', 'assets', t('nav.assets'), t('shortcuts.describe.assets')), go('nav.agent', 'agent', t('nav.agent'), t('shortcuts.describe.agent')), go('nav.settings', 'settings', t('nav.settings'), t('shortcuts.describe.settings')), { id: 'note.new', group: 'general', title: t('header.newNote'), description: t('shortcuts.describe.newNote'), availability: () => available(canCreateNote, t('shortcuts.requiresWriteAccess')), run: createNote }, { id: 'note.searchList', group: 'general', title: t('command.searchList'), description: t('command.searchList.describe'), availability: () => available(activeTab === 'notes', t('shortcuts.requiresNotes')), run: focusNoteSearch }, ...pageCommands];
  // A zoomed note keeps the page where it is; a command already unavailable keeps its own reason.
  const closedNoteOnly = (command: CommandSpec): CommandSpec => ({
    ...command,
    availability: () => {
      const own = command.availability?.();
      return own && !own.enabled ? own : available(false, t('shortcuts.requiresClosedNote'));
    },
  });
  useRegisterCommands(noteEditorOpen ? commands.map(closedNoteOnly) : commands);
}
