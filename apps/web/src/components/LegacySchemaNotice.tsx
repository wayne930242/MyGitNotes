import { COMPILATION_SCHEMA_VERSION } from '@mygitnotes/core/compilation';
import { useTranslation } from '../lib/i18n/index.js';

/** Tells a workspace on a schema before compilations that its Screen lanes are not shown until it is migrated locally. */
export function LegacySchemaNotice({ schemaVersion }: { schemaVersion: number | undefined; }) {
  const { t } = useTranslation();
  if (schemaVersion === undefined || schemaVersion >= COMPILATION_SCHEMA_VERSION) return null;
  return <p role='status' className='mb-3 text-sm text-warning'>{t('workspace.legacySchema', { version: schemaVersion })}</p>;
}
