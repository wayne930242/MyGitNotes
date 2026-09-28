import { SCREEN_DOCUMENT, type ScreenNotebookConfig, type ScreenPage } from '@mygitnotes/core/screen-page';
import { useWorkspaceDocument, type WorkspaceDocumentClient, type WorkspaceDocumentController } from './use-workspace-document.js';

export const screenDocumentClient: WorkspaceDocumentClient<ScreenPage> = { document: SCREEN_DOCUMENT, endpoint: '/api/screen-page', draftKey: 'screen-draft', messages: { load: 'screen.loadError', conflict: 'screen.conflict', limit: 'screen.limit', draft: 'screen.draftError', save: 'screen.saveError', loading: 'screen.loading' } };
export function useScreenPage(repository: string | undefined, onSaved: () => void, remote = false, enabled = true, config: ScreenNotebookConfig | null = null) {
  return useWorkspaceDocument(screenDocumentClient, repository, onSaved, remote, enabled, config);
}
export type ScreenController = WorkspaceDocumentController<ScreenPage>;
