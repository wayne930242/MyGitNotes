import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { chooseSelect } from './browser-select.mjs';

const product = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(`${product}/apps/web/package.json`);
const puppeteer = require('puppeteer-core');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'github-notes-index-'));
const write = (file, content) => {
  fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  fs.writeFileSync(path.join(root, file), content);
};
const git = (...args) => execFileSync('git', args, { cwd: root, stdio: 'pipe' });
write('notes/.github-notes.yaml', 'schema_version: 1\nworkspace:\n  title: Folder Index QA\n  default_notebook: example\nnotebooks:\n  - id: example\n    title: Example\n    root: notes/example\n  - id: other\n    title: Other\n    root: notes/other\n');
write('notes/example/index.md', '---\ntitle: Notebook introduction\ncustom: preserve\n---\n# 根目錄介紹\n\n這是 **索引內容**。\n\n[進入資料夾](projects/)\n\n[開啟筆記](regular.md)\n\n<img src="bad" onerror="window.indexUnsafe=true">\n<script>window.indexUnsafe=true</script>\n');
write('notes/example/regular.md', '# Regular Note\n');
write('notes/example/README.md', '# Secondary README\n');
write('notes/example/readme/deep/README.md', '# README guide\n');
write('notes/example/projects/index.md', '# 專案介紹\n\n[深入閱讀](deep/index.md)\n\n[同頁段落](#細節)\n\n## 細節\n\n專案內容。\n');
write('notes/example/projects/deep/index.md', '# 深層介紹\n');
write('notes/example/empty/note.md', '# No Index\n');
write('notes/example/hidden/index.md', '---\nhiden: true\n---\n# 隱藏介紹\n');
write('notes/example/hidden/README.md', '# Visible fallback\n');
write('notes/example/blank/index.md', '');
write('notes/other/README.md', '# 其他筆記本\n');
git('init', '-b', 'main'); git('config', 'user.name', 'Browser QA'); git('config', 'user.email', 'qa@example.com');
git('add', '.'); git('commit', '-m', 'fixture');
process.env.GITHUB_NOTES_SOURCE = 'local'; process.env.GITHUB_NOTES_LOCAL_PATH = root;
delete process.env.VERCEL; delete process.env.APP_URL;
const { createApp } = await import(`${product}/apps/local-server/dist/app.js`);
const server = createServer(createApp(product));
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await puppeteer.launch({ executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || path.join(os.homedir(), '.cache/puppeteer/chrome/linux-131.0.6778.204/chrome-linux64/chrome'), headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage();
const errors = []; page.on('pageerror', error => errors.push(error.message));
const visit = route => page.goto(base + route, { waitUntil: 'networkidle0' });
const openIndex = async (relativePath = 'index.md') => {
  await page.click('button[data-folder-index]');
  await page.waitForSelector('[aria-label="Close note"]');
  assert(new URL(page.url()).pathname.endsWith(`/notes/${relativePath}`), 'Index must use the regular note route');
};
const closeIndex = () => page.click('[aria-label="Close note"]');
try {
  await page.setViewport({ width: 1440, height: 1000 });
  await visit('/notebooks/example');
  assert(await page.$('.desktop-views > button:first-child[aria-label="Expand"][aria-pressed="true"]'), 'Expand must be the default and first view');
  const indexSelector = view => ['flat', 'kanban'].includes(view)
    ? '.workspace-page-actions > button[data-folder-index]'
    : '.folder-links > button[data-folder-index]:first-child';
  fs.mkdirSync(`${product}/artifacts/qa`, { recursive: true });
  await page.evaluate(() => localStorage.setItem('github-notes:language', 'zh-TW'));
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewport({ width, height: 900 });
    for (const view of ['flat', 'kanban']) {
      await visit(`/notebooks/example?view=${view}`);
      assert(!await page.$('.workspace-breadcrumbs, .folder-links'), `Folder selectors remain in ${view}`);
      assert(await page.$(indexSelector(view)), `Toolbar index missing in ${view}`);
      assert(await page.evaluate(() => document.querySelector('.workspace-scroll').textContent.includes('No Index')), 'Descendant notes must remain visible');
      assert(!await page.$('[data-notepath="notes/example/index.md"], [aria-label="Status for Notebook introduction"]'), 'Toolbar index must not duplicate the current index in results');
      const layout = await page.evaluate(() => {
        const box = selector => {
          const { x, y, width, height } = document.querySelector(selector).getBoundingClientRect();
          return { x, y, width, height };
        };
        return { index: box('[data-folder-index]'), actions: box('.header-note-actions'), newNote: box('.header-new-note'), search: box('.header-search'), overflow: document.documentElement.scrollWidth > innerWidth };
      });
      assert.equal(layout.index.y + layout.index.height / 2, layout.newNote.y + layout.newNote.height / 2, 'Index and New note must share a toolbar row');
      assert(layout.index.x + layout.index.width <= layout.actions.x, 'Toolbar index overlaps other controls');
      assert(layout.search.width >= 40, `Search field collapsed at ${width}px in ${view}: ${JSON.stringify(layout)}`);
      assert(!layout.overflow, `Horizontal overflow at ${width}px in ${view}`);
      if (view === 'kanban') {
        assert(await page.$('[aria-label="排序"]'), 'Kanban sort label must be concise');
        assert(!await page.evaluate(() => document.body.textContent.includes('卡片排序方式')));
      }
      if (width === 390 && view === 'flat') {
        assert(await page.$('.note-list-mobile-sort [aria-label="排序"]'), 'Expanded notes must retain mobile sorting');
        await chooseSelect(page, '.note-list-mobile-sort [aria-label="排序"]', 'title:asc');
        const ascending = await page.$$eval('.note-list tbody tr', rows => rows.map(row => row.querySelector('td').textContent));
        await chooseSelect(page, '.note-list-mobile-sort [aria-label="排序"]', 'title:desc');
        const descending = await page.$$eval('.note-list tbody tr', rows => rows.map(row => row.querySelector('td').textContent));
        assert.deepEqual(descending, [...ascending].reverse(), 'Mobile sorting must reorder the actual notes');
        await page.click('[aria-label="Note view"]');
        await page.waitForSelector('[role="option"]');
        assert.equal(await page.$eval('[role="option"]', element => element.getAttribute('data-option-value')), 'flat', 'Expand must be the first mobile option');
        await page.keyboard.press('Escape');
      }
      if ([1440, 390].includes(width)) await page.screenshot({ path: `${product}/artifacts/qa/toolbar-${view}-${width}.png`, fullPage: true });
    }
  }
  await page.evaluate(() => localStorage.setItem('github-notes:language', 'en'));
  await page.setViewport({ width: 1440, height: 1000 });
  for (const view of ['list', 'card', 'kanban', 'flat']) {
    await visit(`/notebooks/example/folders/readme/deep?view=${view}`);
    assert(await page.$(indexSelector(view)), 'README.md must provide the index card when index.md is absent');
    assert(!await page.$('[aria-label="Status for README guide"], [data-notepath$="/README.md"]'), 'Selected README must not be duplicated below');
    await openIndex('readme/deep/README.md');
    await closeIndex();
  }
  await visit('/notebooks/example?view=list');
  assert(await page.$('.folder-links > button[data-folder-index]:first-child'), 'Index must be the first folder card');
  assert.equal(await page.$eval('[data-folder-index]', element => element.textContent.trim()), 'Index');
  assert.equal(await page.$eval('[data-folder-index]', element => getComputedStyle(element).backgroundColor), 'rgb(255, 255, 255)');
  assert(await page.$('[data-folder-index] .lucide-file-text'), 'Index needs a note icon');
  assert(!await page.$('.folder-index-content, .folder-index-header'), 'Inline introduction must be removed');
  const bounds = await page.$$eval('.folder-links > button', elements => elements.slice(0, 2).map(element => { const box = element.getBoundingClientRect(); return { x: box.x, y: box.y, w: box.width, h: box.height }; }));
  assert.equal(bounds[0].y, bounds[1].y, 'Index must sit alongside folders');
  assert.equal(bounds[0].w, bounds[1].w); assert.equal(bounds[0].h, bounds[1].h);
  assert(!await page.$('.workspace-page-heading'), 'Page title and subtitle must be removed');
  assert(await page.$eval('.workspace-page-header', element => element.getBoundingClientRect().height <= 64), 'Toolbar is too tall');
  assert(await page.$('.note-list'), 'Ordinary note listing should remain');
  assert(!await page.$('[aria-label="Status for Notebook introduction"]'), 'Index must not also appear in the note list');
  assert(await page.$('[aria-label="Status for Secondary README"]'), 'Unselected README must remain an ordinary note');
  assert.equal((await page.$$('[data-folder-index]')).length, 1, 'Both files must produce only one index card');
  await openIndex();
  await page.waitForFunction(() => document.body.innerText.includes('根目錄介紹') || document.querySelector('textarea[aria-label="Note content"]')?.value.includes('根目錄介紹'));
  await closeIndex();
  for (const view of ['list', 'card', 'kanban', 'flat']) {
    await visit(`/notebooks/example/folders/projects/deep?view=${view}`);
    assert(await page.$(indexSelector(view)), `Nested index missing in ${view}`);
    if (['flat', 'kanban'].includes(view)) {
      assert(!await page.$('.workspace-breadcrumbs, .folder-links'), `Folder selectors remain in ${view}`);
    }
    assert(!await page.$('[data-notepath$="/index.md"], [aria-label="Status for 深層介紹"]'), `Index duplicated in ${view}`);
    assert(!await page.evaluate(() => document.body.innerText.includes('No notes yet')), 'An index-only folder must not appear empty');
    await page.click('button[data-folder-index]');
    await page.waitForSelector('[aria-label="Close note"]');
    assert(new URL(page.url()).pathname.endsWith('/notes/projects/deep/index.md'));
    await closeIndex();
  }
  for (const query of ['q=Regular', 'status=inbox', 'tag=missing']) {
    await visit(`/notebooks/example?${query}`);
    assert(!await page.$('[data-folder-index]'), `Index should not displace filtered results: ${query}`);
  }
  await visit('/notebooks/example/folders/empty');
  assert(!await page.$('[data-folder-index]'), 'Parent index must not leak into a folder with no index');
  await visit('/notebooks/other');
  await openIndex('README.md');
  assert(page.url().includes('/notebooks/other/notes/README.md'), 'Notebook selection must isolate README indexes');
  await closeIndex();
  await visit('/notebooks/example/folders/hidden');
  assert(!await page.$('[data-folder-index]'), 'Hidden index was exposed');
  await visit('/notebooks/example/folders/hidden?showHidden=true');
  assert(await page.$('button[data-folder-index]'));
  await openIndex('hidden/index.md');
  await closeIndex();
  await visit('/notebooks/example/folders/blank');
  assert(await page.$('button[data-folder-index]'), 'Empty index must still be openable');
  await visit('/notebooks/example');
  await page.focus('button[data-folder-index]'); await page.keyboard.press('Enter');
  await page.waitForSelector('[aria-label="Close note"]'); await closeIndex();
  fs.mkdirSync(`${product}/artifacts/qa`, { recursive: true });
  await page.screenshot({ path: `${product}/artifacts/qa/folder-index-desktop.png`, fullPage: true });
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await visit('/notebooks/example');
  assert(await page.$(indexSelector('flat')));
  assert(await page.$eval('.workspace-page-header', element => element.getBoundingClientRect().height <= 64), 'Mobile toolbar is too tall');
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Mobile horizontal overflow');
  await page.screenshot({ path: `${product}/artifacts/qa/folder-index-mobile.png`, fullPage: true });
  for (const width of [1440, 390]) {
    await page.setViewport({ width, height: 900 });
    for (const route of ['/assets?notebook=example', '/agent?notebook=example', '/settings', '/screen?notebook=example']) {
      await visit(route);
      assert(!await page.$('.workspace-page-heading'), `Page heading remains on ${route}`);
      assert(!await page.$('.workspace-page-header'), `Empty title space remains on ${route}`);
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Overflow on ${route}`);
    }
  }
  await page.evaluate(() => localStorage.setItem('github-notes:language', 'zh-TW'));
  await visit('/notebooks/example');
  assert.equal(await page.$eval('[data-folder-index]', element => element.textContent.trim()), '索引');
  await page.evaluate(() => localStorage.setItem('github-notes:language', 'en'));
  assert.equal(git('status', '--porcelain').toString(), '', 'Viewing indexes must not modify notes');

  // Exercise the same view against hosted data, including unsent working copies.
  let writable = true;
  let remoteIndex = { id: 'index', path: 'notes/example/index.md', notebookId: 'example', title: 'Hosted introduction', content: '# Hosted introduction\n', tags: [], metadata: { custom: 'preserve' }, revision: 'one' };
  let writes = 0;
  await page.setViewport({ width: 1440, height: 1000 });
  await page.setRequestInterception(true);
  page.on('request', request => {
    const url = new URL(request.url()); let body;
    if (url.pathname === '/api/workspace') body = { config: { schema_version: 1, workspace: { title: 'Hosted index QA', default_notebook: 'example' }, notebooks: [{ id: 'example', title: 'Example', root: 'notes/example' }] }, branch: 'main', repoRoot: '', gitStatus: { branch: 'main', isClean: true, staged: [], modified: [], untracked: [] }, source: { type: 'github', identity: 'github:index/fixture@main' }, capabilities: { write: writable, local: false }, revision: 'one' };
    if (url.pathname === '/api/notes') body = { notes: [remoteIndex] };
    if (url.pathname === '/api/notes/read') body = { note: remoteIndex };
    if (url.pathname === '/api/auth/session') body = { authenticated: writable, configured: true, login: 'fixture' };
    if (url.pathname === '/api/folders') body = { folders: [] };
    if (url.pathname === '/api/assets') body = { assets: [] };
    if (url.pathname.startsWith('/api/notes') && request.method() !== 'GET') writes++;
    if (body) void request.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    else void request.continue();
  });
  await visit('/notebooks/example');
  await openIndex();
  await page.evaluate(() => [...document.querySelectorAll('button')].find(button => button.textContent.trim() === 'Source').click());
  await page.focus('textarea[aria-label="Note content"]');
  await page.keyboard.down('Control'); await page.keyboard.press('KeyA'); await page.keyboard.up('Control');
  await page.keyboard.type('# Updated introduction\n\nWorking copy content\n');
  await page.waitForFunction(() => document.body.innerText.includes('Saved locally'));
  await closeIndex();
  await page.reload({ waitUntil: 'networkidle0' });
  await openIndex();
  await page.evaluate(() => [...document.querySelectorAll('button')].find(button => button.textContent.trim() === 'Source').click());
  await page.waitForSelector('textarea[aria-label="Note content"]');
  assert(await page.$eval('textarea[aria-label="Note content"]', element => element.value.includes('Working copy content')), 'Reload lost the index working copy');
  await closeIndex();
  assert.equal(writes, 0, 'Index editing must retain the existing explicit commit workflow');
  writable = false;
  await page.reload({ waitUntil: 'networkidle0' });
  await openIndex();
  assert(!await page.evaluate(() => document.body.innerText.includes('Working copy content')), 'Read-only view must use source data');
  assert.equal(writes, 0, 'Read-only index viewing attempted a write');
  await closeIndex();
  remoteIndex = { ...remoteIndex, id: 'readme', path: 'notes/example/README.md' };
  await visit('/notebooks/example');
  await openIndex('README.md');
  assert.equal(writes, 0, 'Hosted README viewing attempted a write');
  assert.deepEqual(errors, []);
  console.log('PASS first white Index card, root/nested/missing/blank indexes, notebook isolation, all page headings removed, compact toolbar, views, filters, hidden notes, keyboard, mobile, locales, unchanged files, hosted working copies and read-only viewing');
} finally {
  await browser.close(); await new Promise(resolve => server.close(resolve));
  fs.rmSync(root, { recursive: true, force: true });
}
