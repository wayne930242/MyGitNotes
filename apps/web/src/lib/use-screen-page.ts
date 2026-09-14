import { useCallback, useEffect, useRef, useState } from 'react';
import { stringify } from 'yaml';
import { ScreenPageSchema, emptyScreenPage, SCREEN_PAGE_FILE, type ScreenPage } from '@mygitnotes/core/screen-page';
import { useTranslation } from './i18n/index.js';

interface Snapshot { page: ScreenPage; revision: string; writable: boolean; path: string }
interface Draft { page: ScreenPage; base: ScreenPage; revision: string; legacy?: boolean }
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
export function useScreenPage(scope: string, onSaved: () => void, remote = false, enabled = true) {
  const { t } = useTranslation();
  const [page, setPage] = useState<ScreenPage>(emptyScreenPage);
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [loading, setLoading] = useState(true), [saving, setSaving] = useState(false), [error, setError] = useState('');
  const [dirty, setDirty] = useState(false);
  const revision = useRef(''), base = useRef<ScreenPage>(emptyScreenPage()), current = useRef(page);
  const saved = useRef(onSaved); saved.current = onSaved;
  const key = `github-notes:screen-draft:${scope}`;
  const currentKey = useRef(key); currentKey.current = key;
  const readDraft = useCallback((): Draft | undefined => {
    const raw = localStorage.getItem(key);
    if (!raw) return;
    const value = JSON.parse(raw);
    return { page: ScreenPageSchema.parse(value.page), base: value.base ? ScreenPageSchema.parse(value.base) : base.current, revision: String(value.revision), legacy: !value.base };
  }, [key]);
  const load = useCallback(async (discard = false) => {
    if (!enabled) return;
    setLoading(true); setError('');
    try {
      const response = await fetch('/api/screen-page');
      if (!response.ok) throw new Error(t('screen.loadError'));
      const record: Snapshot = await response.json(); record.page = ScreenPageSchema.parse(record.page);
      if (currentKey.current !== key) return;
      if (discard) localStorage.removeItem(key);
      base.current = record.page;
      const draft = readDraft();
      base.current = draft?.base || record.page;
      current.current = draft?.page || record.page;
      setSnapshot(record); setPage(current.current); revision.current = draft?.revision || record.revision;
      setDirty(Boolean(draft));
      if (draft && (remote && !draft.legacy ? !same(draft.base, record.page) : draft.revision !== record.revision)) setError(t('screen.conflict'));
    } catch (error) { if (currentKey.current === key) setError((error as Error).message); }
    finally { if (currentKey.current === key) setLoading(false); }
  }, [key, enabled, remote, readDraft, t]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const refresh = (event: StorageEvent) => { if (event.key === key) void load(); };
    window.addEventListener('storage', refresh); return () => window.removeEventListener('storage', refresh);
  }, [key, load]);
  const change = (next: ScreenPage) => {
    if (!snapshot?.writable) return;
    const result = ScreenPageSchema.safeParse(next); if (!result.success) { setError(t('screen.limit')); return; }
    current.current = result.data; setPage(result.data); setDirty(true);
    try { localStorage.setItem(key, JSON.stringify({ page: result.data, base: base.current, revision: revision.current })); }
    catch { setError(t('screen.draftError')); }
  };
  const save = useCallback(async () => {
    if (remote || saving || !snapshot?.writable || !dirty) return;
    const sent = current.current;
    setSaving(true);
    try {
      const response = await fetch('/api/screen-page', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ page: sent, revision: revision.current }) });
      if (!response.ok) throw new Error(t(response.status === 409 ? 'screen.conflict' : 'screen.saveError'));
      const record: Snapshot = await response.json();
      if (currentKey.current !== key) return;
      revision.current = record.revision; base.current = record.page; setSnapshot(record);
      const latest = readDraft();
      // Another tab may have edited while this request was in flight.
      current.current = latest?.page || current.current; setPage(current.current);
      const pending = !same(current.current, sent); setDirty(pending);
      if (pending) localStorage.setItem(key, JSON.stringify({ page: current.current, base: record.page, revision: record.revision }));
      else localStorage.removeItem(key);
      saved.current();
    } catch (error) { if (currentKey.current === key) setError((error as Error).message); }
    finally { setSaving(false); }
  }, [remote, saving, snapshot, dirty, key, readDraft, t]);
  useEffect(() => {
    if (!enabled || loading || remote || !dirty || saving || error) return;
    const timer = setTimeout(() => void save(), 350);
    return () => clearTimeout(timer);
  }, [page, enabled, loading, remote, dirty, saving, error, save]);
  const commitDraft = () => {
    if (error || loading) throw new Error(error || t('screen.loading'));
    const draft = readDraft();
    if (!draft || !same(draft.page, current.current)) throw new Error(t('screen.conflict'));
    return draft;
  };
  const committed = (sent: Draft, nextRevision: string) => {
    const latest = readDraft();
    base.current = sent.page; revision.current = nextRevision;
    setSnapshot(record => record && { ...record, page: sent.page, revision: nextRevision });
    if (!latest || same(latest.page, sent.page)) { localStorage.removeItem(key); setDirty(false); }
    else {
      current.current = latest.page; setPage(latest.page); setDirty(true);
      localStorage.setItem(key, JSON.stringify({ page: latest.page, base: sent.page, revision: nextRevision }));
    }
  };
  const before = stringify(base.current).split('\n'), after = stringify(page).split('\n');
  const diff = dirty ? `--- ${SCREEN_PAGE_FILE}\n+++ ${SCREEN_PAGE_FILE}\n@@ -1,${before.length} +1,${after.length} @@\n${before.map(line => '-' + line).join('\n')}\n${after.map(line => '+' + line).join('\n')}` : '';
  return { page, change, save, reload: () => load(true), refresh: () => load(), loading, saving, dirty, error, writable: Boolean(snapshot?.writable), setError, commitDraft, committed, diff };
}
export type ScreenController = ReturnType<typeof useScreenPage>;
