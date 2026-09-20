import { useEffect, useState } from 'react';
import { applyTheme, getSavedTheme, ThemeChoice } from '../lib/themes.js';

export function useTheme() {
  // Theme State
  const [currentTheme, setCurrentTheme] = useState<ThemeChoice>(() => getSavedTheme());

  useEffect(() => {
    applyTheme(currentTheme);
    if (currentTheme.mode !== 'system') return;
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const follow = () => applyTheme(currentTheme);
    query.addEventListener('change', follow);
    return () => query.removeEventListener('change', follow);
  }, [currentTheme]);

  const handleSelectTheme = (theme: ThemeChoice) => setCurrentTheme(theme);

  return { currentTheme, handleSelectTheme };
}
