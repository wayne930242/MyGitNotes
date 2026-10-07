import { useState } from 'react';
import type { NoteRef } from '@mygitnotes/core/note-query';
import { Button } from '../Button.js';
import { ApiError, publishGist, unpublishGist } from '../../lib/api.js';
import { useTranslation } from '../../lib/i18n/index.js';
import { useNoteLocation } from '../../lib/note-location.js';

interface GistProps {
  /** The editor's current body and frontmatter; the Gist holds the body. */
  content: string;
  metadata: Record<string, unknown>;
  setMetadata: (metadata: Record<string, unknown>) => void;
  /** The session accepts no edit right now. */
  locked: boolean;
}

/** The note's info, under the frontmatter in the document panel: the note's notebook, repository, branch, path, whether it can be edited, and its Gist. */
export function NoteInfoPanel({ note, ...gist }: { note: NoteRef; } & GistProps) {
  const { t } = useTranslation();
  const location = useNoteLocation(note);
  if (!location) return null;
  const rows: [string, string][] = [[t('editor.infoNotebook'), location.notebook], [t('editor.infoRepository'), location.repository], [t('editor.infoBranch'), location.branch], [t('editor.infoPath'), location.path]];
  return (
    <section className='note-info-panel' aria-label={t('editor.info')}>
      <dl>
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value || '—'}</dd>
          </div>
        ))}
        <div>
          <dt>{t('editor.infoWrite')}</dt>
          <dd>{location.readOnly ? t(`editor.infoReadOnly.${location.readOnly}`) : t('editor.infoWritable')}</dd>
        </div>
        {location.gists && <NoteGist path={note.path} {...gist} />}
      </dl>
    </section>
  );
}

/**
 * Publishes the note body as a secret Gist and records its id in the `gist` frontmatter of the draft;
 * every later commit of the note updates the Gist. Unpublishing deletes the Gist and drops the field.
 */
function NoteGist({ path, content, metadata, setMetadata, locked }: { path: string; } & GistProps) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; reauthorize: boolean; } | null>(null);
  const id = typeof metadata.gist === 'string' && metadata.gist ? metadata.gist : '';
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (failure) {
      setError({ message: (failure as Error).message, reauthorize: failure instanceof ApiError && failure.reauthorize });
    } finally {
      setBusy(false);
    }
  };
  const publish = () =>
    run(async () => {
      const created = await publishGist({ path, content, metadata });
      setMetadata({ ...metadata, gist: created.id });
    });
  const unpublish = () =>
    run(async () => {
      await unpublishGist(id);
      const { gist: _removed, ...rest } = metadata;
      setMetadata(rest);
    });
  return (
    <div>
      <dt>{t('editor.infoGist')}</dt>
      <dd className='note-info-gist'>
        {id ? <a href={`https://gist.github.com/${encodeURIComponent(id)}`} target='_blank' rel='noreferrer'>{t('editor.gistOpen')}</a> : <span>{t('editor.gistNotPublished')}</span>}
        <Button size='small' variant={id ? 'danger' : 'default'} disabled={busy || locked || (!id && !content.trim())} onClick={() => void (id ? unpublish() : publish())}>{t(id ? 'editor.gistUnpublish' : 'editor.gistPublish')}</Button>
        <span className='note-info-hint'>{t(id ? 'editor.gistSyncHint' : 'editor.gistPublishHint')}</span>
        {error && <span role='alert' className='text-danger'>{error.message} {error.reauthorize && <a className='underline' href='/api/auth/github'>{t('auth.signInWithGithub')}</a>}</span>}
      </dd>
    </div>
  );
}
