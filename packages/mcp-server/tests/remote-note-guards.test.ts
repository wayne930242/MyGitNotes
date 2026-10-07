import { expect, it } from 'vitest';
import { openRemoteHome, parseNoteContent, versionFilePath } from '@mygitnotes/core';
import { callRemoteTool } from '../src/remote-tools.js';
import { gitlabFixture } from '../../core/tests/fixtures/gitlab.js';

const reader = (f: ReturnType<typeof gitlabFixture>) => openRemoteHome({ type: 'gitlab', url: 'https://gitlab.example.test/gitlab', repository: 'group/subgroup/project', branch: 'main' }, 'fixture-token', f.request).reader;

it('keeps an existing note’s frontmatter when save_note leaves metadata out or names only some keys', async () => {
  const f = gitlabFixture();
  await callRemoteTool(reader(f), 'save_note', { path: 'notes/ex/a.md', content: '# Alpha\nnew body\n', revision: f.head }, true);
  expect(parseNoteContent(f.files.get('notes/ex/a.md')!)).toMatchObject({ metadata: { custom: 'preserved', tags: ['work'] }, content: expect.stringContaining('new body') });

  await callRemoteTool(reader(f), 'save_note', { path: 'notes/ex/a.md', content: '# Alpha\nnew body\n', metadata: { status: 'done' }, revision: f.head }, true);
  expect(parseNoteContent(f.files.get('notes/ex/a.md')!).metadata).toMatchObject({ custom: 'preserved', tags: ['work'], status: 'done' });

  await callRemoteTool(reader(f), 'save_note', { path: 'notes/ex/folder/b.md', content: '# Beta\nmore\n', revision: f.head }, true);
  expect(f.files.get('notes/ex/folder/b.md')).toBe('# Beta\nmore\n');
});

it('refuses delete_note on a version file, which only goes with its note', async () => {
  const file = versionFilePath('notes/ex/a.md');
  const f = gitlabFixture(undefined, { [file]: 'versions: []\n' });
  await expect(callRemoteTool(reader(f), 'delete_note', { path: file, revision: f.head }, true)).rejects.toMatchObject({ status: 403 });
  expect(f.files.get(file)).toBe('versions: []\n');

  await callRemoteTool(reader(f), 'delete_note', { path: 'notes/ex/a.md', revision: f.head }, true);
  expect(f.files.has('notes/ex/a.md')).toBe(false);
  expect(f.files.has(file)).toBe(false);
});
