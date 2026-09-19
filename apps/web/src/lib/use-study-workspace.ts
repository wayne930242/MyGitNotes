import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { emptyStudyWorkspace, type StudyWorkspace, StudyWorkspaceSchema } from '@mygitnotes/core/study';
import type { NoteListItem } from '@mygitnotes/core/note-query';
import type { NoteItem } from './types.js';
import { useTranslation } from './i18n/index.js';
import { noteLookupOptions, useNoteQueryScope } from './use-note-queries.js';

interface Snapshot {
  study: StudyWorkspace;
  revision: string;
  writable: boolean;
  commit?: string;
}
const same = (a: StudyWorkspace, b: StudyWorkspace) => JSON.stringify(a) === JSON.stringify(b);
export function useStudyWorkspace(onSaved: (note?: NoteItem) => void) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const scope = useNoteQueryScope();
  const [study, setStudy] = useState(emptyStudyWorkspace), [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false), [error, setError] = useState(''), [writable, setWritable] = useState(false);
  const snapshot = useRef<Snapshot>(), busy = useRef(false), alive = useRef(true);
  const saved = useRef(onSaved);
  saved.current = onSaved;
  const read = useCallback(async (): Promise<Snapshot> => {
    const response = await fetch('/api/study');
    if (!response.ok) throw new Error(t('study.loadError'));
    const value = await response.json();
    return { ...value, study: StudyWorkspaceSchema.parse(value.study) };
  }, [t]);
  const reload = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    setLoading(true);
    try {
      const value = await read();
      if (alive.current) {
        snapshot.current = value;
        setStudy(value.study);
        setWritable(value.writable);
        setError('');
      }
    } catch (error) {
      if (alive.current) setError((error as Error).message);
    } finally {
      busy.current = false;
      if (alive.current) setLoading(false);
    }
  }, [read]);
  useEffect(() => {
    alive.current = true;
    void reload();
    return () => {
      alive.current = false;
    };
  }, [reload]);
  const save = async (change: (current: StudyWorkspace) => StudyWorkspace): Promise<boolean> => {
    if (busy.current || !snapshot.current?.writable) return false;
    busy.current = true;
    setSaving(true);
    setError('');
    try {
      const base = snapshot.current;
      const next = StudyWorkspaceSchema.parse(change(base.study));
      // A GitHub commit to another file can advance HEAD without changing study data.
      const latest = await read();
      if (!same(latest.study, base.study)) throw new Error(t('study.conflict'));
      const response = await fetch('/api/study', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ study: next, revision: latest.revision }) });
      if (!response.ok) throw new Error(t(response.status === 409 ? 'study.conflict' : 'study.saveError'));
      const result = await response.json();
      result.study = StudyWorkspaceSchema.parse(result.study);
      if (alive.current) {
        snapshot.current = result;
        setStudy(result.study);
        setWritable(result.writable);
        saved.current();
      }
      return true;
    } catch (error) {
      if (alive.current) setError((error as Error).message);
      return false;
    } finally {
      busy.current = false;
      if (alive.current) setSaving(false);
    }
  };
  const action = async (note: Pick<NoteListItem, 'path' | 'notebookId'>, laneId: string, action: 'stage-review' | 'stage-read' | 'stage-postpone' | 'undo', options: { rating?: 1 | 2 | 3 | 4; due?: string; eventId?: string; } = {}): Promise<boolean> => {
    if (busy.current || !snapshot.current?.writable) return false;
    busy.current = true;
    setSaving(true);
    setError('');
    try {
      // A study card carries no body; the note the review applies to is read in full first.
      const expected = (await queryClient.fetchQuery(noteLookupOptions(scope, [note.path], true))).notes.find(item => item.path === note.path);
      if (!expected || typeof expected.content !== 'string') throw new Error(t('notes.readFailed', { path: note.path }));
      const base = snapshot.current, latest = await read();
      if (!same(latest.study, base.study)) throw new Error(t('study.conflict'));
      const response = await fetch('/api/study/action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ laneId, notebookId: note.notebookId, path: note.path, expected: { content: expected.content, metadata: expected.metadata }, revision: latest.revision, action, ...options }) });
      if (!response.ok) throw new Error(t(response.status === 409 ? 'study.conflict' : response.status === 422 ? 'study.configureLane' : 'study.saveError'));
      const result = await response.json();
      result.study = StudyWorkspaceSchema.parse(result.study);
      if (alive.current) {
        snapshot.current = result;
        setStudy(result.study);
        setWritable(result.writable);
        saved.current(result.note);
      }
      return true;
    } catch (error) {
      if (alive.current) setError((error as Error).message);
      return false;
    } finally {
      busy.current = false;
      if (alive.current) setSaving(false);
    }
  };
  return {
    study,
    save,
    action,
    reload: async () => {
      await reload();
      saved.current();
    },
    loading,
    saving,
    error,
    writable,
  };
}
export type StudyController = ReturnType<typeof useStudyWorkspace>;
