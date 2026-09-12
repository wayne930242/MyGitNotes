import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(`${root}/apps/web/package.json`);
const puppeteer = require('puppeteer-core');
const counts = { lists: 0, reads: 0 };
const local = process.env.RATE_QA_LOCAL === '1';
const revision = 'a'.repeat(40);
const notes = ['ex', 'other'].map(notebookId => ({ id: notebookId, path: `notes/${notebookId}/note.md`, notebookId,
  title: `Note ${notebookId}`, content: `# Note ${notebookId}`, metadata: {}, tags: [], size: 10, revision }));
const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const json = (body, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json', ...(status === 429 ? { 'Retry-After': '120' } : {}) }); res.end(JSON.stringify(body)); };
  if (url.pathname === '/api/workspace') return json({ repoRoot: '', branch: 'main', revision,
    config: { schema_version: 1, workspace: { title: 'Rate QA', default_notebook: 'ex' }, notebooks: ['ex', 'other'].map(id => ({ id, title: id, root: `notes/${id}` })) },
    gitStatus: { branch: 'main', isClean: true, staged: [], modified: [], untracked: [] },
    source: { type: local ? 'local' : 'github', identity: 'github:fixture/repo:main', repository: 'fixture/repo' }, capabilities: { local, write: true } });
  if (url.pathname === '/api/notes') { counts.lists++; return json({ notes }); }
  if (url.pathname === '/api/notes/read') { counts.reads++; return json({ error: 'GitHub fixture cooldown', retryAfter: 120 }, 429); }
  if (url.pathname === '/api/folders') return json({ folders: [] });
  if (url.pathname === '/api/assets') return json({ assets: [] });
  if (url.pathname === '/api/auth/session') return json({ authenticated: false });
  if (url.pathname.startsWith('/api/')) return json({});
  const requested = path.resolve(root, 'apps/web/dist', '.' + url.pathname);
  const file = requested.startsWith(`${root}/apps/web/dist/`) && fs.existsSync(requested) && fs.statSync(requested).isFile() ? requested : `${root}/apps/web/dist/index.html`;
  res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html');
  res.end(fs.readFileSync(file));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await puppeteer.launch({ executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || path.join(os.homedir(), '.cache/puppeteer/chrome/linux-131.0.6778.204/chrome-linux64/chrome'),
  headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
try {
  const page = await browser.newPage(); const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewport({ width: 1440, height: 1000 });
  await page.evaluateOnNewDocument(() => {
    const interval = window.setInterval.bind(window);
    window.setInterval = (callback, delay, ...args) => interval(callback, delay >= 30000 ? 20 : delay, ...args);
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/notebooks/ex/notes/note.md`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(text => document.body.textContent.includes(text), {}, local ? 'Note ex' : 'GitHub fixture cooldown');
  await new Promise(resolve => setTimeout(resolve, 250));
  assert.equal(counts.reads, local ? 0 : 1, 'Background checks must stop throughout Retry-After');
  await page.evaluate(() => { window.history.pushState({}, '', '/notebooks/other'); window.dispatchEvent(new PopStateEvent('popstate')); });
  await page.waitForFunction(() => document.body.textContent.includes('Note other'));
  if (local) await page.waitForFunction(() => !document.body.textContent.includes('Loading workspace'));
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(counts.lists, local ? 2 : 1, 'Only remote notebook switching should reuse the loaded note list');
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ result: 'passed', noteListRequests: counts.lists, remoteChecksDuringCooldown: counts.reads }));
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
