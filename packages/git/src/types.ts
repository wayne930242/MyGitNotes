export interface GitStatusResult {
  branch: string;
  isClean: boolean;
  staged: string[];
  modified: string[];
  untracked: string[];
}

export interface GitCommitItem {
  hash: string;
  shortHash: string;
  message: string;
  author: string;
  date: string;
}

export interface CoreUpdateOptions {
  repoRoot: string;
  autoPush?: boolean;
}

export interface CoreUpdateResult {
  success: boolean;
  currentHash: string;
  coreRemoteHash: string;
  remoteUsed: 'upstream' | 'origin';
  message: string;
  conflictedFiles?: string[];
  alreadyUpToDate?: boolean;
}
