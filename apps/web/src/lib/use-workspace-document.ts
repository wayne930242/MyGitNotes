import { useCallback, useEffect, useRef, useState } from 'react';
import { stringify } from 'yaml';
import type { WorkspaceDocument } from '@mygitnotes/core';
import { type TranslationKey, useTranslation } from './i18n/index.js';
import { createUnifiedDiff } from './unified-diff.js';

/** How the browser reaches one workspace document and names its failures. */
export interface WorkspaceDocumentClient<T> {
  document: Pick<WorkspaceDocument<T>, 'file' | 'schema' | 'empty' | 'read'>;
  endpoint: string;
  /** Local storage key prefix for the device draft, scoped by repository. */
  draftKey: string;
  messages: Record<'load' | 'conflict' | 'limit' | 'draft' | 'save' | 'loading', TranslationKey>;
}
interface Snapshot<T> {
  page: T;
  revision: string;
  writable: boolean;
  path: string;
}
export interface WorkspaceDocumentDraft<T> {
  page: T;
  base: T;
  revision: string;
  legacy?: boolean;
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Where one repository's draft of a document is stored; for the home repository this is the key drafts used before documents moved per repository. */
export const documentDraftKey = (client: Pick<WorkspaceDocumentClient<unknown>, 'draftKey'>, repository: string) => `github-notes:${client.draftKey}:${repository}`;

/** A stored draft; drafts saved before a format change migrate the same way as the stored file. */
export function readDocumentDraft<T>(client: WorkspaceDocumentClient<T>, repository: string, fallbackBase: T): WorkspaceDocumentDraft<T> | undefined {
  const raw = localStorage.getItem(documentDraftKey(client, repository));
  if (!raw) return;
  const value = JSON.parse(raw);
  return { page: client.document.read(value.page), base: value.base ? client.document.read(value.base) : fallbackBase, revision: String(value.revision), legacy: !value.base };
}

/** A document draft of one repository, waiting in Changes for a remote commit. */
export interface PendingDocument {
  repository: string;
  file: string;
  page: unknown;
  base: unknown;
  diff: string;
  /** Set when the stored draft cannot be read; such a draft can only be discarded. */
  error?: string;
}
const documentDiff = (file: string, base: unknown, page: unknown) => createUnifiedDiff(file, file, stringify(base), stringify(page));

/** Every stored document draft of the given repositories, whichever notebook is open. */
export function pendingDocumentDrafts(clients: WorkspaceDocumentClient<unknown>[], repositories: string[]): PendingDocument[] {
  return repositories.flatMap(repository =>
    clients.flatMap(client => {
      let draft;
      try {
        draft = readDocumentDraft(client, repository, client.document.empty());
      } catch (error) {
        return [{ repository, file: client.document.file, page: undefined, base: undefined, diff: '', error: (error as Error).message }];
      }
      return draft ? [{ repository, file: client.document.file, page: draft.page, base: draft.base, diff: documentDiff(client.document.file, draft.base, draft.page) }] : [];
    })
  );
}

/** Discards one repository's draft of a document. */
export const discardDocumentDraft = (client: Pick<WorkspaceDocumentClient<unknown>, 'draftKey'>, repository: string) => localStorage.removeItem(documentDraftKey(client, repository));

/** Settles a committed draft: clears it, or keeps later edits on top of the committed page. */
export function settleDocumentDraft(client: WorkspaceDocumentClient<unknown>, repository: string, sent: { page: unknown; }, revision: string) {
  const key = documentDraftKey(client, repository);
  const latest = readDocumentDraft(client, repository, sent.page);
  if (!latest || same(latest.page, sent.page)) localStorage.removeItem(key);
  else localStorage.setItem(key, JSON.stringify({ page: latest.page, base: sent.page, revision }));
}

/**
 * Device draft, autosave on local main, and commit handoff for one workspace document of `repository`,
 * the repository of the open notebook.
 */
export function useWorkspaceDocument<T>(client: WorkspaceDocumentClient<T>, repository: string | undefined, onSaved: () => void, remote = false, enabled = true) {
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
  const key = documentDraftKey(client, repository ?? '');
  const target = repository ? `${endpoint}?repository=${encodeURIComponent(repository)}` : endpoint;
  const currentKey = useRef(key);
  /* eslint-disable react/refs -- Document callbacks and the saved comparison baseline remain current without restarting loads. */
  currentKey.current = key;
  /* eslint-enable react/refs */
  const readDraft = useCallback((): WorkspaceDocumentDraft<T> | undefined => readDocumentDraft(client, repository ?? '', base.current), [client, repository]);
  const load = useCallback(async (discard = false) => {
    if (!enabled || !repository) return;
    setLoading(true);
    setError('');
    try {
      const response = await fetch(target);
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
  }, [key, enabled, repository, remote, readDraft, t, target, messages, document]);
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
      const response = await fetch(target, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ page: sent, revision: revision.current, repository }) });
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
  }, [remote, saving, snapshot, dirty, key, readDraft, t, target, repository, messages]);
  useEffect(() => {
    if (!enabled || loading || remote || !dirty || saving || error) return;
    const timer = setTimeout(() => void save(), 350);
    return () => clearTimeout(timer);
  }, [page, enabled, loading, remote, dirty, saving, error, save]);
  /* eslint-disable react/refs -- Document callbacks and the saved comparison baseline remain current without restarting loads. */
  const diff = dirty ? documentDiff(document.file, base.current, page) : '';
  /* eslint-enable react/refs */
  return { client: client as WorkspaceDocumentClient<unknown>, repository, file: document.file, page, change, save, reload: () => load(true), refresh: () => load(), loading, saving, dirty, error, writable: Boolean(snapshot?.writable), setError, diff };
}
export type WorkspaceDocumentController<T> = ReturnType<typeof useWorkspaceDocument<T>>;
