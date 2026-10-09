import type { WorkspacePreferences, YouTubeDisplayMode } from './types.js';

/** Every preference a manifest may set, as one repository's notebooks apply them. */
export type ResolvedPreferences = Required<WorkspacePreferences>;

/** The preferences of a repository whose manifest sets none, and of a workspace with no repository to take them from. */
export const DEFAULT_WORKSPACE_PREFERENCES: ResolvedPreferences = { defaultYoutubeDisplayMode: 'thumbnail', defaultShowLineNumbers: false, defaultFocusMode: false };

const YOUTUBE_DISPLAY_MODES: YouTubeDisplayMode[] = ['thumbnail', 'medium', 'theater'];

/** Normalizes the optional `preferences` block, casting invalid values to their defaults rather than throwing, matching `default_view`'s lenient style. */
export function normalizePreferences(raw: unknown): ResolvedPreferences {
  const prefs = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  return { defaultYoutubeDisplayMode: YOUTUBE_DISPLAY_MODES.includes(prefs.defaultYoutubeDisplayMode as YouTubeDisplayMode) ? prefs.defaultYoutubeDisplayMode as YouTubeDisplayMode : DEFAULT_WORKSPACE_PREFERENCES.defaultYoutubeDisplayMode, defaultShowLineNumbers: typeof prefs.defaultShowLineNumbers === 'boolean' ? prefs.defaultShowLineNumbers : DEFAULT_WORKSPACE_PREFERENCES.defaultShowLineNumbers, defaultFocusMode: typeof prefs.defaultFocusMode === 'boolean' ? prefs.defaultFocusMode : DEFAULT_WORKSPACE_PREFERENCES.defaultFocusMode };
}
