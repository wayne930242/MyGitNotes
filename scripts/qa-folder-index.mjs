import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { chooseSelect } from './browser-select.mjs';
import { resolveQaChromePath } from './qa-chrome.mjs';

const product = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(`${product}/apps/web/package.json`);
const puppeteer = require('puppeteer-core');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'github-notes-index-'));
const write = (file, content) => {
  fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  fs.writeFileSync(path.join(root, file), content);
};
const git = (...args) => execFileSync('git', args, { cwd: root, stdio: 'pipe' });
// The index card belongs to a notebook root, so each index case gets its own notebook.
write('notes/.github-notes.yaml', `schema_version: 1\nworkspace:\n  title: Folder Index QA\n  default_notebook: example\nnotebooks:\n${['example', 'other', 'hidden', 'blank'].map(id => `  - id: ${id}\n    title: ${id}\n    root: notes/${id}\n`).join('')}`);
write('notes/example/index.md', '---\ntitle: Notebook introduction\ncustom: preserve\n---\n# 根目錄介紹\n\n這是 **索引內容**。\n\n[進入資料夾](projects/)\n\n[開啟筆記](regular.md)\n\n<img src="bad" onerror="window.indexUnsafe=true">\n<script>window.indexUnsafe=true</script>\n');
write('notes/example/regular.md', '# Regular Note\n');
write('notes/example/README.md', '# Secondary README\n');
write('notes/example/projects/index.md', '# 專案介紹\n\n[同頁段落](#細節)\n\n## 細節\n\n專案內容。\n');
write('notes/example/empty/note.md', '# No Index\n');
write('notes/other/README.md', '# 其他筆記本\n');
write('notes/hidden/index.md', '---\nhiden: true\n---\n# 隱藏介紹\n');
write('notes/hidden/README.md', '# Visible fallback\n');
write('notes/blank/index.md', '');
git('init', '-b', 'main');
git('config', 'user.name', 'Browser QA');
git('config', 'user.email', 'qa@example.com');
git('add', '.');
git('commit', '-m', 'fixture');
process.env.MYGITNOTES_SOURCE = 'local';
process.env.MYGITNOTES_LOCAL_PATH = root;
delete process.env.VERCEL;
delete process.env.APP_URL;
const { createApp } = await import(`${product}/apps/local-server/dist/app.js`);
const server = createServer(createApp(product));
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await puppeteer.launch({ executablePath: resolveQaChromePath(), headless: true, pipe: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.message));
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
  // Flat lists the index as the first note row; Kanban puts it at the start of the board's header row.
  const indexSelector = view => view === 'flat' ? '.note-list tbody:not(.note-list-uncommitted) > tr:first-child.note-list-leading button[data-folder-index]' : view === 'kanban' ? '.kanban-leading > button[data-folder-index]:first-child' : '.folder-links > button[data-folder-index]:first-child';
  fs.mkdirSync(`${product}/artifacts/qa`, { recursive: true });
  await page.evaluate(() => localStorage.setItem('github-notes:language', 'zh-TW'));
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewport({ width, height: 900 });
    for (const view of ['flat', 'kanban']) {
      await visit(`/notebooks/example?view=${view}`);
      assert(!await page.$('.workspace-breadcrumbs, .folder-links'), `Folder selectors remain in ${view}`);
      assert(await page.$(indexSelector(view)), `Index missing in ${view}`);
      assert(await page.evaluate(() => document.querySelector('.workspace-scroll').textContent.includes('No Index')), 'Descendant notes must remain visible');
      assert(!await page.$('[data-notepath="notes/example/index.md"], [aria-label="Status for Notebook introduction"]'), 'Index must not duplicate the current index in results');
      const layout = await page.evaluate(() => {
        const box = selector => {
          const { x, y, width, height } = document.querySelector(selector).getBoundingClientRect();
          return { x, y, width, height };
        };
        return { newNote: box('.header-new-note'), search: box('.header-search'), overflow: document.documentElement.scrollWidth > innerWidth };
      });
      if (width < 768) assert.equal(layout.newNote.width, 0, 'Mobile toolbar still shows the duplicate New note action');
      assert(layout.search.width >= 40, `Search field collapsed at ${width}px in ${view}: ${JSON.stringify(layout)}`);
      assert(!layout.overflow, `Horizontal overflow at ${width}px in ${view}`);
      if (view === 'kanban') {
        assert(await page.$('[aria-label="排序"]'), 'Kanban sort label must be concise');
        assert(!await page.evaluate(() => document.body.textContent.includes('卡片排序方式')));
        if (width === 1440) {
          const wheel = await page.evaluate(() => {
            const scroller = document.querySelector('[data-kanban-columns]');
            if (!scroller) return { missing: true };
            scroller.scrollLeft = 0;
            const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 120, altKey: true });
            scroller.dispatchEvent(event);
            return { missing: false, prevented: event.defaultPrevented, left: scroller.scrollLeft };
          });
          assert(!wheel.missing, 'Kanban horizontal scroller is not identifiable');
          assert(wheel.prevented && wheel.left > 0, `Alt + vertical wheel did not scroll Kanban horizontally: ${JSON.stringify(wheel)}`);
          const boundary = await page.evaluate(() => {
            const scroller = document.querySelector('[data-kanban-columns]');
            scroller.scrollLeft = scroller.scrollWidth;
            const before = scroller.scrollLeft;
            const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 120, altKey: true });
            scroller.dispatchEvent(event);
            return { before, after: scroller.scrollLeft, prevented: event.defaultPrevented };
          });
          assert(boundary.prevented && boundary.after === boundary.before, 'Alt wheel escaped at the Kanban boundary');
        }
      }
      if (width === 390 && view === 'flat') {
        assert(await page.$('.note-toolbar-sort[aria-label="排序"]'), 'Expanded notes must retain mobile sorting');
        // The server sorts; the list must show its answer in order, without the root index it lists separately.
        const sortByTitle = async order => {
          const answered = page.waitForResponse(response => {
            const url = new URL(response.url());
            return url.pathname === '/api/notes/query' && url.searchParams.get('sort') === 'title' && (url.searchParams.get('order') || 'desc') === order;
          });
          await chooseSelect(page, '.note-toolbar-sort[aria-label="排序"]', `title:${order}`);
          const paths = (await (await answered).json()).notes.map(note => note.path).filter(path => path !== 'notes/example/index.md');
          await page.waitForFunction(
            paths => {
              const cells = [...document.querySelectorAll('.note-list tbody tr:not(.note-list-leading) td:first-child')].map(cell => cell.textContent);
              return cells.length === paths.length && cells.every((text, index) => text.endsWith(paths[index]));
            },
            {},
            paths,
          );
          return paths;
        };
        const ascending = await sortByTitle('asc'), descending = await sortByTitle('desc');
        assert(ascending.length > 1, 'Sorting needs more than one note');
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
    await visit(`/notebooks/other?view=${view}`);
    assert(await page.$(indexSelector(view)), 'README.md must provide the index card when index.md is absent');
    assert(!await page.$('[aria-label="Status for 其他筆記本"], [data-notepath$="/README.md"]'), 'Selected README must not be duplicated below');
    await openIndex('README.md');
    assert(page.url().includes('/notebooks/other/notes/README.md'), 'Notebook selection must isolate README indexes');
    await closeIndex();
  }
  await visit('/notebooks/example?view=list');
  assert(await page.$('.folder-links > button[data-folder-index]:first-child'), 'Index must be the first folder card');
  assert.equal(await page.$eval('[data-folder-index]', element => element.textContent.trim()), 'Index');
  assert(await page.$('[data-folder-index] .lucide-file-text'), 'Index needs a note icon');
  assert(!await page.$('.folder-index-content, .folder-index-header'), 'Inline introduction must be removed');
  const bounds = await page.$$eval('.folder-links > button', elements =>
    elements.slice(0, 2).map(element => {
      const box = element.getBoundingClientRect();
      return { x: box.x, y: box.y, w: box.width, h: box.height };
    }));
  assert.equal(bounds[0].y, bounds[1].y, 'Index must sit alongside folders');
  assert(Math.abs(bounds[0].w - bounds[1].w) < 1 && Math.abs(bounds[0].h - bounds[1].h) < 1, `Index and folder cards must share a size: ${JSON.stringify(bounds)}`);
  assert(!await page.$('.workspace-page-heading'), 'Page title and subtitle must be removed');
  assert(await page.$('.note-list'), 'Ordinary note listing should remain');
  assert(!await page.$('[aria-label="Status for Notebook introduction"]'), 'Index must not also appear in the note list');
  assert(await page.$('[aria-label="Status for Secondary README"]'), 'Unselected README must remain an ordinary note');
  assert.equal((await page.$$('[data-folder-index]')).length, 1, 'Both files must produce only one index card');
  await openIndex();
  await page.waitForFunction(() => document.body.innerText.includes('根目錄介紹') || document.querySelector('textarea[aria-label="Note content"]')?.value.includes('根目錄介紹'));
  await closeIndex();
  for (const query of ['q=Regular', 'status=inbox', 'tag=missing', 'folders=notes%2Fexample%2Fempty']) {
    await visit(`/notebooks/example?${query}`);
    assert(!await page.$('[data-folder-index]'), `Index should not displace filtered results: ${query}`);
  }
  // A hidden index.md keeps priority over README.md, so the card stays hidden until hidden notes are shown.
  await visit('/notebooks/hidden');
  assert(!await page.$('[data-folder-index]'), 'Hidden index was exposed');
  await visit('/notebooks/hidden?showHidden=true');
  assert(await page.$('button[data-folder-index]'));
  await openIndex('index.md');
  await closeIndex();
  await visit('/notebooks/blank');
  assert(await page.$('button[data-folder-index]'), 'Empty index must still be openable');
  await openIndex('index.md');
  await closeIndex();
  await visit('/notebooks/example');
  await page.focus('button[data-folder-index]');
  await page.keyboard.press('Enter');
  await page.waitForSelector('[aria-label="Close note"]');
  await closeIndex();
  fs.mkdirSync(`${product}/artifacts/qa`, { recursive: true });
  await page.screenshot({ path: `${product}/artifacts/qa/folder-index-desktop.png`, fullPage: true });
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await visit('/notebooks/example');
  assert(await page.$(indexSelector('flat')));
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
  assert.deepEqual(errors, []);
  console.log('PASS first Index card, root/README/hidden/blank indexes, notebook isolation, page headings removed, views, filters, keyboard, mobile sorting, locales and unchanged files');
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
  fs.rmSync(root, { recursive: true, force: true });
}
