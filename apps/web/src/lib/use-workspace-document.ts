import { useCallback, useEffect, useRef, useState } from 'react';
import { stringify } from 'yaml';
import type { WorkspaceDocument } from '@mygitnotes/core';
import { type TranslationKey, useTranslation } from './i18n/index.js';
import { createUnifiedDiff } from './unified-diff.js';
import { notebookIdCodec } from './notebook-keys.js';

/** How the browser reaches one workspace document and names its failures. */
export interface WorkspaceDocumentClient<T> {
  document: Pick<WorkspaceDocument<T>, 'file' | 'schema' | 'empty' | 'read' | 'mapNotebookIds'>;
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
  id?: string;
  ancestors?: string[];
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** The repository a document draft belongs to: its id names the draft's storage key, its alias names its notebooks by key. */
export interface DocumentRepository {
  id: string;
  alias: string;
}

/** Where one repository's draft of a document is stored; for the home repository this is the key drafts used before documents moved per repository. */
export const documentDraftKey = (client: Pick<WorkspaceDocumentClient<unknown>, 'draftKey'>, repository: string) => `github-notes:${client.draftKey}:${repository}`;

/**
 * A stored draft, its notebooks named by key; drafts saved before a format change migrate the same way as the stored
 * file. The draft keeps the repository's local notebook ids in storage, as the file does.
 */
export function readDocumentDraft<T>(client: WorkspaceDocumentClient<T>, repository: DocumentRepository, fallbackBase: T): WorkspaceDocumentDraft<T> | undefined {
  const raw = localStorage.getItem(documentDraftKey(client, repository.id));
  if (!raw) return;
  const value = JSON.parse(raw);
  const { toKey } = notebookIdCodec(repository.alias);
  const keyed = (stored: unknown) => client.document.mapNotebookIds(client.document.read(stored), toKey);
  return { page: keyed(value.page), base: value.base ? keyed(value.base) : fallbackBase, revision: String(value.revision), legacy: !value.base, id: typeof value.id === 'string' ? value.id : undefined, ancestors: Array.isArray(value.ancestors) && value.ancestors.every((id: unknown) => typeof id === 'string') ? value.ancestors : [] };
}

/** Stores a draft whose notebooks are named by key with the repository's local ids. */
function writeDocumentDraft<T>(client: WorkspaceDocumentClient<T>, repository: DocumentRepository, draft: WorkspaceDocumentDraft<T>) {
  const { toLocal } = notebookIdCodec(repository.alias);
  const stored = (page: T) => client.document.mapNotebookIds(page, toLocal);
  localStorage.setItem(documentDraftKey(client, repository.id), JSON.stringify({ ...draft, page: stored(draft.page), base: stored(draft.base) }));
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
export function pendingDocumentDrafts(clients: WorkspaceDocumentClient<unknown>[], repositories: DocumentRepository[]): PendingDocument[] {
  return repositories.flatMap(repository =>
    clients.flatMap(client => {
      let draft;
      try {
        draft = readDocumentDraft(client, repository, client.document.empty());
      } catch (error) {
        return [{ repository: repository.id, file: client.document.file, page: undefined, base: undefined, diff: '', error: (error as Error).message }];
      }
      return draft ? [{ repository: repository.id, file: client.document.file, page: draft.page, base: draft.base, diff: documentDiff(client.document.file, draft.base, draft.page) }] : [];
    })
  );
}

/** Discards one repository's draft of a document. */
export const discardDocumentDraft = (client: Pick<WorkspaceDocumentClient<unknown>, 'draftKey'>, repository: string) => localStorage.removeItem(documentDraftKey(client, repository));

/** Settles a committed draft: clears it, or keeps later edits on top of the committed page. */
export function settleDocumentDraft(client: WorkspaceDocumentClient<unknown>, repository: DocumentRepository, sent: { page: unknown; base?: unknown; id?: string; }, revision: string): boolean {
  const latest = readDocumentDraft(client, repository, sent.page);
  if (!latest) return true;
  const identical = same(latest.page, sent.page) && same(latest.base, sent.base);
  const descends = Boolean(sent.id && (latest.id === sent.id || latest.ancestors?.includes(sent.id)));
  if (!identical && !descends) return false;
  if (same(latest.page, sent.page)) localStorage.removeItem(documentDraftKey(client, repository.id));
  else writeDocumentDraft(client, repository, { ...latest, base: sent.page, revision });
  return true;
}

/**
 * Device draft, autosave on local main, and commit handoff for one workspace document of `repository`,
 * the repository of the open notebook.
 */
export function useWorkspaceDocument<T>(client: WorkspaceDocumentClient<T>, owner: DocumentRepository | undefined, onSaved: () => void, remote = false, enabled = true) {
  const { t } = useTranslation();
  const repository = owner?.id, alias = owner?.alias ?? '';
  const { document, endpoint, messages } = client;
  const [page, setPage] = useState<T>(document.empty);
  const [snapshot, setSnapshot] = useState<Snapshot<T>>();
  const [loading, setLoading] = useState(true), [saving, setSaving] = useState(false), [error, setError] = useState('');
  const [dirty, setDirty] = useState(false);
  const revision = useRef(''), base = useRef<T>(document.empty()), current = useRef(page);
  const loadRequest = useRef(0), draftIdentity = useRef<string>();
  const [snapshotKey, setSnapshotKey] = useState('');
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
  const readDraft = useCallback((): WorkspaceDocumentDraft<T> | undefined => readDocumentDraft(client, { id: repository ?? '', alias }, base.current), [client, repository, alias]);
  const load = useCallback(async (discard = false) => {
    const request = ++loadRequest.current;
    if (!enabled || !repository) {
      setSnapshot(undefined);
      setLoading(false);
      return;
    }
    setLoading(true);
    setSaving(false);
    setError('');
    try {
      const response = await fetch(target);
      if (!response.ok) throw new Error(t(messages.load));
      const record: Snapshot<T> = await response.json();
      record.page = document.schema.parse(record.page);
      if (currentKey.current !== key || request !== loadRequest.current) return;
      if (discard) localStorage.removeItem(key);
      base.current = record.page;
      const draft = readDraft();
      base.current = draft?.base || record.page;
      current.current = draft?.page || record.page;
      draftIdentity.current = draft?.id;
      setSnapshotKey(key);
      setSnapshot(record);
      setPage(current.current);
      revision.current = draft?.revision || record.revision;
      setDirty(Boolean(draft));
      if (draft && (remote && !draft.legacy ? !same(draft.base, record.page) : draft.revision !== record.revision)) setError(t(messages.conflict));
    } catch (error) {
      if (currentKey.current === key && request === loadRequest.current) {
        setSnapshot(undefined);
        setError((error as Error).message);
      }
    } finally {
      if (currentKey.current === key && request === loadRequest.current) setLoading(false);
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
    if (!snapshot?.writable || loading || error || snapshotKey !== key || !repository) return;
    const result = document.schema.safeParse(next);
    if (!result.success) {
      setError(t(messages.limit));
      return;
    }
    try {
      const previous = readDraft();
      if (previous && previous.id !== draftIdentity.current) {
        setError(t(messages.conflict));
        return;
      }
      const id = crypto.randomUUID();
      writeDocumentDraft(client, { id: repository, alias }, { page: result.data, base: base.current, revision: revision.current, id, ancestors: [...(previous?.ancestors ?? []), ...(previous?.id ? [previous.id] : [])].slice(-100) });
      draftIdentity.current = id;
      current.current = result.data;
      setPage(result.data);
      setDirty(true);
    } catch {
      setError(t(messages.draft));
    }
  };
  const save = useCallback(async () => {
    if (remote || saving || loading || error || snapshotKey !== key || !snapshot?.writable || !dirty) return;
    const sent = current.current;
    const sentDraft = readDraft();
    if (!sentDraft || !same(sentDraft.page, sent) || sentDraft.id !== draftIdentity.current) {
      setError(t(messages.conflict));
      return;
    }
    setSaving(true);
    try {
      const response = await fetch(target, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ page: sent, revision: revision.current, repository }) });
      if (!response.ok) throw new Error(t(response.status === 409 ? messages.conflict : messages.save));
      const record: Snapshot<T> = await response.json();
      if (currentKey.current !== key) return;
      const latest = readDraft();
      const settled = settleDocumentDraft(client as WorkspaceDocumentClient<unknown>, { id: repository ?? '', alias }, sentDraft, record.revision);
      if (!settled) {
        if (latest) {
          current.current = latest.page;
          base.current = latest.base;
          revision.current = latest.revision;
          draftIdentity.current = latest.id;
          setPage(latest.page);
        }
        setError(t(messages.conflict));
        saved.current();
        return;
      }
      revision.current = record.revision;
      base.current = record.page;
      setSnapshot(record);
      // Another tab may have edited while this request was in flight.
      current.current = latest?.page || current.current;
      setPage(current.current);
      const pending = !same(current.current, sent);
      setDirty(pending);
      draftIdentity.current = latest?.id;
      saved.current();
    } catch (error) {
      if (currentKey.current === key) setError((error as Error).message);
    } finally {
      if (currentKey.current === key) setSaving(false);
    }
  }, [remote, saving, loading, error, snapshotKey, snapshot, dirty, key, readDraft, t, target, repository, alias, messages, client]);
  useEffect(() => {
    if (!enabled || loading || remote || !dirty || saving || error) return;
    const timer = setTimeout(() => void save(), 350);
    return () => clearTimeout(timer);
  }, [page, enabled, loading, remote, dirty, saving, error, save]);
  /* eslint-disable react/refs -- Document callbacks and the saved comparison baseline remain current without restarting loads. */
  const diff = dirty ? documentDiff(document.file, base.current, page) : '';
  /* eslint-enable react/refs */
  return { client: client as WorkspaceDocumentClient<unknown>, repository, file: document.file, page: snapshotKey === key ? page : document.empty(), change, save, reload: () => load(true), refresh: () => load(), loading: loading || snapshotKey !== key, saving, dirty: snapshotKey === key && dirty, error, writable: Boolean(enabled && repository && snapshotKey === key && !loading && !error && snapshot?.writable), setError, diff };
}
export type WorkspaceDocumentController<T> = ReturnType<typeof useWorkspaceDocument<T>>;
