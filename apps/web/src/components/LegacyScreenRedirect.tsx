import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from '../lib/i18n/index.js';
import { findCompilationById } from '../lib/compilation-lookup.js';
import { compilationStudyRoute } from '../lib/routes.js';
import type { NotebookConfig } from '../lib/types.js';
import { LoadingStatus } from './LoadingStatus.js';

/**
 * A former Screen URL: `/screen` goes to the notes list, `/screen/lanes/:id` to the compilation that kept
 * the lane's id (its study session, as the old URL was), or to the notes list with a notice when no compilation has it.
 */
export function LegacyScreenRedirect({ laneId, notebooks, onMissing }: { laneId: string | null; notebooks: readonly NotebookConfig[]; onMissing: (message: string) => void; }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  useEffect(() => {
    let alive = true;
    void (async () => {
      if (!laneId) {
        navigate('/notes', { replace: true });
        return;
      }
      const note = await findCompilationById(laneId).catch(() => undefined);
      if (!alive) return;
      const notebook = note && notebooks.find(candidate => candidate.id === note.notebookId);
      if (note && notebook) navigate(compilationStudyRoute(notebook.id, note.path.slice(notebook.root.length + 1)), { replace: true });
      else {
        onMissing(t('compilation.notFound'));
        navigate('/notes', { replace: true });
      }
    })();
    return () => {
      alive = false;
    };
  }, [laneId, notebooks, navigate, onMissing, t]);
  return <LoadingStatus className='p-8'>{t('screen.loading')}</LoadingStatus>;
}
