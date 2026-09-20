import { useTranslation } from '../lib/i18n/index.js';

declare const __PRODUCT_BUILD__: { version: string; sha: string; released: boolean; };

export function ProductVersion() {
  const { t } = useTranslation();
  const build = __PRODUCT_BUILD__;
  return <p data-product-version className='text-xs text-muted font-mono'>MyGitNotes v{build.version}{' ('}{build.sha}){!build.released && ` · ${t('settings.unreleasedBuild')}`}</p>;
}
