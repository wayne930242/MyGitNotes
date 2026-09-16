import { useState } from 'react';
import type { FileEntry } from '../lib/files-api.js';
import { useTranslation } from '../lib/i18n/index.js';

export function Preview({ entry, url }: { entry: FileEntry; url: string }) {
  const { t } = useTranslation();
  const [failed, setFailed] = useState(false);
  if (failed) return <p role="status">{t('files.previewFailed')}</p>;
  if (entry.presentation === 'image') return <img className="file-preview-image" src={url} alt={entry.name} onError={() => setFailed(true)} />;
  if (entry.presentation === 'pdf') return <object className="file-preview-pdf" data={url} type="application/pdf"><p>{t('files.previewFailed')}</p></object>;
  if (entry.presentation === 'audio') return <audio controls src={url} onError={() => setFailed(true)} />;
  if (entry.presentation === 'video') return <video controls src={url} onError={() => setFailed(true)} />;
  return <p className="file-empty">{t('files.binaryHint')}</p>;
}
