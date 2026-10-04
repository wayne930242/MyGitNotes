import type { WorkspaceDocumentClient } from './use-workspace-document.js';
import { focusDocumentClient } from './use-focus-page.js';
import { bookmarksDocumentClient } from './use-bookmarks.js';

/** The workspace documents a remote draft can hold, one file per notebook repository. */
export const WORKSPACE_DOCUMENT_CLIENTS = [focusDocumentClient, bookmarksDocumentClient] as WorkspaceDocumentClient<unknown>[];
export const documentClientOf = (file: string) => WORKSPACE_DOCUMENT_CLIENTS.find(client => client.document.file === file);
