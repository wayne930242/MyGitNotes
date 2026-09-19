export interface GitStatusResult {
  branch: string;
  isClean: boolean;
  staged: string[];
  modified: string[];
  untracked: string[];
  upstream: string | null;
  ahead: number;
  behind: number;
}

export interface GitCommitItem {
  hash: string;
  shortHash: string;
  message: string;
  author: string;
  date: string;
}

export interface CoreUpdateOptions {
  /** The `core` checkout to update. */
  repoRoot: string;
  autoPush?: boolean;
}

export interface CoreUpdateResult {
  success: boolean;
  currentHash: string;
  coreRemoteHash: string;
  remoteUsed: 'upstream' | 'origin';
  message: string;
  alreadyUpToDate?: boolean;
}
