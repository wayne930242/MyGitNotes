import { FOCUS_DOCUMENT, type FocusPage } from '@mygitnotes/core/focus-page';
import type { ScreenNotebookConfig } from '@mygitnotes/core/screen-page';
import { useWorkspaceDocument, type WorkspaceDocumentClient, type WorkspaceDocumentController } from './use-workspace-document.js';

const client: WorkspaceDocumentClient<FocusPage> = { document: FOCUS_DOCUMENT, endpoint: '/api/focus-page', draftKey: 'focus-draft', messages: { load: 'focus.loadError', conflict: 'focus.conflict', limit: 'focus.limit', draft: 'focus.draftError', save: 'focus.saveError', loading: 'focus.loading' } };
export function useFocusPage(scope: string, onSaved: () => void, remote = false, enabled = true, config: ScreenNotebookConfig | null = null) {
  return useWorkspaceDocument(client, scope, onSaved, remote, enabled, config);
}
export type FocusPageController = WorkspaceDocumentController<FocusPage>;
