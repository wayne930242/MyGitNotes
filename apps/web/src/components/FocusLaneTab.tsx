import React, { type ReactNode } from 'react';
import type { NoteListItem } from '@mygitnotes/core/note-query';
import type { ScreenItem, ScreenRow } from '@mygitnotes/core/screen-page';
import type { NotebookConfig } from '../lib/types.js';
import { useStudyWorkspace } from '../lib/use-study-workspace.js';
import { useTranslation } from '../lib/i18n/index.js';
import { ScreenLane } from './ScreenLane.js';
import { useScreenAssets, useScreenItemOpen } from './useScreenItemOpen.js';

const ignoreSaved = () => {};

/** A lane shown read-only in a Focus tab: it keeps its own view, and its items open as they do on Screen. */
export const FocusLaneTab: React.FC<{
  row: ScreenRow; notebooks: NotebookConfig[]; graph?: ReactNode;
  onOpenNote: (note: NoteListItem) => void;
  /** Opens a folder item without leaving the Notes page; false falls back to the Screen behavior. */
  onOpenFolder: (item: Extract<ScreenItem, { kind: 'folder' }>) => boolean;
}> = ({ row, notebooks, graph, onOpenNote, onOpenFolder }) => {
  const { t } = useTranslation();
  const study = useStudyWorkspace(ignoreSaved);
  const { assets, error } = useScreenAssets(notebooks, row.notebookId);
  const [missing, setMissing] = React.useState(false);
  const itemOpen = useScreenItemOpen({ notebooks, assets, onOpenNote, onMissing: () => setMissing(true) });
  return <div className="focus-lane">
    {(missing || error) && <p role="alert" className="screen-error">{t(missing ? 'screen.missing' : 'screen.assetsError')}</p>}
    <ScreenLane row={row} notebooks={notebooks} assets={assets} graph={graph} reorder={false} disabled readOnly study={study}
      onOpen={(item, note) => { setMissing(false); if (item.kind !== 'folder' || !onOpenFolder(item)) itemOpen.open(item, note); }} />
    {itemOpen.preview}
  </div>;
};
