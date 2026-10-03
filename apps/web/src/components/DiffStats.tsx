import type { DiffStats as Stats } from '../lib/diff-preview.js';
import { useTranslation } from '../lib/i18n/index.js';

/** A diff's added and removed line counts, shown as `+x −n`. */
export function DiffStats({ stats }: { stats: Stats; }) {
  const { t } = useTranslation();
  const label = t('changes.diffStats', { added: stats.added, removed: stats.removed });
  return (
    <span className='diff-stats' role='img' aria-label={label} title={label}>
      <b className='diff-added' aria-hidden='true'>+{stats.added}</b>
      <b className='diff-removed' aria-hidden='true'>−{stats.removed}</b>
    </span>
  );
}
