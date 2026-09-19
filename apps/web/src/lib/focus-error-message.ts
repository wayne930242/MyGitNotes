import { FocusError } from '@mygitnotes/core/focus-page';
import type { TranslationKey } from './i18n/index.js';

/** The reason a Focus mutation failed, in the user's language where one is defined. */
export function focusErrorMessage(t: (key: TranslationKey, params?: Record<string, string | number>) => string, error: unknown): string {
  if (!(error instanceof FocusError)) return error instanceof Error ? error.message : String(error);
  switch (error.code) {
    case 'duplicate-name':
      return t('focus.duplicateName');
    case 'tab-limit':
    case 'focus-limit':
      return t('focus.limit');
    default:
      return error.message;
  }
}
