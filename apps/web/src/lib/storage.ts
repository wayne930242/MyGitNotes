import { LocalDraft } from './types.js';

const DRAFT_PREFIX = 'gh_notes_draft';

function makeDraftKey(branch: string, notePath: string): string {
  return `${DRAFT_PREFIX}:${branch}:${notePath}`;
}

export function saveLocalDraft(
  branch: string,
  notePath: string,
  content: string,
  metadata: Record<string, unknown>
): void {
  try {
    const draft: LocalDraft = {
      path: notePath,
      content,
      metadata,
      savedAt: Date.now(),
    };
    localStorage.setItem(makeDraftKey(branch, notePath), JSON.stringify(draft));
  } catch (err) {
    console.error('Failed to save local draft:', err);
  }
}

export function getLocalDraft(branch: string, notePath: string): LocalDraft | null {
  try {
    const raw = localStorage.getItem(makeDraftKey(branch, notePath));
    if (!raw) return null;
    return JSON.parse(raw) as LocalDraft;
  } catch {
    return null;
  }
}

export function clearLocalDraft(branch: string, notePath: string): void {
  try {
    localStorage.removeItem(makeDraftKey(branch, notePath));
  } catch (err) {
    console.error('Failed to clear local draft:', err);
  }
}

export function listLocalDrafts(branch: string): LocalDraft[] {
  const drafts: LocalDraft[] = [];
  try {
    const prefix = `${DRAFT_PREFIX}:${branch}:`;
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(prefix)) {
        const item = localStorage.getItem(key);
        if (item) {
          drafts.push(JSON.parse(item));
        }
      }
    }
  } catch (err) {
    console.error('Failed to list local drafts:', err);
  }
  return drafts;
}

/** Moves drafts the retired graph editing store kept under `graph-draft:` into the drafts the editor recovers. */
export function adoptGraphDrafts(scope: string): void {
  try {
    const prefix = `graph-draft:${scope}:`;
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(prefix)) keys.push(key);
    }
    for (const key of keys) {
      const path = key.slice(prefix.length);
      try {
        const record = JSON.parse(localStorage.getItem(key) || '') as { base?: { path?: string }; draft?: { content?: unknown; metadata?: unknown } };
        const metadata = record.draft?.metadata;
        if (record.base?.path === path && typeof record.draft?.content === 'string' && !getLocalDraft(scope, path)) {
          saveLocalDraft(scope, path, record.draft.content, metadata && typeof metadata === 'object' ? metadata as Record<string, unknown> : {});
        }
      } catch { /* A record that cannot be read has nothing to adopt. */ }
      localStorage.removeItem(key);
    }
  } catch (err) {
    console.error('Failed to adopt graph drafts:', err);
  }
}
