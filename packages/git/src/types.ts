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
  /** The checkout to update: a `core` checkout, or a fork-model `main` that still tracks product files. */
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
  notesMissingTimestamps?: number;
}
