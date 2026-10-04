import { FOCUS_DOCUMENT, type FocusPage } from '@mygitnotes/core/focus-page';
import { useWorkspaceDocument, type WorkspaceDocumentClient, type WorkspaceDocumentController } from './use-workspace-document.js';

export const focusDocumentClient: WorkspaceDocumentClient<FocusPage> = { document: FOCUS_DOCUMENT, endpoint: '/api/focus-page', draftKey: 'focus-draft', messages: { load: 'focus.loadError', conflict: 'focus.conflict', limit: 'focus.limit', draft: 'focus.draftError', save: 'focus.saveError', loading: 'focus.loading' } };
export function useFocusPage(repository: string | undefined, onSaved: () => void, remote = false, enabled = true) {
  return useWorkspaceDocument(focusDocumentClient, repository, onSaved, remote, enabled);
}
export type FocusPageController = WorkspaceDocumentController<FocusPage>;
