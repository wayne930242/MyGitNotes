import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { chooseSelect } from './browser-select.mjs';

// Synthetic workspace only: no filesystem note writes or external requests.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const counts = { lists: [], saves: [] };
const notes = Array.from({ length: 174 }, (_, index) => ({
  id: `rule-${index}`, path: `notes/rules/rule-${index}.md`, notebookId: 'rules',
  title: `Rule ${String(index).padStart(3, '0')}`, content: `# Rule ${index}\n\n[Other notebook](../other/linked.md)`,
  metadata: { custom: 'keep', status: 'inbox' }, status: 'inbox', tags: [], mtime: 1700000000000,
}));
notes.push({ id: 'linked', path: 'notes/other/linked.md', notebookId: 'other', title: 'Linked note',
  content: '# Linked note', metadata: {}, tags: [] });
let delayNextRules = 0;
let holdNextRules = false;
const heldResponses = [];
const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const json = (body, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
  const body = async () => { let text = ''; for await (const chunk of req) text += chunk; return JSON.parse(text); };
  if (url.pathname === '/__qa/state') return json({ counts, notes, held: heldResponses.length });
  if (url.pathname === '/__qa/change' && req.method === 'POST') {
    const change = await body();
    if (change.title) notes[0] = { ...notes[0], title: change.title, content: `# ${change.title}`, metadata: { ...notes[0].metadata, title: change.title } };
    if (change.delay !== undefined) delayNextRules = change.delay;
    if (change.hold) holdNextRules = true;
    if (change.release) heldResponses.splice(0).forEach(release => release());
    return json({ ok: true });
  }
  const gitStatus = { branch: 'main', isClean: true, staged: [], modified: [], untracked: [] };
  if (url.pathname === '/api/workspace') return json({ repoRoot: '/fixture', branch: 'main', gitStatus,
    config: { schema_version: 1, workspace: { title: 'Navigation QA', default_notebook: 'rules' },
      notebooks: ['rules', 'other'].map(id => ({ id, title: id, root: `notes/${id}` })) },
    source: { type: 'local', identity: 'local:/fixture' }, capabilities: { local: true, write: true } });
  if (url.pathname === '/api/notes' && req.method === 'GET') {
    const notebookId = url.searchParams.get('notebookId'); counts.lists.push(notebookId || '*');
    const snapshot = structuredClone(notebookId ? notes.filter(note => note.notebookId === notebookId) : notes);
    if (notebookId === 'rules' && holdNextRules) {
      holdNextRules = false;
      heldResponses.push(() => json({ notes: snapshot }));
      return;
    }
    if (notebookId === 'rules' && delayNextRules) {
      const delay = delayNextRules; delayNextRules = 0;
      await new Promise(resolve => setTimeout(resolve, delay));
    }
    return json({ notes: snapshot });
  }
  if (url.pathname === '/api/notes' && req.method === 'POST') {
    const update = await body(); counts.saves.push(update);
    const index = notes.findIndex(note => note.path === update.path);
    if (index < 0) return json({ error: 'Missing fixture note' }, 404);
    notes[index] = { ...notes[index], content: update.content, metadata: update.metadata,
      status: update.metadata.status, title: update.metadata.title || notes[index].title };
    return json({ note: notes[index], success: true, committed: false });
  }
  if (url.pathname === '/api/git/status') return json({ status: gitStatus });
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
const base = `http://127.0.0.1:${server.address().port}`;
if (process.argv.includes('--serve')) {
  console.log(`Navigation fixture: ${base}/notebooks/rules?view=flat`);
} else {
  const require = createRequire(`${root}/apps/web/package.json`);
  const browser = await require('puppeteer-core').launch({
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || path.join(os.homedir(), '.cache/puppeteer/chrome/linux-131.0.6778.204/chrome-linux64/chrome'),
    headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  try {
    const page = await browser.newPage(); const errors = [];
    await page.evaluateOnNewDocument(() => localStorage.setItem('github-notes:language', 'en'));
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${base}/notebooks/rules?view=flat`, { waitUntil: 'networkidle0' });
    assert.equal(await page.$$eval('tbody tr', rows => rows.length), 174);
    await page.click('tbody tr');
    await page.waitForSelector('[aria-label="Note editor"]');
    await page.click('button[aria-label="Close note"]');
    await page.waitForSelector('[aria-label="Note editor"]', { hidden: true });
    await chooseSelect(page, 'button[aria-label="Status for Rule 000"]', 'done');
    await page.waitForNetworkIdle();
    assert.equal(notes[0].status, 'done');
    assert.equal(notes[0].metadata.custom, 'keep');
    assert.equal(counts.saves.length, 1);
    assert.equal(await page.$('[aria-label="Note editor"]'), null);
    await chooseSelect(page, 'button[aria-label="Notebook"]', 'other');
    await page.waitForNetworkIdle();
    notes[0] = { ...notes[0], title: 'External edit' };
    await chooseSelect(page, 'button[aria-label="Notebook"]', 'rules');
    await page.waitForFunction(() => document.body.textContent.includes('External edit'));
    await page.waitForNetworkIdle();
    assert.deepEqual(counts.lists, ['*', 'other', 'rules']);
    await chooseSelect(page, 'button[aria-label="Notebook"]', 'other');
    await page.waitForNetworkIdle();
    holdNextRules = true;
    const heldRead = page.waitForRequest(request => request.url().endsWith('/api/notes?notebookId=rules'));
    await chooseSelect(page, 'button[aria-label="Notebook"]', 'rules');
    await heldRead;
    await chooseSelect(page, 'button[aria-label="Notebook"]', 'other');
    await page.waitForFunction(() => document.querySelector('tbody')?.textContent.includes('Linked note'));
    notes[0] = { ...notes[0], title: 'Latest race winner' };
    await chooseSelect(page, 'button[aria-label="Notebook"]', 'rules');
    await page.waitForFunction(() => document.querySelector('tbody')?.textContent.includes('Latest race winner'));
    assert.equal(heldResponses.length, 1);
    heldResponses.splice(0).forEach(release => release());
    await page.waitForNetworkIdle();
    assert.equal(await page.$eval('tbody', body => body.textContent.includes('Latest race winner')), true);
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ result: 'passed', ...counts }));
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
}
