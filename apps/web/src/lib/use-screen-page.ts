import { useCallback, useEffect, useRef, useState } from 'react';
import { ScreenPageSchema, emptyScreenPage, type ScreenPage } from '@github-notes/core/screen-page';
import { useTranslation } from './i18n/index.js';

interface Snapshot { page: ScreenPage; revision: string; writable: boolean; path: string }
export function useScreenPage(scope: string, onSaved: () => void) {
  const { t } = useTranslation();
  const [page, setPage] = useState<ScreenPage>(emptyScreenPage);
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [loading, setLoading] = useState(true), [saving, setSaving] = useState(false), [error, setError] = useState('');
  const [dirty, setDirty] = useState(false);
  const revision = useRef('');
  const key = `github-notes:screen-draft:${scope}`;
  const load = useCallback(async (discard = false) => {
    setLoading(true); setError('');
    try {
      const response = await fetch('/api/screen-page');
      if (!response.ok) throw new Error(t('screen.loadError'));
      const record: Snapshot = await response.json(); record.page = ScreenPageSchema.parse(record.page);
      let draft: { page: ScreenPage; revision: string } | undefined;
      try {
        if (discard) localStorage.removeItem(key);
        const raw = localStorage.getItem(key);
        if (raw) { const value = JSON.parse(raw); draft = { page: ScreenPageSchema.parse(value.page), revision: String(value.revision) }; }
      } catch { /* Malformed device drafts never replace the YAML configuration. */ }
      setSnapshot(record); setPage(draft?.page || record.page); revision.current = draft?.revision || record.revision;
      setDirty(Boolean(draft));
      if (draft && draft.revision !== record.revision) setError(t('screen.conflict'));
    } catch (error) { setError((error as Error).message); }
    finally { setLoading(false); }
  }, [key, t]);
  useEffect(() => { void load(); }, [load]);
  const change = (next: ScreenPage) => {
    if (saving || !snapshot?.writable) return;
    const result = ScreenPageSchema.safeParse(next); if (!result.success) { setError(t('screen.limit')); return; }
    const valid = result.data; setPage(valid); setDirty(true);
    try { localStorage.setItem(key, JSON.stringify({ page: valid, revision: revision.current })); }
    catch { setError(t('screen.draftError')); }
  };
  const save = async () => {
    if (saving || !snapshot?.writable || !dirty) return;
    setSaving(true); setError('');
    try {
      const response = await fetch('/api/screen-page', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ page, revision: revision.current }) });
      if (!response.ok) throw new Error(t(response.status === 409 ? 'screen.conflict' : 'screen.saveError'));
      const record: Snapshot = await response.json();
      revision.current = record.revision; setSnapshot(record); setDirty(false);
      try { localStorage.removeItem(key); } catch { /* The server receipt remains authoritative. */ }
      onSaved();
    } catch (error) { setError((error as Error).message); }
    finally { setSaving(false); }
  };
  return { page, change, save, reload: () => load(true), loading, saving, dirty, error, writable: Boolean(snapshot?.writable), setError };
}
