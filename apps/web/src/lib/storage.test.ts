// @vitest-environment jsdom
import { beforeEach, expect, it } from 'vitest';
import { adoptGraphDrafts, getLocalDraft, saveLocalDraft } from './storage.js';

beforeEach(() => localStorage.clear());

const record = (path: string, content: string) => JSON.stringify({ base: { path }, draft: { path, content, metadata: { title: 'Alpha' } } });

it('moves graph drafts into the editor drafts of the same scope and drops the old records', () => {
  localStorage.setItem('graph-draft:src:main:notes/a.md', record('notes/a.md', 'edited'));
  localStorage.setItem('graph-draft:src:main:notes/moved.md', record('notes/other.md', 'stale'));
  localStorage.setItem('graph-draft:src:dev:notes/a.md', record('notes/a.md', 'other scope'));
  adoptGraphDrafts('src:main');
  expect(getLocalDraft('src:main', 'notes/a.md')).toMatchObject({ path: 'notes/a.md', content: 'edited', metadata: { title: 'Alpha' } });
  expect(getLocalDraft('src:main', 'notes/moved.md')).toBeNull();
  expect(localStorage.getItem('graph-draft:src:main:notes/a.md')).toBeNull();
  expect(localStorage.getItem('graph-draft:src:main:notes/moved.md')).toBeNull();
  expect(localStorage.getItem('graph-draft:src:dev:notes/a.md')).not.toBeNull();
});

it('keeps an editor draft that already exists', () => {
  saveLocalDraft('src:main', 'notes/a.md', 'editor draft', {});
  localStorage.setItem('graph-draft:src:main:notes/a.md', record('notes/a.md', 'graph draft'));
  adoptGraphDrafts('src:main');
  expect(getLocalDraft('src:main', 'notes/a.md')?.content).toBe('editor draft');
  expect(localStorage.getItem('graph-draft:src:main:notes/a.md')).toBeNull();
});
