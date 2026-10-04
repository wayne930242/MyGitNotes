import React, { type ReactNode } from 'react';
import type { NoteListItem } from '@mygitnotes/core/note-query';
import type { CompilationItem, CompilationRow } from '@mygitnotes/core/screen-page';
import type { NotebookConfig } from '../lib/types.js';
import { useStudyWorkspace } from '../lib/use-study-workspace.js';
import { useTranslation } from '../lib/i18n/index.js';
import { CompilationLane } from './CompilationLane.js';
import { useCompilationAssets, useCompilationItemOpen } from './useCompilationItemOpen.js';

const ignoreSaved = () => {};

/** A lane shown read-only in a Focus tab: it keeps its own view, and its items open as they do on Screen. */
export const FocusLaneTab: React.FC<{
  row: CompilationRow;
  /** The repository of the lane's notebook, which keeps its Study data. */
  repository: string | undefined;
  notebooks: NotebookConfig[];
  graph?: ReactNode;
  onOpenNote: (note: NoteListItem) => void;
  /** Opens a folder item without leaving the Notes page; false falls back to the Screen behavior. */
  onOpenFolder: (item: Extract<CompilationItem, { kind: 'folder'; }>) => boolean;
}> = ({ row, repository, notebooks, graph, onOpenNote, onOpenFolder }) => {
  const { t } = useTranslation();
  const study = useStudyWorkspace(repository, ignoreSaved);
  const { assets, error } = useCompilationAssets(notebooks, row.notebookId);
  const [missing, setMissing] = React.useState(false);
  const itemOpen = useCompilationItemOpen({ notebooks, assets, onOpenNote, onMissing: () => setMissing(true) });
  return (
    <div className='focus-lane'>
      {(missing || error) && <p role='alert' className='screen-error'>{t(missing ? 'screen.missing' : 'screen.assetsError')}</p>}
      <CompilationLane
        row={row}
        notebooks={notebooks}
        assets={assets}
        graph={graph}
        reorder={false}
        disabled
        readOnly
        study={study}
        onOpen={(item, note) => {
          setMissing(false);
          if (item.kind !== 'folder' || !onOpenFolder(item)) itemOpen.open(item, note);
        }}
      />
      {itemOpen.preview}
    </div>
  );
};
