import { INK, PALETTE_FAMILIES, type PaletteFamily, type PaletteMode, type PaletteVariant } from './palettes.js';

export type ThemeMode = PaletteMode | 'system';

export interface ThemeChoice {
  familyId: string;
  mode: ThemeMode;
}

export const DEFAULT_FAMILY_ID = 'flexoki';
export const THEME_FAMILY_KEY = 'github_notes_theme';
export const THEME_MODE_KEY = 'github_notes_theme_mode';

/** Retired single-mode themes; a saved retired id still tells us the mode the user chose. */
const RETIRED_THEME_MODES: Record<string, PaletteMode> = { 'clean-indigo': 'light', 'warm-sepia': 'light', 'forest-emerald': 'light', 'github-dark': 'dark', 'nord-arctic': 'dark', 'midnight-violet': 'dark' };

export function getFamily(id: string): PaletteFamily {
  return PALETTE_FAMILIES.find(family => family.id === id) ?? PALETTE_FAMILIES.find(family => family.id === DEFAULT_FAMILY_ID)!;
}

function isMode(value: string | null): value is ThemeMode {
  return value === 'light' || value === 'dark' || value === 'system';
}

/** Unknown or retired family ids resolve to Flexoki; the saved mode is kept. */
export function resolveThemeChoice(savedFamily: string | null, savedMode: string | null): ThemeChoice {
  const familyId = PALETTE_FAMILIES.some(family => family.id === savedFamily) ? savedFamily! : DEFAULT_FAMILY_ID;
  const mode = isMode(savedMode) ? savedMode : (savedFamily && RETIRED_THEME_MODES[savedFamily]) || 'system';
  return { familyId, mode };
}

export function getSavedTheme(): ThemeChoice {
  try {
    return resolveThemeChoice(localStorage.getItem(THEME_FAMILY_KEY), localStorage.getItem(THEME_MODE_KEY));
  } catch {
    return { familyId: DEFAULT_FAMILY_ID, mode: 'system' };
  }
}

export function resolveMode(mode: ThemeMode): PaletteMode {
  if (mode !== 'system') return mode;
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function buttonTextColor(background: string): string {
  const rgb = background.replace('#', '').match(/.{2}/g)!.slice(0, 3).map(value => parseInt(value, 16) / 255);
  const linear = rgb.map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
  const luminance = .2126 * linear[0] + .7152 * linear[1] + .0722 * linear[2];
  return (luminance + .05) / .05 >= 1.05 / (luminance + .05) ? INK.black : INK.white;
}

/** CSS custom properties for one variant; every UI colour resolves from these. */
export function themeTokens(variant: PaletteVariant): Record<string, string> {
  const tokens: Record<string, string> = { '--color-bg': variant.background, '--color-surface': variant.surface, '--color-sidebar': variant.sidebar, '--color-border': variant.border, '--color-text': variant.text, '--color-muted': variant.muted, '--color-primary': variant.primary, '--color-primary-hover': variant.primaryHover, '--color-on-primary': buttonTextColor(variant.primary), '--color-on-primary-hover': buttonTextColor(variant.primaryHover), '--color-selection': variant.selection, '--color-code-bg': variant.codeBackground, '--color-danger': variant.danger, '--color-on-danger': buttonTextColor(variant.danger), '--color-warning': variant.warning, '--color-on-warning': buttonTextColor(variant.warning), '--color-success': variant.success, '--color-on-success': buttonTextColor(variant.success), '--color-info': variant.info, '--color-on-info': buttonTextColor(variant.info), '--color-scrim': INK.black, '--color-on-scrim': INK.white };
  variant.accents.forEach((accent, index) => {
    tokens[`--color-accent-${index + 1}`] = accent;
  });
  return tokens;
}

export function applyTheme(choice: ThemeChoice): void {
  try {
    localStorage.setItem(THEME_FAMILY_KEY, choice.familyId);
    localStorage.setItem(THEME_MODE_KEY, choice.mode);
  } catch {}

  const mode = resolveMode(choice.mode);
  const root = document.documentElement;
  root.setAttribute('data-theme', choice.familyId);
  root.setAttribute('data-theme-mode', mode);
  root.classList.toggle('dark', mode === 'dark');
  root.style.colorScheme = mode;
  for (const [name, value] of Object.entries(themeTokens(getFamily(choice.familyId).variants[mode]))) root.style.setProperty(name, value);
}
