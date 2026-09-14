import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';

const product = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(`${product}/apps/web/package.json`);
const puppeteer = require('puppeteer-core');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'github-notes-diff-qa-'));
const config = {
  schema_version: 1,
  workspace: { title: 'Diff QA', default_notebook: 'example' },
  notebooks: [{ id: 'example', title: 'Example', root: 'notes/example' }],
};
fs.mkdirSync(path.join(root, 'notes/example'), { recursive: true });
fs.writeFileSync(path.join(root, '.github-notes.yaml'), JSON.stringify(config));
fs.writeFileSync(path.join(root, 'notes/example/fixture.md'), '# Fixture\n');
const git = (...args) => execFileSync('git', args, { cwd: root, stdio: 'pipe' });
git('init', '-b', 'main');
git('config', 'user.name', 'Browser QA');
git('config', 'user.email', 'qa@example.com');
git('add', '.');
git('commit', '-m', 'fixture');
process.env.MYGITNOTES_SOURCE = 'local';
process.env.MYGITNOTES_LOCAL_PATH = root;
delete process.env.VERCEL;
delete process.env.APP_URL;

const identity = 'github:diff/fixture@main';
const lines = Array.from({ length: 500 }, (_, i) => `Line ${i + 1}`);
const baseNote = {
  id: 'fixture', path: 'notes/example/fixture.md', notebookId: 'example', title: 'Fixture',
  content: lines.join('\n') + '\n', metadata: { custom: 'keep' }, tags: [], revision: 'one',
};
lines[249] = 'Updated line 250';
const draftNote = { ...baseNote, content: lines.join('\n') + '\n' };
const baseScreen = { version: 1, rows: Array.from({ length: 8 }, (_, i) => ({
  id: `lane-${i}`, name: `Lane ${i}`, kind: 'custom', view: 'small', items: [],
})) };
const draftScreen = structuredClone(baseScreen);
draftScreen.rows[3].name = 'Renamed lane';
const status = { branch: 'main', isClean: true, staged: [], modified: [], untracked: [] };
const { createApp } = await import(`${product}/apps/local-server/dist/app.js`);
const server = createServer(createApp(product));
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await puppeteer.launch({
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || path.join(os.homedir(), '.cache/puppeteer/chrome/linux-131.0.6778.204/chrome-linux64/chrome'),
    headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000 });
  const errors = [], writes = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.evaluateOnNewDocument(({ identity, baseNote, draftNote, baseScreen, draftScreen }) => {
    localStorage.setItem('github-notes:language', 'en');
    localStorage.setItem(`gh_notes_working:${identity}:main`, JSON.stringify({ [baseNote.path]: { base: baseNote, note: draftNote } }));
    localStorage.setItem(`github-notes:screen-draft:${identity}`, JSON.stringify({ base: baseScreen, page: draftScreen, revision: 'one' }));
  }, { identity, baseNote, draftNote, baseScreen, draftScreen });
  await page.setRequestInterception(true);
  page.on('request', request => {
    const url = new URL(request.url());
    if (!url.pathname.startsWith('/api/')) return void request.continue();
    if (request.method() !== 'GET') writes.push(`${request.method()} ${url.pathname}`);
    const responses = {
      '/api/workspace': { config, branch: 'main', repoRoot: '', gitStatus: status, source: { type: 'github', identity }, capabilities: { write: true, local: false }, revision: 'one' },
      '/api/notes': { notes: [baseNote] },
      '/api/notes/read': { note: baseNote },
      '/api/folders': { folders: [] },
      '/api/assets': { assets: [] },
      '/api/git/status': { status, commits: [] },
      '/api/auth/session': { authenticated: true, login: 'fixture', configured: true },
      '/api/screen-page': { page: baseScreen, revision: 'one', writable: true, path: '.github-notes-screen.yaml' },
    };
    const body = responses[url.pathname];
    void request.respond({ status: body ? 200 : 404, contentType: 'application/json', body: JSON.stringify(body || { error: 'Unknown fixture endpoint' }) });
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/notebooks/example`, { waitUntil: 'networkidle0' });
  await page.click('.workspace-commit-bar .ui-button-primary');
  await page.waitForSelector('.changes-dialog');
  const preview = async file => {
    await page.click(`.changes-file[title="${file}"]`);
    await page.waitForFunction(file => document.querySelector('.changes-preview pre')?.textContent.startsWith(`--- ${file}\n`), {}, file);
    return page.$eval('.changes-preview pre', element => element.textContent);
  };
  const noteDiff = await preview(baseNote.path);
  assert(noteDiff.includes('-Line 250\n+Updated line 250\n'));
  assert(noteDiff.includes(' Line 247\n') && noteDiff.includes(' Line 253\n'));
  assert(!noteDiff.includes('Line 246\n') && !noteDiff.includes('Line 254\n'));
  assert(noteDiff.includes('@@ -250,7 +250,7 @@'));
  assert.equal(await page.$$eval('.changes-preview .diff-added', nodes => nodes.filter(node => !node.textContent.startsWith('+++')).length), 1);
  assert.equal(await page.$$eval('.changes-preview .diff-removed', nodes => nodes.filter(node => !node.textContent.startsWith('---')).length), 1);
  console.log('PASS rendered note preview: one changed line in 500 lines, three context lines, correct hunk and colors');

  const screenDiff = await preview('.github-notes-screen.yaml');
  assert(screenDiff.includes('-    name: Lane 3\n+    name: Renamed lane\n'));
  assert(!screenDiff.includes('name: Lane 0') && !screenDiff.includes('name: Lane 7'));
  assert.equal(screenDiff.split('\n').filter(line => line.startsWith('@@')).length, 1);
  const drafts = await page.evaluate(identity => ({
    note: JSON.parse(localStorage.getItem(`gh_notes_working:${identity}:main`)),
    screen: JSON.parse(localStorage.getItem(`github-notes:screen-draft:${identity}`)),
  }), identity);
  assert.deepEqual(drafts.note[baseNote.path], { base: baseNote, note: draftNote });
  assert.deepEqual(drafts.screen, { base: baseScreen, page: draftScreen, revision: 'one' });
  assert.deepEqual(writes, []);
  assert.deepEqual(errors, []);
  console.log('PASS rendered screen preview: one renamed lane, compact context, drafts preserved, no save requests or browser errors');
} finally {
  if (browser) await browser.close();
  await new Promise(resolve => server.close(resolve));
  fs.rmSync(root, { recursive: true, force: true });
}
