export type PanelScope = 'folder' | 'current' | 'all';
const VALID_SCOPES: PanelScope[] = ['folder', 'current', 'all'];

export function getSavedPanelScope(storageKey: string): PanelScope {
  if (typeof window === 'undefined' || !window.localStorage) return 'current';
  try {
    const raw = window.localStorage.getItem(storageKey);
    return VALID_SCOPES.includes(raw as PanelScope) ? (raw as PanelScope) : 'current';
  } catch {
    return 'current';
  }
}

export function savePanelScope(storageKey: string, scope: PanelScope): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.setItem(storageKey, scope);
  } catch {
    // ignore quota / storage errors
  }
}
