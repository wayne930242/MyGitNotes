import type { FileChange } from './types.js';

/** Identifies a change in the Changes views: two repositories can hold the same path. */
export const changeKey = (change: Pick<FileChange, 'path' | 'repository'>) => change.repository ? `${change.repository}\n${change.path}` : change.path;

/** Changes split by repository in first-seen order; without `heading`, one untitled group keeps today's single list. */
export function groupChanges<T extends Pick<FileChange, 'path' | 'repository'>>(files: T[], heading?: (repository: string | undefined) => string): { key: string; heading?: string; files: T[]; }[] {
  if (!heading) return [{ key: '', files }];
  const groups = new Map<string, { key: string; heading?: string; files: T[]; }>();
  for (const file of files) {
    const key = file.repository ?? '';
    const group = groups.get(key) ?? { key, heading: heading(file.repository), files: [] };
    group.files.push(file);
    groups.set(key, group);
  }
  return [...groups.values()];
}
