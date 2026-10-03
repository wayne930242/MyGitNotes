import type { FileResult } from '../../lib/files-api.js';
import type { AssetItem, NotebookMetadataField, NoteItem } from '../../lib/types.js';

// Types the editor's parts share with NoteEditor; kept apart so those parts need not import the editor itself.
export type NotePanelMode = 'find' | 'outline' | 'frontmatter' | 'assets' | 'view' | 'info';

/** Props every editor of one note shares, whether zoom or a Focus pane frames it. */
export interface NoteEditorSharedProps {
  statuses: string[];
  metadataFields?: NotebookMetadataField[];
  readOnly?: boolean;
  autoSave?: boolean;
  draftMode?: boolean;
  remoteBase?: NoteItem;
  conflictReason?: string;
  onMarkConflict?: (reason: string, draft: NoteItem, base: NoteItem) => void;
  onSave: (params: { path: string; content: string; metadata?: Record<string, unknown>; revision?: string; baseNote?: NoteItem; }) => Promise<NoteItem>;
  onReadRemote?: (path: string) => Promise<NoteItem>;
  onRestoreFile: (path: string) => Promise<NoteItem | null>;
  /** Commits one note's saved file alone, from the footer; absent when the note's repository is read-only. */
  onCommitFile?: (path: string) => Promise<void>;
  /** Reads the note's uncommitted changes as a unified diff, for the footer's line counts. */
  readDiff?: () => Promise<string>;
  isDirty?: boolean;
  availableTags?: string[];
  assets?: AssetItem[];
  onUploadAsset?: (file: File, directory: string) => Promise<AssetItem>;
  onDeleteAsset?: (asset: AssetItem) => Promise<void>;
  onMoveAsset?: (asset: AssetItem, directory: string) => Promise<AssetItem>;
  /** Guards unsaved workspace edits before a document-panel file action rewrites notes. */
  beforeFileChange?: () => Promise<void>;
  /** Reloads workspace views after a document-panel file action rewrote notes. */
  onFilesChanged?: (result: FileResult) => Promise<void>;
  branch: string;
  draftScope?: string;
}

/** What a host that embeds the editor sees of its session, for features it builds on top of the body. */
export interface NoteEditorSession {
  content: string;
  title: string;
  /** Edits not yet saved by the session. */
  dirty: boolean;
  /** No edit is accepted right now: read-only, blocked by a conflict, restoring or saving. */
  locked: boolean;
}
