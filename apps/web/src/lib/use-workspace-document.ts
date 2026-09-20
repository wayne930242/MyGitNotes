import { useCallback, useEffect, useRef, useState } from 'react';
import { stringify } from 'yaml';
import type { ScreenNotebookConfig, WorkspaceDocument } from '@mygitnotes/core';
import { type TranslationKey, useTranslation } from './i18n/index.js';
import { createUnifiedDiff } from './unified-diff.js';

/** How the browser reaches one workspace document and names its failures. */
export interface WorkspaceDocumentClient<T> {
  document: Pick<WorkspaceDocument<T>, 'file' | 'schema' | 'empty' | 'read'>;
  endpoint: string;
  /** Local storage key prefix for the device draft, scoped by source. */
  draftKey: string;
  messages: Record<'load' | 'conflict' | 'limit' | 'draft' | 'save' | 'loading', TranslationKey>;
}
interface Snapshot<T> {
  page: T;
  revision: string;
  writable: boolean;
  path: string;
}
interface WorkspaceDocumentDraft<T> {
  page: T;
  base: T;
  revision: string;
  legacy?: boolean;
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Device draft, autosave on local main, and commit handoff for one workspace document. */
export function useWorkspaceDocument<T>(client: WorkspaceDocumentClient<T>, scope: string, onSaved: () => void, remote = false, enabled = true, config: ScreenNotebookConfig | null = null) {
  const { t } = useTranslation();
  const { document, endpoint, messages } = client;
  const [page, setPage] = useState<T>(document.empty);
  const [snapshot, setSnapshot] = useState<Snapshot<T>>();
  const [loading, setLoading] = useState(true), [saving, setSaving] = useState(false), [error, setError] = useState('');
  const [dirty, setDirty] = useState(false);
  const revision = useRef(''), base = useRef<T>(document.empty()), current = useRef(page);
  const saved = useRef(onSaved);
  /* eslint-disable react/refs -- Document callbacks and the saved comparison baseline remain current without restarting loads. */
  saved.current = onSaved;
  /* eslint-enable react/refs */
  const notebooks = useRef(config);
  /* eslint-disable react/refs -- Document callbacks and the saved comparison baseline remain current without restarting loads. */
  notebooks.current = config;
  /* eslint-enable react/refs */
  const key = `github-notes:${client.draftKey}:${scope}`;
  const currentKey = useRef(key);
  /* eslint-disable react/refs -- Document callbacks and the saved comparison baseline remain current without restarting loads. */
  currentKey.current = key;
  /* eslint-enable react/refs */
  const readDraft = useCallback((): WorkspaceDocumentDraft<T> | undefined => {
    const raw = localStorage.getItem(key);
    if (!raw) return;
    const value = JSON.parse(raw);
    // Drafts saved before a format change migrate the same way as the stored file.
    return { page: document.read(value.page, notebooks.current), base: value.base ? document.read(value.base, notebooks.current) : base.current, revision: String(value.revision), legacy: !value.base };
  }, [key, document]);
  const load = useCallback(async (discard = false) => {
    if (!enabled) return;
    setLoading(true);
    setError('');
    try {
      const response = await fetch(endpoint);
      if (!response.ok) throw new Error(t(messages.load));
      const record: Snapshot<T> = await response.json();
      record.page = document.schema.parse(record.page);
      if (currentKey.current !== key) return;
      if (discard) localStorage.removeItem(key);
      base.current = record.page;
      const draft = readDraft();
      base.current = draft?.base || record.page;
      current.current = draft?.page || record.page;
      setSnapshot(record);
      setPage(current.current);
      revision.current = draft?.revision || record.revision;
      setDirty(Boolean(draft));
      if (draft && (remote && !draft.legacy ? !same(draft.base, record.page) : draft.revision !== record.revision)) setError(t(messages.conflict));
    } catch (error) {
      if (currentKey.current === key) setError((error as Error).message);
    } finally {
      if (currentKey.current === key) setLoading(false);
    }
  }, [key, enabled, remote, readDraft, t, endpoint, messages, document]);
  useEffect(() => {
    /* eslint-disable react/set-state-in-effect -- Loading synchronizes a persisted workspace document and its recovery draft; the request lifecycle owns loading, error and conflict state. */
    void load();
    /* eslint-enable react/set-state-in-effect */
  }, [load]);
  useEffect(() => {
    const refresh = (event: StorageEvent) => {
      if (event.key === key) void load();
    };
    window.addEventListener('storage', refresh);
    return () => window.removeEventListener('storage', refresh);
  }, [key, load]);
  const change = (next: T) => {
    if (!snapshot?.writable) return;
    const result = document.schema.safeParse(next);
    if (!result.success) {
      setError(t(messages.limit));
      return;
    }
    current.current = result.data;
    setPage(result.data);
    setDirty(true);
    try {
      localStorage.setItem(key, JSON.stringify({ page: result.data, base: base.current, revision: revision.current }));
    } catch {
      setError(t(messages.draft));
    }
  };
  const save = useCallback(async () => {
    if (remote || saving || !snapshot?.writable || !dirty) return;
    const sent = current.current;
    setSaving(true);
    try {
      const response = await fetch(endpoint, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ page: sent, revision: revision.current }) });
      if (!response.ok) throw new Error(t(response.status === 409 ? messages.conflict : messages.save));
      const record: Snapshot<T> = await response.json();
      if (currentKey.current !== key) return;
      revision.current = record.revision;
      base.current = record.page;
      setSnapshot(record);
      const latest = readDraft();
      // Another tab may have edited while this request was in flight.
      current.current = latest?.page || current.current;
      setPage(current.current);
      const pending = !same(current.current, sent);
      setDirty(pending);
      if (pending) localStorage.setItem(key, JSON.stringify({ page: current.current, base: record.page, revision: record.revision }));
      else localStorage.removeItem(key);
      saved.current();
    } catch (error) {
      if (currentKey.current === key) setError((error as Error).message);
    } finally {
      setSaving(false);
    }
  }, [remote, saving, snapshot, dirty, key, readDraft, t, endpoint, messages]);
  useEffect(() => {
    if (!enabled || loading || remote || !dirty || saving || error) return;
    const timer = setTimeout(() => void save(), 350);
    return () => clearTimeout(timer);
  }, [page, enabled, loading, remote, dirty, saving, error, save]);
  const commitDraft = () => {
    if (error || loading) throw new Error(error || t(messages.loading));
    const draft = readDraft();
    if (!draft || !same(draft.page, current.current)) throw new Error(t(messages.conflict));
    return draft;
  };
  /** Captures the draft for a remote commit; `committed` settles it after the commit lands. */
  const prepareCommit = () => {
    const draft = commitDraft();
    return { path: document.file, page: draft.page, base: draft.base, committed: (nextRevision: string) => committed(draft, nextRevision) };
  };
  const committed = (sent: WorkspaceDocumentDraft<T>, nextRevision: string) => {
    const latest = readDraft();
    base.current = sent.page;
    revision.current = nextRevision;
    setSnapshot(record => record && { ...record, page: sent.page, revision: nextRevision });
    if (!latest || same(latest.page, sent.page)) {
      localStorage.removeItem(key);
      setDirty(false);
    } else {
      current.current = latest.page;
      setPage(latest.page);
      setDirty(true);
      localStorage.setItem(key, JSON.stringify({ page: latest.page, base: sent.page, revision: nextRevision }));
    }
  };
  /* eslint-disable react/refs -- Document callbacks and the saved comparison baseline remain current without restarting loads. */
  const diff = dirty ? createUnifiedDiff(document.file, document.file, stringify(base.current), stringify(page)) : '';
  /* eslint-enable react/refs */
  return { file: document.file, page, change, save, reload: () => load(true), refresh: () => load(), loading, saving, dirty, error, writable: Boolean(snapshot?.writable), setError, prepareCommit, diff };
}
export type WorkspaceDocumentController<T> = ReturnType<typeof useWorkspaceDocument<T>>;
