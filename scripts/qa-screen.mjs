import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { resolveQaChromePath } from './qa-chrome.mjs';

const product = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(`${product}/apps/web/package.json`);
const puppeteer = require('puppeteer-core');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'github-notes-screen-qa-'));
const write = (file, content) => {
  fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  fs.writeFileSync(path.join(root, file), content);
};
const git = (...args) => execFileSync('git', args, { cwd: root, stdio: 'pipe' });
write('.github-notes.yaml', 'schema_version: 1\nworkspace:\n  title: Screen QA\n  default_notebook: example\nnotebooks:\n  - id: example\n    title: Example\n    root: notes/example\n  - id: archive\n    title: Archive\n    root: notes/archive\n');
for (let i = 0; i < 6; i++) write(`notes/example/note-${i}.md`, `---\ntags: [example-tag]\n---\n# Note ${i}\n\n${'A long paragraph for native vertical scrolling.\n\n'.repeat(40)}`);
write('notes/archive/archive-note.md', '---\ntags: [archive-only]\n---\n# Archive Note\n');
// A version 1 layout exercises migration into notebook-owned lanes.
write('.github-notes-screen.yaml', JSON.stringify({ version: 1, rows: [{ id: 'reading', name: 'Reading', kind: 'dynamic', view: 'medium', source: { kind: 'folder', notebookId: 'example', path: 'notes/example', recursive: true } }, { id: 'pins', name: 'Pins', kind: 'custom', view: 'small', items: [] }, { id: 'mixed', name: 'Mixed', kind: 'custom', view: 'small', items: [{ id: 'pin-example', kind: 'note', notebookId: 'example', path: 'notes/example/note-0.md' }, { id: 'pin-archive', kind: 'note', notebookId: 'archive', path: 'notes/archive/archive-note.md' }] }, { id: 'every', name: 'Every notebook', kind: 'dynamic', view: 'small', source: { kind: 'tag', tag: 'archive-only' } }] }));
git('init', '-b', 'main');
git('config', 'user.name', 'QA');
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
const browser = await puppeteer.launch({ executablePath: resolveQaChromePath(), headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const assert = (value, message) => {
  if (!value) throw Error(message);
};
let page;
try {
  page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000 });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  let failAssets = true;
  await page.setRequestInterception(true);
  page.on('request', request => {
    if (new URL(request.url()).pathname === '/api/assets' && failAssets) void request.respond({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Temporary asset outage' }) });
    else void request.continue();
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/screen`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.screen-error');
  const headerHeight = await page.$eval('.header-layout', e => e.getBoundingClientRect().height);
  assert(headerHeight <= 56, `Desktop navigation is too tall: ${headerHeight}`);
  const lane = '#screen-lane-reading', body = `${lane} .screen-card-content`, strip = `${lane} .screen-lane-strip`;
  const first = await page.$(body);
  const rect = await first.boundingBox();
  await page.mouse.move(rect.x + 100, rect.y + 100);
  await page.mouse.wheel({ deltaY: 180 });
  await page.waitForFunction(selector => document.querySelector(selector).scrollTop > 0, {}, body);
  assert(await page.$eval(strip, e => e.scrollLeft === 0), 'Native wheel unexpectedly moved lane');
  const vertical = await page.$eval(body, e => e.scrollTop);
  await page.keyboard.down('Alt');
  await page.mouse.wheel({ deltaY: 180 });
  await page.keyboard.up('Alt');
  await page.waitForFunction(selector => document.querySelector(selector).scrollLeft > 0, {}, strip);
  assert(await page.$eval(body, (e, before) => e.scrollTop === before, vertical), 'Alt wheel was intercepted by note scrolling');
  await page.$eval(strip, e => {
    e.scrollLeft = e.scrollWidth;
  });
  const edge = await page.$eval(strip, e => e.scrollLeft);
  const edgeResult = await page.$eval(body, e => {
    const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 120, altKey: true });
    e.dispatchEvent(event);
    return event.defaultPrevented;
  });
  assert(edgeResult && await page.$eval(strip, (e, x) => e.scrollLeft === x, edge), 'Alt wheel escaped at lane boundary');
  console.log('PASS native note scrolling, Alt horizontal scrolling and boundary containment');

  for (const [label, value] of [['Thumbnail', 'thumbnail'], ['Small', 'small'], ['Medium', 'medium']]) {
    await page.click(`${lane} button[aria-label="${label}"]`);
    await page.waitForSelector(`${lane}.screen-view-${value} button[aria-label="${label}"][aria-pressed="true"]`);
  }
  for (const [value, title] of [['title:desc', 'Note 5'], ['title:asc', 'Note 0'], ['title:desc', 'Note 5']]) {
    await page.click(`${lane} .screen-sort-select`);
    await page.waitForSelector(`[data-option-value="${value}"]`);
    await page.click(`[data-option-value="${value}"]`);
    await page.waitForFunction((selector, expected) => document.querySelector(`${selector} .screen-card-title`)?.textContent === expected, {}, lane, title);
  }
  assert(!await page.$('#screen-lane-pins .screen-sort-select'), 'Custom lane must retain manual ordering');
  console.log('PASS independent dynamic lane sorting');
  const inset = await page.$eval(lane, e => {
    const a = e.getBoundingClientRect(), b = e.querySelector('h3').getBoundingClientRect();
    return { x: b.x - a.x, y: b.y - a.y };
  });
  assert(inset.x >= 8 && inset.y >= 8, `Lane heading lacks top/left padding: ${JSON.stringify(inset)}`);
  assert(!await page.$('.screen-sidebar button[aria-label="Edit swimlanes"]'), 'Old lane editor remains');
  const ensureSidebar = async () => {
    const isOpen = await page.$eval('.workspace-responsive-sidebar', el => el.classList.contains('is-open')).catch(() => false);
    if (!isOpen) {
      await page.click('[data-sidebar-toggle]');
      await page.waitForFunction(() => document.querySelector('.workspace-responsive-sidebar')?.classList.contains('is-open'));
      await new Promise(resolve => setTimeout(resolve, 200));
    }
  };
  await ensureSidebar();
  await page.click('.screen-sidebar-controls .screen-sidebar-action');
  await page.waitForSelector('dialog[open]');
  let dialogSelects = await page.$$('dialog[open] .select-trigger');
  await dialogSelects[0].click();
  await page.click('[data-option-value="tag"]');
  await page.waitForFunction(() => [...document.querySelectorAll('dialog[open] label')].map(label => label.textContent.trim())[2]?.startsWith('Tag'));
  assert(!await page.$$eval('dialog[open] label', labels => labels.some(label => label.textContent.trim().startsWith('Notebooks'))), 'Lane dialog still offers a notebook picker');
  assert(await page.$$eval('#screen-tags option', options => options.map(option => option.value).join(',') === 'example-tag'), 'Tag suggestions were not scoped to the current notebook');
  await page.type('dialog[open] input[list="screen-tags"]', 'example-tag');
  await page.click('dialog[open] button.ui-button-primary');
  await page.waitForFunction(() => [...document.querySelectorAll('.screen-lane')].some(lane => lane.querySelector('.screen-dynamic-label')?.textContent.includes('#example-tag') && lane.querySelector('.screen-card-title')?.textContent.startsWith('Note ')));
  console.log('PASS tag lane created inside the current notebook without a notebook picker');

  await ensureSidebar();
  await page.click('[aria-label="Edit swimlane: Reading"]');
  await page.waitForSelector('input[aria-label="Swimlane name"]');
  dialogSelects = await page.$$('dialog[open] .select-trigger');
  await dialogSelects[0].click();
  await page.click('[data-option-value="tag"]');
  await page.type('dialog[open] input[list="screen-tags"]', 'example-tag');
  await page.focus('input[aria-label="Swimlane name"]');
  await page.$eval('input[aria-label="Swimlane name"]', input => input.select());
  await page.keyboard.type('Renamed');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelector('#screen-lane-reading h3')?.textContent === 'Renamed' && document.querySelector('#screen-lane-reading .screen-dynamic-label')?.textContent.includes('#example-tag') && document.querySelector('#screen-lane-reading .screen-card-title')?.textContent === 'Note 5');
  await ensureSidebar();
  const hasHandle = await page.$('[aria-label="Move swimlane: Renamed"]');
  if (!hasHandle) await page.click('.reorder-toggle');
  await page.focus('[aria-label="Move swimlane: Renamed"]');
  await page.keyboard.press('Space');
  await page.waitForFunction(() => document.querySelector('[aria-label="Move swimlane: Renamed"]')?.getAttribute('aria-pressed') === 'true');
  await page.waitForFunction(() => [...document.querySelectorAll('[role="status"]')].some(e => e.textContent.includes('over droppable area reading')));
  await page.keyboard.press('ArrowDown');
  await page.waitForFunction(() => [...document.querySelectorAll('[role="status"]')].some(e => e.textContent.includes('over droppable area pins')));
  await page.keyboard.press('Space');
  await page.waitForFunction(() => document.querySelector('.screen-lane')?.id === 'screen-lane-pins');
  const handle = await page.$('[aria-label="Move swimlane: Renamed"]'), target = await page.$('[aria-label="Move swimlane: Pins"]');
  const a = await handle.boundingBox(), b = await target.boundingBox();
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 12 });
  await page.mouse.up();
  const closeSidebar = async () => {
    const isOpen = await page.$eval('.workspace-responsive-sidebar', el => el.classList.contains('is-open')).catch(() => false);
    if (isOpen) {
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => !document.querySelector('.workspace-responsive-sidebar')?.classList.contains('is-open'));
      await new Promise(resolve => setTimeout(resolve, 200));
    }
  };
  await closeSidebar();
  failAssets = false;
  await page.click('button[aria-label="Retry assets"]');
  await page.waitForFunction(() => !document.querySelector('.screen-error'));
  assert(await page.$eval('#screen-lane-reading h3', e => e.textContent === 'Renamed'), 'Resource retry discarded lane edits');
  await page.waitForFunction(() => !Object.keys(localStorage).some(key => key.startsWith('github-notes:screen-draft:')));
  await page.reload({ waitUntil: 'networkidle0' });
  assert(await page.$eval('.screen-lane', e => e.id === 'screen-lane-reading' && e.querySelector('h3').textContent === 'Renamed'), 'Lane changes did not persist');
  assert(await page.$$eval('.screen-lane', lanes => lanes.some(lane => lane.querySelector('h3')?.textContent === 'Dynamic swimlane' && lane.querySelector('.screen-dynamic-label')?.textContent.includes('#example-tag'))), 'Notebook tag lane did not persist');
  assert(await page.$eval(`${lane} .screen-sort-select`, e => e.getAttribute('value') === 'title:desc'), 'Sort selection did not persist');
  assert(await page.$eval(`${lane} .screen-card-title`, e => e.textContent === 'Note 5'), 'Edited dynamic source did not persist');
  const titles = selector => page.$$eval(`${selector} .screen-card-title`, cards => cards.map(card => card.textContent));
  const laneIds = () => page.$$eval('.screen-lane', lanes => lanes.map(lane => lane.id));
  const stored = fs.readFileSync(path.join(root, '.github-notes-screen.yaml'), 'utf8');
  assert(stored.startsWith('version: 2') && !stored.includes('"version":1'), 'Saved Screen layout was not migrated to version 2');
  const exampleLanes = await laneIds();
  assert(exampleLanes.length === 5 && JSON.stringify(exampleLanes.slice(0, 4)) === JSON.stringify(['screen-lane-reading', 'screen-lane-pins', 'screen-lane-mixed', 'screen-lane-every']) && !exampleLanes.includes('screen-lane-mixed-archive'), `Example notebook shows lanes from another notebook: ${exampleLanes}`);
  assert(JSON.stringify(await titles('#screen-lane-mixed')) === JSON.stringify(['Note 0']), 'Mixed lane kept an item from another notebook');
  assert((await titles('#screen-lane-every')).length === 0, 'Legacy all-notebook tag lane still reads another notebook');
  await page.goto(`http://127.0.0.1:${server.address().port}/screen?notebook=archive`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('#screen-lane-mixed-archive');
  assert(JSON.stringify(await laneIds()) === JSON.stringify(['screen-lane-mixed-archive']), `Archive notebook shows foreign lanes: ${await laneIds()}`);
  assert(JSON.stringify(await titles('#screen-lane-mixed-archive')) === JSON.stringify(['Archive Note']), 'Split archive lane lost its item');
  await page.click('#screen-lane-mixed-archive button[aria-label="Add item: Mixed"]');
  await page.waitForSelector('dialog[open] .screen-item-options');
  assert(!await page.$$eval('dialog[open] label', labels => labels.some(label => label.textContent.trim().startsWith('Notebooks'))), 'Item dialog still offers a notebook picker');
  assert(await page.$$eval('dialog[open] .screen-item-option small', paths => paths.length > 0 && paths.every(item => item.textContent.startsWith('notes/archive/'))), 'Item dialog lists notes from another notebook');
  await page.keyboard.press('Escape');
  console.log('PASS version 1 layout migrates into notebook-owned lanes and each notebook shows only its lanes');
  await page.goto(`http://127.0.0.1:${server.address().port}/screen/lanes/mixed-archive`, { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => new URLSearchParams(location.search).get('notebook') === 'archive' && document.querySelector('.screen-study-session#screen-lane-mixed-archive'));
  assert(!await page.$('.screen-board-empty'), 'Lane route reported a missing lane while switching notebooks');
  console.log('PASS lane route opens its own notebook');
  await page.goto(`http://127.0.0.1:${server.address().port}/screen`, { waitUntil: 'networkidle0' });
  await page.waitForSelector(lane);
  for (const width of [320, 390, 1440]) {
    await page.setViewport({ width, height: 1000 });
    const fit = await page.$eval('.screen-lane-actions', e => {
      const r = e.getBoundingClientRect();
      return r.left >= 0 && r.right <= innerWidth;
    });
    assert(fit, `Lane controls overflow at ${width}`);
    const navFits = await page.$$eval('.header-nav button', buttons =>
      buttons.filter(button => button.getBoundingClientRect().width > 0).every(button => {
        const r = button.getBoundingClientRect();
        return r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth && r.height >= 32;
      }));
    assert(navFits, `Navigation buttons clipped or undersized at ${width}`);
  }
  fs.mkdirSync(path.join(product, 'artifacts/qa'), { recursive: true });
  await page.screenshot({ path: path.join(product, 'artifacts/qa/screen-lanes.png') });
  assert(!errors.length, errors.join('; '));
  console.log('PASS size tabs, heading inset, sidebar reorder, dynamic source persistence and non-destructive asset retry');
} catch (error) {
  console.log(await page.evaluate(() => ({ lanes: [...document.querySelectorAll('.screen-lane')].map(lane => ({ source: lane.querySelector('.screen-dynamic-label')?.textContent, titles: [...lane.querySelectorAll('.screen-card-title')].map(title => title.textContent) })), focus: document.activeElement?.outerHTML, nav: document.querySelector('.screen-sidebar-lanes')?.innerText, status: [...document.querySelectorAll('[role="status"]')].map(e => e.textContent), alerts: [...document.querySelectorAll('[role="alert"]')].map(e => e.textContent) })));
  throw error;
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
  fs.rmSync(root, { recursive: true, force: true });
}
