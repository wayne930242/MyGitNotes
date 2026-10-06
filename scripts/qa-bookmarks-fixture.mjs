import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createServer } from 'node:http';
import { createQaWorkspace, product } from './lib/qa-harness.mjs';
import { assertFreshBuild } from './lib/require-fresh-build.mjs';

// Browser-neutral, disposable two-repository fixture. Run only under MonitorCreate.
// No workspace argument, credentials, user files or server-config files are consumed.
assertFreshBuild(product);
const core = await import(`${product}/packages/core/dist/index.js`);
const { createApp } = await import(`${product}/apps/local-server/dist/app.js`);
const home = createQaWorkspace('mygitnotes-bookmarks-home-');
const other = createQaWorkspace('mygitnotes-bookmarks-other-');
let server;
try {
  const { SUPPORTED_SCHEMA_VERSION, WORKSPACE_CONFIG_FILENAME, BOOKMARKS_FILE, serializeWorkspaceDocument, captureTextAnchor, repositoryRef } = core;
  home.write(WORKSPACE_CONFIG_FILENAME, `schema_version: ${SUPPORTED_SCHEMA_VERSION}\nworkspace:\n  title: Outline QA\n  default_notebook: a\nnotebooks:\n  - id: a\n    title: Notebook A\n    root: notes/shared\n  - id: b\n    title: Notebook B\n    root: notes/shared\n    source: { type: github, repository: fixture/bookmarks-other }\n`);
  const body = '# Bookmark fixture\n\nUnique paragraph for exact-position bookmarks. 中文段落。\n\n## Second heading\n\nRepeated paragraph.\n\nContext between repeated blocks.\n\nRepeated paragraph.\n\n```md\n# Not a heading\n```\n';
  for (const workspace of [home, other]) {
    workspace.write('notes/shared/plan.outline.md', '---\ntitle: Research plan\n---\n\n- First\n  Annotation **one**\n  - Child\n- Read [guide](guide.md) and [compilation](reading.compilation.yml)\n  - Linked parent child\n- Last\n');
    workspace.write('notes/shared/second.outline.md', '---\ntitle: Second outline\n---\n\n- Independent item\n');
    workspace.write('notes/shared/guide.md', `---\ntitle: ${workspace === home ? 'Home' : 'Other'} guide\ntags: [qa]\n---\n${body}`);
    workspace.write('notes/shared/chapter/_dir.yml', 'title: Chapter\n');
    workspace.write('notes/shared/chapter/note.md', '# Chapter note\n\nA movable paragraph.\n');
    workspace.write('notes/shared/destination/_dir.yml', 'title: Destination\n');
    workspace.write('notes/shared/reading.compilation.yml', 'version: 1\nid: reading\ntitle: QA compilation\narrangement: lane\nitems:\n  - id: guide\n    kind: note\n    path: notes/shared/guide.md\n');
  }
  const targets = [{ kind: 'note', path: 'guide.md' }, { kind: 'folder', path: 'chapter' }, { kind: 'compilation', path: 'reading.compilation.yml' }, { kind: 'position', path: 'guide.md', anchor: captureTextAnchor(body, { from: 0, to: '# Bookmark fixture'.length }, 'heading') }, { kind: 'position', path: 'guide.md', anchor: captureTextAnchor(body, { from: body.indexOf('Unique'), to: body.indexOf('\n\n##') }, 'paragraph') }, { kind: 'url', url: 'https://example.org/?x=1&v=2&literal=&amp;#part&two' }, { kind: 'query', query: { q: '', kind: 'note', tags: ['qa'], folders: [], descendants: true, tagMode: 'any', status: null, showHidden: false, neighbors: false, view: 'list', sort: { field: 'title', order: 'asc' } } }];
  const legacyPage = owner => ({ version: 1, notebooks: [{ notebookId: owner, groups: [{ id: 'reading', label: 'Reading' }, { id: 'empty', label: 'Empty group' }], bookmarks: targets.map((target, index) => ({ id: `fixture-${index}`, label: `${index + 1}. ${target.kind}`, groupId: index < 3 ? 'reading' : null, target })) }, { notebookId: 'unknown-owner', groups: [], bookmarks: [{ id: 'retained-unknown', label: 'Unknown owner remains', groupId: null, target: { kind: 'note', path: 'lost.md' } }] }] });
  home.write(BOOKMARKS_FILE, serializeWorkspaceDocument(legacyPage('a')));
  other.write(BOOKMARKS_FILE, process.argv.includes('--malformed-source') ? 'version: [malformed\n# exact recovery source\n' : serializeWorkspaceDocument(legacyPage('b')));
  home.commitFixture();
  other.commitFixture();
  if (process.argv.includes('--read-only')) other.git('checkout', '-b', 'core');
  delete process.env.APP_URL;
  delete process.env.VERCEL;
  const configSource = { mode: 'local', settings: async () => ({ home: repositoryRef({ type: 'local', path: home.root }), localPath: ref => ref.id === 'github:fixture/bookmarks-other@main' ? other.root : undefined, manifest: inHome => inHome() }) };
  server = createServer(createApp(product, { configSource }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port, base = `http://127.0.0.1:${port}`;
  const workspace = await fetch(`${base}/api/workspace`).then(response => response.json());
  assert.equal(workspace.config.schema_version, SUPPORTED_SCHEMA_VERSION);
  assert.equal(workspace.repositories.length, 2);
  assert.equal(workspace.repositories[0].write, true);
  assert.equal(workspace.repositories[1].write, !process.argv.includes('--read-only'));
  const repository = workspace.repositories[0].id;
  const source = await fetch(`${base}/api/outline-import/source?${new URLSearchParams({ repository })}`).then(response => response.json());
  assert.equal(Buffer.from(source.base64, 'base64').toString(), fs.readFileSync(`${home.root}/${BOOKMARKS_FILE}`, 'utf8'));
  const otherSource = await fetch(`${base}/api/outline-import/source?${new URLSearchParams({ repository: workspace.repositories[1].id })}`).then(response => response.json());
  assert.equal(Buffer.from(otherSource.base64, 'base64').toString(), fs.readFileSync(`${other.root}/${BOOKMARKS_FILE}`, 'utf8'));
  assert.equal(Boolean(otherSource.error), process.argv.includes('--malformed-source'));
  assert.equal(otherSource.writable, !process.argv.includes('--read-only'));
  const response = await fetch(`${base}/api/outline-import/preview`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ repository, notebookId: 'a', selectedIds: targets.map((_, index) => `fixture-${index}`), path: 'notes/shared/imported.outline.md', title: 'Imported outline' }) });
  assert.equal(response.status, 200);
  const preview = await response.json();
  assert.equal(preview.partial, true);
  assert.deepEqual(preview.convertedIds, ['fixture-0', 'fixture-2', 'fixture-5']);
  assert(preview.retained.some(entry => entry.reason === 'other-owner'));
  assert(!fs.existsSync(`${home.root}/notes/shared/imported.outline.md`));
  assert.equal((await fetch(`${base}/api/bookmarks/resolve`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 410);
  for (const notebookId of ['a', 'b']) {
    const notes = await fetch(`${base}/api/notes/query?notebookId=${notebookId}&kind=outline`).then(response => response.json());
    assert.equal(notes.notes.length, 2);
  }
  assert.equal((await fetch(`${base}/notebooks/a`)).status, 200);
  console.log(JSON.stringify({ ready: true, pid: process.pid, port, root: home.root, otherRoot: other.root, base, route: `${base}/notebooks/a`, schema: SUPPORTED_SCHEMA_VERSION, repositories: workspace.repositories.map(repository => ({ id: repository.id, notebooks: repository.notebooks, write: repository.write })), recoverySeeds: workspace.repositories.map((repository, index) => ({ key: `github-notes:bookmarks-draft:${repository.id}`, raw: index ? '  { malformed legacy envelope\n' : JSON.stringify({ page: legacyPage('a'), base: { version: 1, notebooks: [] }, revision: 'original-draft-base', id: 'qa-draft', ancestors: ['qa-parent'], unknownField: 'preserve me' }, null, 2) + '\n' })), preflight: 'two same-root repositories; multiple native outlines; exact legacy export; partial preview/no write; retired resolver; built UI HTTP' }));
  if (!process.argv.includes('--smoke')) {
    await new Promise(resolve => {
      process.once('SIGTERM', resolve);
      process.once('SIGINT', resolve);
    });
  }
} finally {
  if (server) {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
  fs.rmSync(home.root, { recursive: true, force: true });
  fs.rmSync(other.root, { recursive: true, force: true });
  console.log(JSON.stringify({ stopped: true, pid: process.pid, removed: [home.root, other.root] }));
}
