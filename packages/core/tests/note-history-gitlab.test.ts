import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import { openRemoteRepository } from '../src/remote-factory.js';
import { gitlabFixture } from './fixtures/gitlab.js';

const sha = (text: string) => createHash('sha1').update(text).digest('hex');
const old = 'c'.repeat(40);
const oldText = '# Alpha (first draft)\n';

/** The GitLab fixture plus the history endpoints: one earlier commit that held an older `notes/ex/a.md`. */
function historyFixture() {
  const f = gitlabFixture();
  const prefix = 'https://gitlab.example.test/gitlab/api/v4/projects/group%2Fsubgroup%2Fproject';
  const calls: string[] = [];
  const request = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const endpoint = String(input).slice(prefix.length);
    const json = (body: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json', ...headers } });
    if (endpoint.startsWith('/repository/commits?')) {
      calls.push(endpoint);
      const page = Number(url.searchParams.get('page'));
      const all = [{ id: f.head, parent_ids: [old], authored_date: '2026-10-07T02:00:00+08:00', author_name: 'Tester', message: 'docs(notes): edit a.md (Agent, 2026-10-07)\n\nAgent-Edit: 2026-10-07\n' }, { id: old, parent_ids: [], authored_date: '2026-10-07T01:00:00+08:00', author_name: 'Tester', message: 'Start\n' }];
      return json(all.slice(page - 1, page), { 'x-next-page': page < all.length ? String(page + 1) : '' });
    }
    if (endpoint === `/repository/commits/${old}`) return json({ id: old, authored_date: '2026-10-07T01:00:00+08:00' });
    if (endpoint.startsWith(`/repository/commits/${old}/diff`)) return json([{ new_path: 'notes/ex/a.md' }, { new_path: 'notes/ex/gone.md', deleted_file: true }]);
    if (endpoint.startsWith('/repository/commits/') && !init?.method) return new Response('{}', { status: 404 });
    if (endpoint.startsWith('/repository/files/') && url.searchParams.get('ref') === old) {
      const file = decodeURIComponent(endpoint.slice('/repository/files/'.length).split('?')[0]);
      return file === 'notes/ex/a.md' ? json({ blob_id: sha(oldText), size: oldText.length }) : new Response('{}', { status: 404 });
    }
    if (endpoint.startsWith(`/repository/blobs/${sha(oldText)}`)) return json({ encoding: 'base64', content: Buffer.from(oldText).toString('base64'), size: oldText.length });
    return f.request(input, init);
  }) as typeof fetch;
  return { f, calls, reader: () => openRemoteRepository({ type: 'gitlab', url: 'https://gitlab.example.test/gitlab', repository: 'group/subgroup/project', branch: 'main' }, 'token', request).reader };
}

it('reads a note’s GitLab history from the snapshot head, page by page, and the note as an older commit held it', async () => {
  const { f, calls, reader } = historyFixture();
  const first = await reader().fileHistory('notes/ex/a.md', 1, 1);
  expect(first.more).toBe(true);
  expect(first.entries).toEqual([{ commit: f.head, parents: [old], date: '2026-10-07T02:00:00+08:00', author: 'Tester', subject: 'docs(notes): edit a.md (Agent, 2026-10-07)', body: 'Agent-Edit: 2026-10-07', path: 'notes/ex/a.md', agent: true }]);
  const second = await reader().fileHistory('notes/ex/a.md', 2, 1);
  expect(second).toMatchObject({ more: false, entries: [{ commit: old, parents: [], agent: false, body: '' }] });
  expect(calls[0]).toContain(`ref_name=${f.head}`);
  expect(await reader().readFileAt(old, 'notes/ex/a.md')).toEqual({ blob: sha(oldText), content: oldText });
  expect(await reader().readFileAt(old, 'notes/ex/missing.md')).toBeUndefined();
  expect(await reader().commitDetails(old)).toEqual({ date: '2026-10-07T01:00:00+08:00', paths: ['notes/ex/a.md'] });
  expect(await reader().commitDetails('d'.repeat(40))).toBeNull();
  await expect(reader().readFileAt('not-a-commit', 'notes/ex/a.md')).rejects.toThrow('Invalid commit');
});
