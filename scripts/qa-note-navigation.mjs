import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { chooseSelect } from './browser-select.mjs';
import { resolveQaChromePath } from './qa-chrome.mjs';
import { assertFreshBuild } from './lib/require-fresh-build.mjs';

// The built local server runs against a temporary git workspace; no external requests.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
assertFreshBuild(root);
const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-note-navigation-'));
const write = (file, text) => {
  fs.mkdirSync(path.dirname(path.join(workspace, file)), { recursive: true });
  fs.writeFileSync(path.join(workspace, file), text);
};
const git = (...args) => execFileSync('git', args, { cwd: workspace, stdio: 'pipe' });
write('notes/.github-notes.yaml', `schema_version: 1\nworkspace:\n  title: Navigation QA\n  default_notebook: rules\nnotebooks:\n${['rules', 'other', 'archive'].map(id => `  - id: ${id}\n    title: ${id}\n    root: notes/${id}\n`).join('')}`);
for (let index = 0; index < 174; index++) write(`notes/rules/rule-${index}.md`, `---\ntitle: Rule ${String(index).padStart(3, '0')}\nstatus: inbox\ncustom: keep\n---\n# Rule ${index}\n\n[Other notebook](../other/linked.md)\n`);
write('notes/other/linked.md', '# Linked note\n');
write('notes/archive/old.md', '# Archived plan\n');
git('init', '-b', 'main');
git('config', 'user.name', 'Navigation QA');
git('config', 'user.email', 'qa@example.com');
git('add', '.');
git('commit', '-m', 'fixture');
process.env.MYGITNOTES_SOURCE = 'local';
process.env.MYGITNOTES_LOCAL_PATH = workspace;
delete process.env.VERCEL;
delete process.env.APP_URL;
const { createApp } = await import(`${root}/apps/local-server/dist/app.js`);
const app = createApp(root);

// Note query requests pass through here so a response can be held back to replay a slow read.
const queries = [];
let holdNotebook = null;
const held = [];
const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/api/notes/query') {
    const notebookId = url.searchParams.get('notebookId');
    queries.push(notebookId);
    if (notebookId === holdNotebook) {
      holdNotebook = null;
      held.push(() => app(req, res));
      return;
    }
  }
  app(req, res);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
if (process.argv.includes('--serve')) {
  console.log(`Navigation fixture: ${base}/notebooks/rules?view=flat`);
} else {
  const require = createRequire(`${root}/apps/web/package.json`);
  const browser = await require('puppeteer-core').launch({ executablePath: resolveQaChromePath(), headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  try {
    const page = await browser.newPage();
    const errors = [];
    await page.evaluateOnNewDocument(() => localStorage.setItem('github-notes:language', 'en'));
    page.on('pageerror', error => errors.push(error.message));
    const rows = () => page.$$eval('tbody tr', items => items.length);
    const listShows = text => page.waitForFunction(value => document.querySelector('tbody')?.textContent.includes(value), {}, text);
    await page.goto(`${base}/notebooks/rules?view=flat`, { waitUntil: 'networkidle0' });

    // The list arrives one page at a time as the reader scrolls.
    assert.equal(await rows(), 50);
    for (let attempt = 0; attempt < 10 && await rows() < 174; attempt++) {
      await page.$eval('tbody tr:last-child', row => row.scrollIntoView());
      await page.waitForNetworkIdle({ idleTime: 200 });
    }
    assert.equal(await rows(), 174);
    assert.deepEqual(queries, ['rules', 'rules', 'rules', 'rules']);

    await page.click('tbody tr td:first-child');
    await page.waitForSelector('[aria-label="Note editor"]');
    await page.click('button[aria-label="Close note"]');
    await page.waitForSelector('[aria-label="Note editor"]', { hidden: true });

    // A status chosen in the list is saved without opening the editor and keeps other frontmatter.
    const title = await page.$eval('tbody tr', row => row.querySelector('[aria-label^="Status for "]').getAttribute('aria-label').slice('Status for '.length));
    const file = path.join(workspace, 'notes/rules', `rule-${Number(title.slice('Rule '.length))}.md`);
    await chooseSelect(page, `button[aria-label="Status for ${title}"]`, 'done');
    await page.waitForNetworkIdle();
    assert.match(fs.readFileSync(file, 'utf8'), /status: done/);
    assert.match(fs.readFileSync(file, 'utf8'), /custom: keep/);
    assert.equal(await page.$('[aria-label="Note editor"]'), null);

    // Returning to a notebook shows its cached answer instead of reading it again.
    await chooseSelect(page, 'button[aria-label="Notebooks"]', 'other');
    await listShows('Linked note');
    await chooseSelect(page, 'button[aria-label="Notebooks"]', 'rules');
    await listShows('Rule ');
    await chooseSelect(page, 'button[aria-label="Notebooks"]', 'other');
    await listShows('Linked note');
    await page.waitForNetworkIdle();
    assert.equal(queries.filter(notebook => notebook === 'other').length, 1);

    // A slow answer for a notebook the reader already left does not replace the current list.
    holdNotebook = 'archive';
    const heldRead = page.waitForRequest(request => request.url().includes('/api/notes/query?notebookId=archive'));
    await chooseSelect(page, 'button[aria-label="Notebooks"]', 'archive');
    await heldRead;
    await chooseSelect(page, 'button[aria-label="Notebooks"]', 'rules');
    await listShows('Rule ');
    assert.equal(held.length, 1);
    held.splice(0).forEach(release => release());
    await page.waitForNetworkIdle();
    assert.equal(await page.$eval('tbody', body => body.textContent.includes('Archived plan')), false);
    assert.equal(await page.$eval('tbody', body => body.textContent.includes('Rule ')), true);
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ result: 'passed', queries }));
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}
