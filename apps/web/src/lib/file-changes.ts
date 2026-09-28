import type { FileChange } from './types.js';

/** Identifies a change in the Changes views: two repositories can hold the same path. */
export const changeKey = (change: Pick<FileChange, 'path' | 'repository'>) => change.repository ? `${change.repository}\n${change.path}` : change.path;
