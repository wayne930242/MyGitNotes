import type { NoteGraphNode } from '@mygitnotes/core/note-graph';
import type { ScreenRow } from '@mygitnotes/core/screen-page';
import type { GraphPlacement } from '../../lib/graph-layout.js';
import type { FolderItem, NotebookConfig } from '../../lib/types.js';
import type { FilterControls } from '../../lib/filter-controls.js';
import type { ScreenController } from '../../lib/use-screen-page.js';
export type LayoutNode = GraphPlacement['nodes'][number];
export type Node = NoteGraphNode & { x?: number; y?: number; fx?: number; fy?: number; };
export interface GraphPageProps {
  notebooks: NotebookConfig[];
  filters?: FilterControls;
  screen?: ScreenController;
  lane?: ScreenRow;
  folders?: FolderItem[];
}

export type GraphGesture = { kind: 'box' | 'link'; start: { x: number; y: number; }; end: { x: number; y: number; }; source?: string; };
