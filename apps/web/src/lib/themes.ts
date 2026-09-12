import type { TranslationKey } from './i18n/en.js';

export interface ThemeDefinition {
  id: string;
  name: string;
  description: string;
  mode: 'light' | 'dark';
  colors: {
    primary: string;
    primaryHover?: string;
    background: string;
    surface: string;
    sidebar: string;
    border: string;
    text: string;
    muted: string;
  };
  swatches: string[]; // 4 color hexes for the visual palette [bg, surface, primary, text]
}

export const THEMES: ThemeDefinition[] = [
  {
    id: 'clean-indigo',
    name: 'Clean Indigo',
    description: 'Minimal modern light theme with indigo accents',
    mode: 'light',
    colors: {
      primary: '#4f46e5',
      primaryHover: '#4338ca',
      background: '#f8fafc',
      surface: '#ffffff',
      sidebar: '#f1f5f9',
      border: '#e2e8f0',
      text: '#0f172a',
      muted: '#64748b',
    },
    swatches: ['#f8fafc', '#ffffff', '#4f46e5', '#0f172a'],
  },
  {
    id: 'warm-sepia',
    name: 'Warm Sepia',
    description: 'Cozy paper tones with amber accents, gentle on eyes',
    mode: 'light',
    colors: {
      primary: '#d97706',
      primaryHover: '#b45309',
      background: '#faf5eb',
      surface: '#fffdfa',
      sidebar: '#f4ebd8',
      border: '#e6dac0',
      text: '#3b2d20',
      muted: '#7a6652',
    },
    swatches: ['#faf5eb', '#fffdfa', '#d97706', '#3b2d20'],
  },
  {
    id: 'forest-emerald',
    name: 'Forest Emerald',
    description: 'Fresh organic greens and crisp botanical surfaces',
    mode: 'light',
    colors: {
      primary: '#059669',
      primaryHover: '#047857',
      background: '#f0fdf4',
      surface: '#ffffff',
      sidebar: '#e1f7e8',
      border: '#bbf0cf',
      text: '#064e3b',
      muted: '#366952',
    },
    swatches: ['#f0fdf4', '#ffffff', '#059669', '#064e3b'],
  },
  {
    id: 'github-dark',
    name: 'GitHub Dark',
    description: 'Classic developer dark mode with high contrast',
    mode: 'dark',
    colors: {
      primary: '#58a6ff',
      primaryHover: '#79c0ff',
      background: '#0d1117',
      surface: '#161b22',
      sidebar: '#010409',
      border: '#30363d',
      text: '#f0f6fc',
      muted: '#8b949e',
    },
    swatches: ['#0d1117', '#161b22', '#58a6ff', '#f0f6fc'],
  },
  {
    id: 'nord-arctic',
    name: 'Nord Arctic',
    description: 'Arctic darkness with ice-cyan highlighting',
    mode: 'dark',
    colors: {
      primary: '#88c0d0',
      primaryHover: '#9fcbd8',
      background: '#242933',
      surface: '#2e3440',
      sidebar: '#1e222a',
      border: '#3b4252',
      text: '#eceff4',
      muted: '#d8dee9',
    },
    swatches: ['#242933', '#2e3440', '#88c0d0', '#eceff4'],
  },
  {
    id: 'midnight-violet',
    name: 'Midnight Violet',
    description: 'OLED deep black with luminous neon violet accents',
    mode: 'dark',
    colors: {
      primary: '#a855f7',
      primaryHover: '#c084fc',
      background: '#09090b',
      surface: '#121216',
      sidebar: '#050507',
      border: '#27272a',
      text: '#fafafa',
      muted: '#a1a1aa',
    },
    swatches: ['#09090b', '#121216', '#a855f7', '#fafafa'],
  },
];

export function getSavedTheme(): ThemeDefinition {
  try {
    const saved = localStorage.getItem('github_notes_theme');
    const found = THEMES.find((t) => t.id === saved);
    if (found) return found;
  } catch {}
  return THEMES[0];
}

export function applyTheme(theme: ThemeDefinition): void {
  try {
    localStorage.setItem('github_notes_theme', theme.id);
  } catch {}

  const root = document.documentElement;
  root.setAttribute('data-theme', theme.id);

  if (theme.mode === 'dark') {
    root.classList.add('dark');
  } else {
    root.classList.remove('dark');
  }

  root.style.setProperty('--color-primary', theme.colors.primary);
  root.style.setProperty('--color-primary-hover', theme.colors.primaryHover || theme.colors.primary);
  root.style.setProperty('--color-primary-light', `${theme.colors.primary}22`);
  root.style.setProperty('--color-bg', theme.colors.background);
  root.style.setProperty('--color-surface', theme.colors.surface);
  root.style.setProperty('--color-sidebar', theme.colors.sidebar);
  root.style.setProperty('--color-border', theme.colors.border);
  root.style.setProperty('--color-text', theme.colors.text);
  root.style.setProperty('--color-muted', theme.colors.muted);
}

export function getThemeName(theme: ThemeDefinition, t?: (key: TranslationKey) => string): string {
  if (!t) return theme.name;
  const key = `theme.${theme.id}.name` as TranslationKey;
  const translated = t(key);
  return translated && translated !== key ? translated : theme.name;
}

export function getThemeDescription(theme: ThemeDefinition, t?: (key: TranslationKey) => string): string {
  if (!t) return theme.description;
  const key = `theme.${theme.id}.description` as TranslationKey;
  const translated = t(key);
  return translated && translated !== key ? translated : theme.description;
}
