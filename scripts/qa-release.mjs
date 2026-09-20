import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { resolveQaChromePath } from './qa-chrome.mjs';
import { assertFreshBuild } from './lib/require-fresh-build.mjs';
const product = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(product + '/apps/web/package.json');
const puppeteer = require('puppeteer-core');
let base = process.argv[2];
let root, server;
if (!base) {
  // No deployed URL given: smoke-test a local server over the committed demo workspace instead.
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'github-notes-release-'));
  fs.cpSync(path.join(product, 'examples/demo-workspace'), root, { recursive: true });
  for (const args of [['init', '-b', 'main'], ['config', 'user.name', 'Browser QA'], ['config', 'user.email', 'qa@example.com'], ['add', '.'], ['commit', '-m', 'fixture']]) execFileSync('git', args, { cwd: root, stdio: 'pipe' });
  process.env.MYGITNOTES_SOURCE = 'local';
  process.env.MYGITNOTES_LOCAL_PATH = root;
  delete process.env.VERCEL;
  delete process.env.APP_URL;
  assertFreshBuild(product);
  const { createApp } = await import(`${product}/apps/local-server/dist/app.js`);
  server = createServer(createApp(product));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
}
const browser = await puppeteer.launch({ executablePath: resolveQaChromePath(), headless: true, pipe: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage();
const errors = [];
const statuses = {};
let workspace;
let noteCount;
page.on('pageerror', e => errors.push(e.message));
page.on('response', async response => {
  const path = new URL(response.url()).pathname;
  if (path.startsWith('/api/')) statuses[path] = response.status();
  try {
    if (path === '/api/workspace') workspace = await response.json();
    if (path === '/api/notes') noteCount = (await response.json()).notes?.length;
  } catch {}
});
try {
  await page.setViewport({ width: 1440, height: 1000 });
  await page.goto(base, { waitUntil: 'networkidle0', timeout: 60000 });
  await page.waitForSelector('[aria-label="Show hidden notes"]', { timeout: 30000 });
  assert(workspace?.config);
  assert.equal(workspace.branch, 'main');
  console.log(JSON.stringify({ workspace: workspace.source.type, branch: workspace.branch, noteCount, endpoints: statuses }));
  const listResult = await page.evaluate(async () => {
    const r = await fetch('/api/notes');
    return { status: r.status, body: await r.json() };
  });
  assert.equal(listResult.status, 200, JSON.stringify(listResult.body));
  const list = listResult.body;
  for (const note of list.notes) {
    const result = await page.evaluate(async file => {
      const response = await fetch('/api/notes/read?path=' + encodeURIComponent(file));
      return { status: response.status, data: await response.json() };
    }, note.path);
    assert.equal(result.status, 200, `Configured note read failed: ${note.path}`);
    assert.equal(result.data.note.path, note.path);
  }
  const first = list.notes.find(note => note.path.endsWith('/welcome.md')) || list.notes[0];
  assert(first, 'Release workspace must contain an example note');
  const notebook = workspace.config.notebooks.find(nb => nb.id === first.notebookId);
  const route = '/notebooks/' + encodeURIComponent(notebook.id) + '/notes/' + first.path.slice(notebook.root.length + 1).split('/').map(encodeURIComponent).join('/');
  await page.goto(base + route, { waitUntil: 'networkidle0' });
  await page.waitForSelector('[aria-label="Close note"]');
  assert(!await page.evaluate(() => document.body.innerText.includes('Path is not a configured note.')));
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForSelector('[aria-label="Close note"]');
  await page.click('[aria-label="Close note"]');
  console.log('PASS every configured note read, direct note route and editor reload');
  await page.click('[title="Kanban View"]');
  await page.waitForSelector('[data-status-column="working"]');
  assert(await page.$('[data-status-column="archived"]'));
  console.log('PASS deployed status defaults and hidden-notes sidebar');
  await page.click('[aria-label="Settings"]');
  await page.waitForSelector('input[aria-label="MCP client name"]');
  assert(await page.evaluate(() => document.body.innerText.includes('Until revoked') || document.body.innerText.includes('until you revoke')));
  assert(await page.evaluate(() => document.body.innerText.includes('statuses: [inbox, working, done, archived]')));
  await page.setViewport({ width: 320, height: 700, isMobile: true, hasTouch: true });
  await page.waitForSelector('input[aria-label="MCP client name"]');
  await page.waitForFunction(() => document.querySelector('nav').getBoundingClientRect().width <= 320);
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  assert.equal(await page.$$eval('nav button:not(.mobile-nav-create)', buttons => buttons.length), 4);
  const screenshot = product + '/artifacts/qa/' + (workspace.capabilities.local ? 'local' : 'production') + '-status-settings.png';
  fs.mkdirSync(path.dirname(screenshot), { recursive: true });
  await page.screenshot({ path: screenshot, fullPage: true });
  console.log('PASS mobile Settings, persistent grant information and four-way navigation');
  if (!workspace.capabilities.local) {
    const oauth = await fetch(base + '/api/auth/github', { redirect: 'manual', signal: AbortSignal.timeout(20000) });
    assert.equal(oauth.status, 302);
    const location = new URL(oauth.headers.get('location'));
    assert.equal(location.hostname, 'github.com');
    assert.equal(location.searchParams.get('redirect_uri'), base + '/api/auth/github/callback');
    const mcp = await fetch(base + '/mcp/' + 'x'.repeat(43), { method: 'POST', headers: { 'content-type': 'application/json', 'accept': 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'release-smoke', version: '1.0' } } }), signal: AbortSignal.timeout(20000) });
    assert.equal(mcp.status, 401);
    assert.match(mcp.headers.get('www-authenticate'), /Bearer/);
    console.log('PASS production OAuth redirect and credential-bearing MCP route rejects invalid grants (401)');
  }
  assert.deepEqual(errors, []);
  console.log('PASS no browser runtime errors');
} catch (error) {
  console.log(await page.evaluate(() => ({ url: location.href, text: document.body.innerText.slice(0, 1500) })));
  throw error;
} finally {
  await browser.close();
  server?.close();
  if (root) fs.rmSync(root, { recursive: true, force: true });
}
