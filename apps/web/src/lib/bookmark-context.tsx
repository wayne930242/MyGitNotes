import { createContext, useContext } from 'react';
import type { Bookmark, BookmarksPage, BookmarkTarget } from '@mygitnotes/core/bookmarks';
import type { TextAnchor } from '@mygitnotes/core/bookmark-anchor';
import type { SavedBookmarkQuery } from '@mygitnotes/core/bookmark-query';
import type { FolderItem, NotebookConfig, NoteItem } from './types.js';
import type { WorkspaceRepository } from './workspace-repositories.js';
import type { BookmarksController } from './use-bookmarks.js';

export interface BookmarkEditRequest {
  notebookId: string;
  id?: string;
  target?: BookmarkTarget;
  label?: string;
  positionPath?: string;
}
export interface BookmarkPositionRequest {
  id: string;
  notebookId: string;
  path: string;
  anchor: TextAnchor;
}
export interface BookmarkContextValue {
  controller: BookmarksController;
  notebooks: NotebookConfig[];
  folders: FolderItem[];
  repositoryFor: (id: string) => WorkspaceRepository | undefined;
  remote: boolean;
  refreshKey: string;
  request: (request: BookmarkEditRequest) => void;
  mutate: (owner: string, change: (page: BookmarksPage) => BookmarksPage) => void;
  activate: (owner: string, bookmark: Bookmark, wholeNote?: boolean) => Promise<void>;
  captureView: () => SavedBookmarkQuery;
  bookmarkNote: (note: NoteItem) => void;
  bookmarkPosition: (note: NoteItem, anchor?: TextAnchor) => void;
  position: BookmarkPositionRequest | null;
  consumePosition: (id: string, found: boolean) => void;
}
// One application owner coordinates shared document and editor state.
const BookmarkContext = createContext<BookmarkContextValue | null>(null);
export const BookmarksProvider = BookmarkContext.Provider;
export const useBookmarkActionsContext = () => useContext(BookmarkContext);
