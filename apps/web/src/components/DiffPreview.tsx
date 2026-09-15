import { FileDiff } from 'lucide-react';
import { useTranslation } from '../lib/i18n/index.js';
import { parseDiffPreview } from '../lib/diff-preview.js';
import type { FileChange } from '../lib/types.js';
import { EditorNotice } from './EditorNotice.js';

export function DiffPreview({ diff, file, loading = false, error = '' }: { diff: string; file?: FileChange; loading?: boolean; error?: string }) {
  const { t } = useTranslation();
  const preview = parseDiffPreview(diff);
  const reason = file?.unavailableReason || (file?.kind === 'conflict' ? 'conflict' : 'unsupported');
  return <section className="changes-preview" aria-label={t('commit.diffPreview')} aria-busy={loading}>
    <h4><FileDiff aria-hidden="true" /><span>{file?.path || t('commit.diffPreview')}</span>
      {diff && !preview.notice && <span className="diff-stats"><b className="diff-added">+{preview.added}</b><b className="diff-removed">−{preview.removed}</b></span>}
    </h4>
    {error ? <EditorNotice tone="error">{error}</EditorNotice>
      : loading ? <p className="diff-empty" role="status">{t('agent.loadingDocument')}</p>
      : file?.available === false ? <EditorNotice><strong>{t(`changes.reason.${reason}`)}</strong><p>{t(`changes.help.${reason}`)}</p></EditorNotice>
      : preview.notice ? <div className="diff-empty"><FileDiff aria-hidden="true" /><strong>{t(preview.notice === 'binary' ? 'changes.binary' : 'changes.tooLarge')}</strong><p>{t('changes.previewOnly')}</p></div>
      : !diff ? <p className="diff-empty">{t(file ? 'changes.identical' : 'changes.noDiff')}</p>
      : <pre tabIndex={0} className="diff-code">{preview.lines.filter(line => line.kind !== 'header' || !/^(diff --git |index |--- |\+\+\+ )/.test(line.text)).map((line, index) => <span key={index} className={`diff-line diff-${line.kind}`}>
        <span className="diff-line-number" data-number={line.oldLine} aria-hidden="true" />
        <span className="diff-line-number" data-number={line.newLine} aria-hidden="true" />
        <span className="diff-line-text">{line.text}{'\n'}</span>
      </span>)}</pre>}
  </section>;
}
