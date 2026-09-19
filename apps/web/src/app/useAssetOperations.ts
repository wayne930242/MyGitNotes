import { deleteAsset, fetchAssets, fetchGitStatus, fetchWorkspace, moveAsset, uploadAsset } from '../lib/api.js';
import type { AssetItem, GitStatus } from '../lib/types.js';
import type { NoteListItem } from '@mygitnotes/core/note-query';

interface UseAssetOperationsParams {
  editingNote: NoteListItem | null;
  selectedNotebookId: string;
  remote: boolean;
  setAssets: (assets: AssetItem[]) => void;
  setGitStatus: (status: GitStatus) => void;
}

/** Assets are scoped to whichever notebook the open note (or the selected browse notebook) belongs to. */
export function useAssetOperations({ editingNote, selectedNotebookId, remote, setAssets, setGitStatus }: UseAssetOperationsParams) {
  const handleUploadAsset = async (file: File, directory = '') => {
    return new Promise<AssetItem>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const base64 = reader.result as string;
          const targetNotebookId = editingNote?.notebookId || selectedNotebookId;
          const currentRevision = remote ? (await fetchWorkspace()).revision : undefined;
          const uploaded = await uploadAsset(targetNotebookId, file.name, base64, { directory, revision: currentRevision });
          const assetList = await fetchAssets(targetNotebookId);
          setAssets(assetList);
          const statusRes = await fetchGitStatus();
          setGitStatus(statusRes.status);
          const asset = assetList.find(a => a.path === uploaded.path);
          if (!asset) throw new Error('Uploaded asset could not be found.');
          resolve(asset);
        } catch (err) {
          console.error('Failed to upload asset:', err);
          reject(err);
        }
      };
      reader.onerror = (err) => reject(err);
      reader.readAsDataURL(file);
    });
  };

  const refreshAssets = async () => {
    const targetNotebookId = editingNote?.notebookId || selectedNotebookId;
    const assetList = await fetchAssets(targetNotebookId);
    setAssets(assetList);
    const statusRes = await fetchGitStatus();
    setGitStatus(statusRes.status);
    return assetList;
  };
  const handleDeleteAsset = async (asset: AssetItem) => {
    await deleteAsset(asset.path, { noCommit: !remote, revision: asset.revision });
    await refreshAssets();
  };
  const handleMoveAsset = async (asset: AssetItem, directory: string) => {
    const moved = await moveAsset({ path: asset.path, directory, revision: asset.revision });
    const assetList = await refreshAssets();
    const result = assetList.find(a => a.path === moved.path);
    if (!result) throw new Error('Moved asset could not be found.');
    return result;
  };

  return { handleUploadAsset, refreshAssets, handleDeleteAsset, handleMoveAsset };
}
