export type { ViewMode, NotebookConfig, WorkspaceConfig } from '@github-notes/core';

export interface NoteItem {
  revision?: string;
  id: string;
  path: string;
  notebookId: string;
  title: string;
  status?: string;
  tags: string[];
  metadata: Record<string, unknown>;
  content: string;
  mtime?: number;
  size?: number;
}

export interface AssetItem {
  hash?: string;
  directory?: string;
  revision?: string;
  name: string;
  path: string;
  size: number;
  mtime: number;
  rawUrl: string;
  markdownRef: string;
}

export interface AgentResource {
  path: string;
  name: string;
  editable?: boolean;
  scope?: 'notes' | 'workspace' | 'product';
}

export interface GitStatus {
  branch: string;
  isClean: boolean;
  staged: string[];
  modified: string[];
  untracked: string[];
}

export interface FileChange {
  path: string;
  staged: boolean;
  unstaged: boolean;
  kind: 'added' | 'modified' | 'deleted' | 'conflict';
  tracked: boolean;
  revision: string;
  available?: boolean;
}

export interface GitCommit {
  hash: string;
  shortHash: string;
  message: string;
  author: string;
  date: string;
}

export interface LocalDraft {
  path: string;
  content: string;
  metadata: Record<string, unknown>;
  savedAt: number;
}

export interface FolderItem { notebookId: string; path: string; title: string; order: number; description?: string; }
