import { useEffect, useSyncExternalStore } from 'react';
import { applyTheme, getThemeChoice, setThemeChoice, subscribeThemeChoice } from '../lib/themes.js';

/** Reads and changes the shared theme choice; any component may use it. */
export const useThemeChoice = () => useSyncExternalStore(subscribeThemeChoice, getThemeChoice);

/** Applies the shared theme choice to the document; mount once at the app root. */
export function useTheme() {
  const currentTheme = useThemeChoice();

  useEffect(() => {
    applyTheme(currentTheme);
    if (currentTheme.mode !== 'system') return;
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const follow = () => applyTheme(currentTheme);
    query.addEventListener('change', follow);
    return () => query.removeEventListener('change', follow);
  }, [currentTheme]);

  return { currentTheme, handleSelectTheme: setThemeChoice };
}
