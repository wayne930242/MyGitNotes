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
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'github-notes-focus-qa-'));
const write = (file, content) => {
  fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  fs.writeFileSync(path.join(root, file), content);
};
const git = (...args) => execFileSync('git', args, { cwd: root, stdio: 'pipe' });
write('.github-notes.yaml', 'schema_version: 1\nworkspace:\n  title: Focus QA\n  default_notebook: work\nnotebooks:\n  - id: work\n    title: Work\n    root: notes/work\n  - id: other\n    title: Other\n    root: notes/other\n');
const notes = ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Zeta'];
const tags = { Alpha: ['project'], Gamma: ['project'], Beta: ['personal'] };
notes.forEach((title, index) => write(`notes/work/${title.toLowerCase()}.md`,
  `---\ntitle: ${title}\nstatus: ${index % 2 ? 'doing' : 'todo'}\nupdated: 2026-09-${String(10 + index).padStart(2, '0')}\n${tags[title] ? `tags: [${tags[title].join(', ')}]\n` : ''}---\n# ${title}\n\n${title} body.\n\n${title === 'Delta' ? '[Open Epsilon](epsilon.md)\n' : ''}`));
write('notes/work/sub/omega.md', '---\ntitle: Omega\nstatus: todo\nupdated: 2026-09-16\ntags: [project]\n---\n# Omega\n\nOmega body.\n');
write('notes/work/sub/nested/deep.md', '---\ntitle: Deep\nstatus: todo\nupdated: 2026-09-17\n---\n# Deep\n\nDeep body.\n');
write('notes/other/outside.md', '---\ntitle: Outside\n---\n# Outside\n');
write('.github-notes-screen.yaml', JSON.stringify({ version: 2, rows: [
  { id: 'pins', name: 'Pins', kind: 'custom', view: 'small', notebookId: 'work', items: [{ id: 'pin-gamma', kind: 'note', notebookId: 'work', path: 'notes/work/gamma.md' }] },
] }));
git('init', '-b', 'main'); git('config', 'user.name', 'Browser QA'); git('config', 'user.email', 'qa@example.com');
git('add', '.'); git('commit', '-m', 'fixture');
process.env.MYGITNOTES_SOURCE = 'local'; process.env.MYGITNOTES_LOCAL_PATH = root;
delete process.env.VERCEL; delete process.env.APP_URL;
const { createApp } = await import(`${product}/apps/local-server/dist/app.js`);
const server = createServer(createApp(product));
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await puppeteer.launch({ executablePath: resolveQaChromePath(), headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const shots = path.join(product, 'artifacts/qa');
fs.mkdirSync(shots, { recursive: true });

const errors = [];
const newPage = async (width, height = 900) => {
  const page = await browser.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewport({ width, height });
  return page;
};
const shot = (page, name) => page.screenshot({ path: path.join(shots, `note-focus-${name}.png`) });
const search = page => new URL(page.url()).searchParams;
const tabLabels = (page, pane) => page.$$eval(`[data-focus-pane="${pane}"] .focus-tab [role="tab"]`, tabs => tabs.map(tab => tab.textContent.trim()));
const shownTab = (page, pane) => page.$eval(`[data-focus-pane="${pane}"] .focus-tab [role="tab"][aria-selected="true"]`, tab => tab.textContent.trim()).catch(() => null);
const paneCount = page => page.$$eval('[data-focus-pane]', panes => panes.length);
const activePane = page => page.$eval('[data-focus-pane][data-active]', pane => Number(pane.dataset.focusPane));
const BROWSE_ROW_SELECTOR = '.workspace-scroll :is(.note-list tbody tr, [data-notepath], .cursor-pointer.rounded-xl)';
/** A note in the browse region: a list row, a card or a Kanban card. */
const browseRow = (page, title) => page.evaluateHandle((selector, title) => [...document.querySelectorAll(selector)]
  .find(row => row.textContent.includes(title)), BROWSE_ROW_SELECTOR, title);
/** Clicks a browse item's title, away from its status and action controls.
 *  A view switch (e.g. to Kanban) renders its columns before their notes finish loading, so this waits for the row itself. */
const clickRow = async (page, title) => {
  await page.waitForFunction((selector, title) => [...document.querySelectorAll(selector)].some(row => row.textContent.includes(title)),
    { timeout: 5000 }, BROWSE_ROW_SELECTOR, title).catch(() => assert.fail(`Browse row ${title} is missing`));
  const row = await browseRow(page, title);
  const label = await row.evaluateHandle((row, title) => [...row.querySelectorAll('*')].reverse().find(element => element.textContent.trim() === title), title);
  await (label.asElement() ?? row.asElement()).click();
};
const clickTagOption = async (page, tag) => {
  const label = await page.waitForFunction(tag => [...document.querySelectorAll('.focus-batch-dialog .filter-options label')]
    .find(item => item.textContent.trim() === `#${tag}`), {}, tag);
  await (await label.asElement().$('input')).click();
};
const menuItem = async (page, label) => {
  const item = await page.waitForFunction(label => [...document.querySelectorAll('.focus-menu [role^="menuitem"]')].find(item => item.textContent.trim() === label), {}, label);
  await item.asElement().click();
};
const chooseDivision = async (page, label) => {
  await page.click('.focus-division-trigger');
  await menuItem(page, label);
};
/** Drags with HTML5 drag and drop: puppeteer's mouse does not start native drags, so the events are dispatched with one DataTransfer.
 *  `shift: true` holds the Shift modifier through the drop, matching a Shift-held tab-bar drag (copy instead of move). */
const dragTo = (page, source, target, { shift = false } = {}) => page.evaluate((source, target, shiftKey) => {
  const from = typeof source === 'string' ? document.querySelector(source) : source;
  const to = typeof target === 'string' ? document.querySelector(target) : target;
  const data = new DataTransfer();
  from.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: data, shiftKey }));
  to.dispatchEvent(new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer: data, shiftKey }));
  to.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: data, shiftKey }));
  to.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: data, shiftKey }));
  from.dispatchEvent(new DragEvent('dragend', { bubbles: true, cancelable: true, dataTransfer: data, shiftKey }));
}, source, target, shift);
const tabHandle = (page, pane, label) => page.evaluateHandle((pane, label) => [...document.querySelectorAll(`[data-focus-pane="${pane}"] .focus-tab`)]
  .find(tab => tab.querySelector('[role="tab"]').textContent.trim() === label), pane, label);
const clickTab = async (page, pane, label) => (await (await tabHandle(page, pane, label)).asElement().$('[role="tab"]')).click();
/** Places the caret at the end of `text` inside the editor under `scope`. */
const clickEnd = async (page, scope, text) => {
  const point = await page.evaluate((scope, text) => {
    const walker = document.createTreeWalker(document.querySelector(`${scope} .cm-content`), NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode, start = node.textContent.indexOf(text);
      if (start < 0) continue;
      const range = document.createRange(); range.setStart(node, start); range.setEnd(node, start + text.length);
      const box = range.getBoundingClientRect(); return { x: box.right - 1, y: box.y + box.height / 2 };
    }
    throw Error(`Missing editor text: ${text}`);
  }, scope, text);
  await page.mouse.click(point.x, point.y);
  await page.keyboard.press('End');
};
const palette = async (page, command) => {
  await page.keyboard.down('Alt'); await page.keyboard.press('Slash'); await page.keyboard.up('Alt');
  await page.waitForSelector('.keyboard-shortcuts-panel[data-mode="palette"] input');
  await page.type('.keyboard-shortcuts-panel input', command);
  await page.waitForFunction(command => document.querySelector('.keyboard-shortcuts-list .is-active')?.textContent.toLowerCase().includes(command), {}, command.toLowerCase());
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => !document.querySelector('.keyboard-shortcuts-panel'));
};
const waitTabs = (page, pane, labels) => page.waitForFunction((pane, labels) => {
  const tabs = [...document.querySelectorAll(`[data-focus-pane="${pane}"] .focus-tab [role="tab"]`)].map(tab => tab.textContent.trim());
  return JSON.stringify(tabs) === JSON.stringify(labels);
}, { timeout: 5000 }, pane, labels).catch(async () => assert.fail(`Pane ${pane} tabs ${JSON.stringify(await tabLabels(page, pane))} are not ${JSON.stringify(labels)}`));

let page, device;
try {
  page = await newPage(1440);
  await page.goto(`${base}/notebooks/work?view=list`, { waitUntil: 'networkidle0' });

  // 1. Normal browsing opens zoom and closing returns to the list.
  await clickRow(page, 'Alpha');
  await page.waitForSelector('.note-editor[data-frame="zoom"]');
  await page.click('[aria-label="Close note"]');
  await page.waitForFunction(() => !document.querySelector('.note-editor'));
  assert.equal(new URL(page.url()).pathname, '/notebooks/work');
  console.log('PASS 1 normal browsing opens zoom and returns to the list');

  // 2. Show (current), dock the list left, use major-left, open three notes, drag one to the top-right pane.
  await page.click('.focus-switcher-menu');
  await menuItem(page, 'Scratch');
  await page.waitForSelector('.focus-area');
  assert.equal(search(page).get('focus'), 'current');
  assert.equal(await page.$eval('.browse-dock', dock => dock.dataset.placement), 'left');
  await chooseDivision(page, 'Large left, two right');
  await page.waitForFunction(() => document.querySelectorAll('[data-focus-pane]').length === 3);
  for (const title of ['Alpha', 'Beta', 'Gamma']) await clickRow(page, title);
  await waitTabs(page, 0, ['Alpha', 'Beta', 'Gamma']);
  assert.equal(await shownTab(page, 0), 'Gamma');
  await page.waitForSelector('[data-focus-pane="0"] .note-editor[data-frame="pane"]');
  await dragTo(page, await browseRow(page, 'Beta'), '[data-focus-pane="1"] .focus-pane-body');
  await waitTabs(page, 1, ['Beta']);
  // A browse-row drag copies: the note stays open in its source pane too.
  await waitTabs(page, 0, ['Alpha', 'Beta', 'Gamma']);
  assert.equal(await activePane(page), 1);
  await shot(page, '1440-major-left');
  console.log('PASS 2 Focus docks the list left, opens rows in the active pane and copies a dropped row into another pane');
  // Closing one pane's copy leaves the note open in the other pane: close/dedupe are pane-scoped.
  await page.click('[data-focus-pane="0"] [aria-label="Close Beta"]');
  await waitTabs(page, 0, ['Alpha', 'Gamma']);
  await waitTabs(page, 1, ['Beta']);
  console.log('PASS 2a closing one pane\'s copy of a cross-pane note leaves the other pane\'s copy open');
  // Closing a tab activated pane 0 (any click inside a pane does); restore pane 1 active before continuing.
  await clickTab(page, 1, 'Beta');
  assert.equal(await activePane(page), 1);

  // Tab-bar drag: a note the target pane already holds is a no-op regardless of the modifier key.
  await dragTo(page, await browseRow(page, 'Alpha'), '[data-focus-pane="1"] .focus-pane-body');
  await waitTabs(page, 1, ['Beta', 'Alpha']);
  await dragTo(page, await tabHandle(page, 0, 'Alpha'), '[data-focus-pane="1"] .focus-pane-body');
  await waitTabs(page, 0, ['Alpha', 'Gamma']);
  await waitTabs(page, 1, ['Beta', 'Alpha']);
  console.log('PASS 2b a tab-bar drag onto a pane that already holds the tab is a no-op, in both panes');
  await page.click('[data-focus-pane="1"] [aria-label="Close Alpha"]');
  await waitTabs(page, 1, ['Beta']);

  // Tab-bar drag without Shift moves the tab out of its source pane.
  await dragTo(page, await tabHandle(page, 0, 'Gamma'), '[data-focus-pane="1"] .focus-pane-body');
  await waitTabs(page, 0, ['Alpha']);
  await waitTabs(page, 1, ['Beta', 'Gamma']);
  console.log('PASS 2c a tab-bar drag without Shift moves the tab out of its source pane');
  await dragTo(page, await tabHandle(page, 1, 'Gamma'), '[data-focus-pane="0"] .focus-pane-body');
  await waitTabs(page, 0, ['Alpha', 'Gamma']);
  await waitTabs(page, 1, ['Beta']);
  await clickTab(page, 1, 'Beta');
  assert.equal(await activePane(page), 1);

  // Tab-bar drag with Shift held copies instead, leaving the source pane's tab in place.
  await dragTo(page, await tabHandle(page, 0, 'Alpha'), '[data-focus-pane="1"] .focus-pane-body', { shift: true });
  await waitTabs(page, 0, ['Alpha', 'Gamma']);
  await waitTabs(page, 1, ['Beta', 'Alpha']);
  console.log('PASS 2d a Shift-held tab-bar drag copies the tab, leaving the source pane unchanged');
  await page.click('[data-focus-pane="1"] [aria-label="Close Alpha"]');
  await waitTabs(page, 1, ['Beta']);

  // 3. Kanban docks above the Focus; a card opens in the active pane.
  await page.click('.desktop-views > button:nth-child(4)');
  await page.waitForFunction(() => document.querySelector('.browse-dock')?.dataset.placement === 'top' && document.querySelector('[data-kanban-columns]'));
  await clickRow(page, 'Delta');
  await waitTabs(page, 1, ['Beta', 'Delta']);
  assert.equal(await shownTab(page, 1), 'Delta');
  await shot(page, '1440-kanban');
  console.log('PASS 3 Kanban docks above the Focus and a card opens in the active pane');

  // 4. A link in the bottom-right pane opens in the most recently used other pane; the source stays visible.
  await dragTo(page, await browseRow(page, 'Delta'), '[data-focus-pane="2"] .focus-pane-body');
  await waitTabs(page, 2, ['Delta']);
  // The browse-row drag copies Delta rather than moving it out of pane 1.
  await waitTabs(page, 1, ['Beta', 'Delta']);
  await page.click('[data-focus-pane="1"] [aria-label="Close Delta"]');
  await waitTabs(page, 1, ['Beta']);
  const link = await page.waitForSelector('[data-focus-pane="2"] [data-workspace-link]');
  await link.click();
  await waitTabs(page, 1, ['Beta', 'Epsilon']);
  assert.equal(await shownTab(page, 1), 'Epsilon');
  assert.equal(await shownTab(page, 2), 'Delta');
  assert(await page.$('[data-focus-pane="2"] .note-editor[data-frame="pane"]'), 'The source note must stay visible');
  // A lane opens as a tab from the pane's + menu and closes again.
  await page.click('[data-focus-pane="2"] .focus-menu-trigger');
  await menuItem(page, 'Pins');
  await waitTabs(page, 2, ['Delta', 'Pins']);
  await page.waitForFunction(() => document.querySelector('[data-focus-pane="2"] .focus-lane')?.textContent.includes('Gamma'));
  await page.click('[data-focus-pane="2"] [aria-label="Close Pins"]');
  await waitTabs(page, 2, ['Delta']);
  console.log('PASS 4 a link opens in the most recently used other pane and lanes open as tabs');

  // 5. Name (current); another device (empty storage) opens it from Screen with its panes and tabs.
  await page.click('.focus-switcher-menu');
  await menuItem(page, 'Name this Focus…');
  await page.waitForSelector('.screen-form input');
  await page.type('.screen-form input', '週報');
  await page.click('.screen-form button[type="submit"]');
  await page.waitForFunction(() => new URL(location.href).searchParams.get('focus') !== 'current');
  const focusId = search(page).get('focus');
  const focusFile = path.join(root, '.github-notes-focus.yaml');
  const saved = async text => {
    for (let attempt = 0; attempt < 50; attempt++) {
      if (fs.existsSync(focusFile) && fs.readFileSync(focusFile, 'utf8').includes(text)) return;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.fail(`${focusFile} does not contain ${text}`);
  };
  await saved('週報');
  const other = await browser.createBrowserContext();
  device = await other.newPage();
  device.on('pageerror', error => errors.push(error.message));
  await device.setViewport({ width: 1440, height: 900 });
  await device.goto(`${base}/screen`, { waitUntil: 'networkidle0' });
  const entry = await device.waitForFunction(() => [...document.querySelectorAll('.focus-list button')].find(button => button.textContent.includes('週報')));
  await entry.asElement().click();
  await device.waitForSelector('.focus-area');
  assert.equal(new URL(device.url()).searchParams.get('focus'), focusId);
  assert.equal(await paneCount(device), 3);
  await waitTabs(device, 0, ['Alpha', 'Gamma']);
  await waitTabs(device, 1, ['Beta', 'Epsilon']);
  await waitTabs(device, 2, ['Delta']);
  console.log('PASS 5 a named Focus is written to the workspace and restores from Screen on another device');

  // 6. Zoom opened from Graph adds a note to the named Focus's left pane and stays open.
  await device.goto(`${base}/notebooks/work/notes/zeta.md?returnTo=${encodeURIComponent('/graph?notebook=work')}`, { waitUntil: 'networkidle0' });
  await device.waitForSelector('.note-editor[data-frame="zoom"]');
  await device.click('.note-editor[data-frame="zoom"] [aria-label="Add to Focus"]');
  await device.waitForSelector('.focus-add-dialog .focus-division-thumbnail');
  await chooseSelect(device, '.focus-add-dialog .select-trigger', focusId);
  await device.click('.focus-add-dialog .focus-division-thumbnail > button:nth-child(1)');
  await device.click('.focus-add-dialog button[type="submit"]');
  await device.waitForSelector('.focus-add-dialog [role="status"]');
  await device.waitForFunction(() => !document.querySelector('.focus-add-dialog'), { timeout: 3000 });
  assert(await device.$('.note-editor[data-frame="zoom"]'), 'Zoom must stay open after adding to Focus');
  await saved('notes/work/zeta.md');
  console.log('PASS 6 Add to Focus from a Graph zoom places the note in the chosen pane and zoom stays open');

  // 7. Phones show one pane whose tab list holds every pane's tabs; tablets two; desktops restore all three.
  await device.click('[aria-label="Close note"]');
  const widths = { 412: [['Alpha', 'Gamma', 'Zeta', 'Beta', 'Epsilon', 'Delta']], 900: [['Alpha', 'Gamma', 'Zeta'], ['Beta', 'Epsilon', 'Delta']], 1440: [['Alpha', 'Gamma', 'Zeta'], ['Beta', 'Epsilon'], ['Delta']] };
  for (const [width, panes] of Object.entries(widths)) {
    await device.setViewport({ width: Number(width), height: 900 });
    await device.goto(`${base}/notebooks/work?view=list&focus=${focusId}`, { waitUntil: 'networkidle0' });
    await device.waitForSelector('.focus-area');
    assert.equal(await paneCount(device), panes.length, `${width}px shows ${panes.length} panes`);
    const displayed = await device.$$eval('[data-focus-pane]', elements => elements.map(element => Number(element.dataset.focusPane)));
    for (const [index, labels] of panes.entries()) await waitTabs(device, displayed[index], labels);
    assert(!await device.evaluate(() => document.documentElement.scrollWidth > innerWidth), `Horizontal overflow at ${width}px`);
    await shot(device, `${width}`);
    if (width === '412') {
      assert(await device.$(`[data-focus-pane="${displayed[0]}"] [aria-label="All tabs in this pane"]`), 'Overflowing tabs must offer the all-tabs menu');
      await device.click('[aria-label="Show browse panel"]');
      await clickRow(device, 'Alpha');
      await device.waitForFunction(() => document.querySelector('.focus-area') && !document.querySelector('.browse-dock-scroll'));
      assert.equal(await shownTab(device, displayed[0]), 'Alpha');
    }
  }
  console.log('PASS 7 narrow widths fold panes for display only and desktops restore the division');

  // 7a. A merged displayed pane (narrow screens folding several stored panes into one tab bar) keeps a duplicate
  // tab per stored pane when they share a note, marks only the shown one, and closes only the one touched.
  await device.setViewport({ width: 1440, height: 900 });
  await dragTo(device, await tabHandle(device, 2, 'Delta'), '[data-focus-pane="1"] .focus-pane-body', { shift: true });
  await waitTabs(device, 1, ['Beta', 'Epsilon', 'Delta']);
  await waitTabs(device, 2, ['Delta']);
  await device.setViewport({ width: 900, height: 900 });
  await device.waitForFunction(() => document.querySelectorAll('[data-focus-pane]').length === 2);
  const merged7a = (await device.$$eval('[data-focus-pane]', elements => elements.map(element => Number(element.dataset.focusPane))))[1];
  await waitTabs(device, merged7a, ['Beta', 'Epsilon', 'Delta', 'Delta']);
  const deltaPanes = await device.$$eval(`[data-focus-pane="${merged7a}"] .focus-tab`, tabs => tabs
    .filter(tab => tab.querySelector('[role="tab"]').textContent.trim() === 'Delta').map(tab => tab.dataset.pane));
  assert.deepEqual(deltaPanes.sort(), ['1', '2'], 'Each duplicate Delta tab keeps its own stored pane');
  const shownDeltaCount = await device.$$eval(`[data-focus-pane="${merged7a}"] .focus-tab [role="tab"][aria-selected="true"]`,
    tabs => tabs.filter(tab => tab.textContent.trim() === 'Delta').length);
  assert.equal(shownDeltaCount, 1, 'Only one of the duplicate Delta tabs is marked shown');
  await device.click(`[data-focus-pane="${merged7a}"] .focus-tab[data-pane="1"] [aria-label="Close Delta"]`);
  await waitTabs(device, merged7a, ['Beta', 'Epsilon', 'Delta']);
  console.log('PASS 7a a merged displayed pane keeps a duplicate tab per stored pane and closes only the one touched');
  await device.setViewport({ width: 1440, height: 900 });
  await device.waitForFunction(() => document.querySelectorAll('[data-focus-pane]').length === 3);
  await waitTabs(device, 1, ['Beta', 'Epsilon']);
  await waitTabs(device, 2, ['Delta']);

  // 8. The rest of the contract on the desktop device.
  const focusUrl = `${base}/notebooks/work?view=list&focus=${focusId}`;
  const workFile = name => fs.readFileSync(path.join(root, `notes/work/${name}.md`), 'utf8');
  const waitFile = async (name, text) => {
    for (let attempt = 0; attempt < 100; attempt++) { if (workFile(name).includes(text)) return; await new Promise(resolve => setTimeout(resolve, 100)); }
    assert.fail(`notes/work/${name}.md does not contain ${text}`);
  };
  // Naming moved the layout out of (current), which starts as one empty pane with a hint.
  await page.goto(`${base}/notebooks/work?view=list&focus=current`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.focus-area');
  assert.equal(await paneCount(page), 1);
  assert.deepEqual(await tabLabels(page, 0), []);
  await page.waitForFunction(() => document.querySelector('[data-focus-pane="0"] .focus-pane-empty')?.textContent.includes('drag one here'));
  console.log('PASS 8 (current) is empty after naming and its empty pane shows the hint');

  // A note edited in zoom reopens in a pane with the saved text, not an earlier cached copy.
  await clickRow(page, 'Alpha');
  await page.waitForSelector('[data-focus-pane="0"] .note-editor[data-frame="pane"] .cm-content');
  await page.click('[data-focus-pane="0"] [aria-label="Close Alpha"]');
  await page.waitForFunction(() => !document.querySelector('[data-focus-pane="0"] .focus-tab'));
  await (await (await browseRow(page, 'Alpha')).asElement().$('[aria-label="Open in zoom"]')).click();
  await page.waitForSelector('.note-editor[data-frame="zoom"] .cm-content');
  await clickEnd(page, '.note-editor[data-frame="zoom"]', 'Alpha body.');
  await page.keyboard.type(' saved in zoom');
  await waitFile('alpha', 'Alpha body. saved in zoom');
  await page.click('[aria-label="Close note"]');
  await page.waitForFunction(() => !document.querySelector('.note-editor[data-frame="zoom"]'));
  await clickRow(page, 'Alpha');
  await page.waitForFunction(() => document.querySelector('[data-focus-pane="0"] .note-editor[data-frame="pane"] .cm-content')?.textContent.includes('saved in zoom'), { timeout: 5000 });
  console.log('PASS 8 a pane reopens a note with the text saved in zoom');

  // Batch add fills a pane from a folder or a tag filter, deduplicated against what it already holds.
  await page.click('[data-focus-pane="0"] [aria-label="Add matching"]');
  await page.waitForSelector('.focus-batch-dialog');
  await page.click('.focus-batch-dialog .screen-form > .filter-check input[type="checkbox"]');
  await chooseSelect(page, '.focus-batch-folder .select-trigger', 'notes/work/sub');
  await page.waitForFunction(() => document.querySelector('.focus-batch-dialog .filter-results')?.textContent.includes('1 matching'));
  await page.click('.focus-batch-dialog button[type="submit"]');
  await page.waitForFunction(() => document.querySelector('.focus-batch-dialog [role="status"]')?.textContent.includes('1 added, 0 already present'));
  await page.click('.focus-batch-dialog button[type="button"]');
  await page.waitForFunction(() => !document.querySelector('.focus-batch-dialog'));
  await waitTabs(page, 0, ['Alpha', 'Omega']);
  console.log('PASS 8i batch add by folder with subfolders excluded adds only its direct notes');

  await page.click('[data-focus-pane="0"] [aria-label="Add matching"]');
  await page.waitForSelector('.focus-batch-dialog');
  await chooseSelect(page, '.focus-batch-folder .select-trigger', 'notes/work/sub');
  await page.waitForFunction(() => document.querySelector('.focus-batch-dialog .filter-results')?.textContent.includes('2 matching'));
  await page.click('.focus-batch-dialog button[type="submit"]');
  await page.waitForFunction(() => document.querySelector('.focus-batch-dialog [role="status"]')?.textContent.includes('1 added, 1 already present'));
  await page.click('.focus-batch-dialog button[type="button"]');
  await page.waitForFunction(() => !document.querySelector('.focus-batch-dialog'));
  await waitTabs(page, 0, ['Alpha', 'Omega', 'Deep']);
  console.log('PASS 8j batch add by folder including subfolders adds the nested note, skipping what is already present');

  await page.click('[data-focus-pane="0"] [aria-label="Add matching"]');
  await page.waitForSelector('.focus-batch-dialog');
  await clickTagOption(page, 'project');
  await page.waitForFunction(() => document.querySelector('.focus-batch-dialog .filter-results')?.textContent.includes('3 matching'));
  await page.click('.focus-batch-dialog button[type="submit"]');
  await page.waitForFunction(() => document.querySelector('.focus-batch-dialog [role="status"]')?.textContent.includes('1 added, 2 already present'));
  await page.click('.focus-batch-dialog button[type="button"]');
  await page.waitForFunction(() => !document.querySelector('.focus-batch-dialog'));
  await waitTabs(page, 0, ['Alpha', 'Omega', 'Deep', 'Gamma']);
  console.log('PASS 8k batch add by tag adds every match, reporting what was already present');

  await page.click('[data-focus-pane="0"] [aria-label="Add matching"]');
  await page.waitForSelector('.focus-batch-dialog');
  await clickTagOption(page, 'project');
  await page.click('.focus-batch-dialog button[type="submit"]');
  await page.waitForFunction(() => document.querySelector('.focus-batch-dialog [role="status"]')?.textContent.includes('0 added, 3 already present'));
  await page.click('.focus-batch-dialog button[type="button"]');
  await page.waitForFunction(() => !document.querySelector('.focus-batch-dialog'));
  await waitTabs(page, 0, ['Alpha', 'Omega', 'Deep', 'Gamma']);
  console.log('PASS 8l a repeat batch add over the same filter adds nothing');

  // Local view state follows in another tab of the same browser and survives a reload.
  const twin = await other.newPage();
  twin.on('pageerror', error => errors.push(error.message));
  await twin.setViewport({ width: 1440, height: 900 });
  await twin.goto(focusUrl, { waitUntil: 'networkidle0' });
  await twin.waitForSelector('.focus-area');
  // Only the front tab paints; the twin, now behind, is polled on a timer.
  await device.bringToFront();
  await clickTab(device, 1, 'Epsilon');
  await clickTab(device, 2, 'Delta');
  await twin.waitForFunction(() => document.querySelector('[data-focus-pane][data-active]')?.dataset.focusPane === '2'
    && document.querySelector('[data-focus-pane="1"] [role="tab"][aria-selected="true"]')?.textContent.trim() === 'Epsilon', { polling: 100 });
  await twin.close();
  await device.reload({ waitUntil: 'networkidle0' });
  await device.waitForSelector('.focus-area');
  assert.equal(await activePane(device), 2);
  assert.equal(await shownTab(device, 1), 'Epsilon');
  console.log('PASS 8a the active pane and shown tabs follow in another tab and are restored after a reload');

  // A pane editor autosaves; zoom from its tab shares the same editor and returns to the pane.
  const paneEditor = '[data-focus-pane="2"] .note-editor[data-frame="pane"]';
  await device.waitForSelector(paneEditor);
  await clickEnd(device, paneEditor, 'Delta body.');
  await device.keyboard.type(' typed');
  await waitFile('delta', 'Delta body. typed');
  const editorCount = await device.$$eval('.note-editor', editors => editors.length);
  await device.click('[data-focus-pane="2"] .focus-pane-actions [aria-label="Open in zoom"]');
  await device.waitForSelector('.note-editor[data-frame="zoom"]');
  assert.equal(await device.$$eval('.note-editor', editors => editors.length), editorCount, 'Zoom must borrow the pane editor');
  assert.equal(await device.$('[data-focus-pane="2"] .note-editor'), null, 'The pane lends its editor to zoom');
  await device.keyboard.press('Escape');
  await new Promise(resolve => setTimeout(resolve, 300));
  assert(await device.$('.note-editor[data-frame="zoom"]'), 'Esc must not close zoom');
  await clickEnd(device, '.note-editor[data-frame="zoom"]', 'typed');
  await device.keyboard.type(' zoomed');
  await device.click('[aria-label="Close note"]');
  await device.waitForSelector(paneEditor);
  assert(await device.$eval(paneEditor, editor => editor.textContent.includes('typed zoomed')), 'The pane must keep the edit made in zoom');
  assert.equal(new URL(device.url()).searchParams.get('focus'), focusId);
  await waitFile('delta', 'typed zoomed');
  console.log('PASS 8b pane editors autosave and zoom from a tab edits the same session');

  // The rail follows the active pane's note and disables the document tools for a lane tab.
  await device.click('.right-panel-rail [aria-label="Outline"]');
  await device.waitForFunction(() => document.querySelector('.right-panel-document .note-document-panel[data-frame="rail"]')?.textContent.includes('Delta'));
  await device.$eval('.right-panel', panel => Promise.all(panel.getAnimations({ subtree: true }).map(animation => animation.finished)));
  await device.click('[data-focus-pane="2"] .focus-menu-trigger');
  await menuItem(device, 'Pins');
  await device.waitForFunction(() => document.querySelector('.right-panel-rail [aria-label="Outline"]').disabled && !document.querySelector('.right-panel-document'));
  await device.click('[data-focus-pane="2"] [aria-label="Close Pins"]');
  await device.waitForFunction(() => document.querySelector('.right-panel-document .note-document-panel[data-frame="rail"]')?.textContent.includes('Delta'));
  console.log('PASS 8c the rail shows the active note’s document panel and disables it for lanes');

  // Browse rows: a note already open in another pane opens a fresh copy in the active pane, not a jump to it.
  await clickRow(device, 'Beta');
  await waitTabs(device, 2, ['Delta', 'Beta']);
  assert.equal(await activePane(device), 2);
  assert.equal(await shownTab(device, 2), 'Beta');
  await waitTabs(device, 1, ['Beta', 'Epsilon']);
  console.log('PASS 8d a browse row for a note open elsewhere opens a fresh copy in the active pane, not a jump to it');
  // A repeat click for a note already open in the SAME pane switches to it instead of adding another copy.
  await clickRow(device, 'Delta');
  await waitTabs(device, 2, ['Delta', 'Beta']);
  assert.equal(await shownTab(device, 2), 'Delta');
  console.log('PASS 8d a repeat click for a note already open in the active pane switches to it without duplicating it');
  // Clean up the pane-2 copy so later panes keep their original contents; the row zoom button leaves the Focus unchanged.
  await device.click('[data-focus-pane="2"] [aria-label="Close Beta"]');
  await waitTabs(device, 2, ['Delta']);
  const beta = await browseRow(device, 'Beta');
  await (await beta.asElement().$('[aria-label="Open in zoom"]')).click();
  await device.waitForSelector('.note-editor[data-frame="zoom"]');
  await device.click('[aria-label="Close note"]');
  await device.waitForFunction(() => !document.querySelector('.note-editor[data-frame="zoom"]'));
  await waitTabs(device, 1, ['Beta', 'Epsilon']);
  console.log('PASS 8d the row zoom button leaves the Focus unchanged');

  // Tabs reorder within a pane; the browse panel collapses and expands.
  await dragTo(device, await tabHandle(device, 0, 'Zeta'), await tabHandle(device, 0, 'Alpha'));
  await waitTabs(device, 0, ['Zeta', 'Alpha', 'Gamma']);
  await device.click('[aria-label="Collapse browse panel"]');
  await device.waitForFunction(() => !document.querySelector('.browse-dock-scroll'));
  await device.click('[aria-label="Expand browse panel"]');
  await device.waitForSelector('.browse-dock-scroll');
  console.log('PASS 8e tabs reorder within a pane and the browse panel collapses and expands');

  // Other notebooks' notes only open in zoom and cannot be dragged.
  await device.goto(`${focusUrl}&allNotebooks=true`, { waitUntil: 'networkidle0' });
  const outside = await browseRow(device, 'Outside');
  assert.equal(await outside.evaluate(row => row.getAttribute('draggable')), 'false');
  await clickRow(device, 'Outside');
  await device.waitForSelector('.note-editor[data-frame="zoom"]');
  await device.click('[aria-label="Close note"]');
  await device.waitForFunction(() => !document.querySelector('.note-editor[data-frame="zoom"]'));
  assert(!(await tabLabels(device, 0)).includes('Outside'));
  console.log('PASS 8f notes of other notebooks open in zoom only');

  // Palette commands act on the displayed Focus; a smaller division appends removed panes' tabs to the last pane.
  await device.goto(focusUrl, { waitUntil: 'networkidle0' });
  await device.waitForSelector('.focus-area');
  const before = await activePane(device);
  await palette(device, 'Next pane');
  await device.waitForFunction(before => Number(document.querySelector('[data-focus-pane][data-active]')?.dataset.focusPane) === (before + 1) % 3, {}, before);
  // Delta, shared by pane 1 and pane 2 ahead of the fold, must survive the fold only once.
  await dragTo(device, await tabHandle(device, 2, 'Delta'), '[data-focus-pane="1"] .focus-pane-body', { shift: true });
  await waitTabs(device, 1, ['Beta', 'Epsilon', 'Delta']);
  await palette(device, 'Division: Single');
  await device.waitForFunction(() => document.querySelector('.focus-area')?.dataset.division === 'single');
  await waitTabs(device, 0, ['Zeta', 'Alpha', 'Gamma', 'Beta', 'Epsilon', 'Delta']);
  console.log('PASS 8g1 folding a division dedupes a note shared by two folded panes, keeping the first occurrence');
  await palette(device, 'Division: Large left, two right');
  await device.waitForFunction(() => document.querySelectorAll('[data-focus-pane]').length === 3);
  await waitTabs(device, 0, ['Zeta', 'Alpha', 'Gamma', 'Beta', 'Epsilon', 'Delta']);
  console.log('PASS 8g palette commands move between panes and change the division without restoring tabs');

  // Rename and delete a named Focus; deleting keeps the notes.
  await device.click('.focus-switcher-menu');
  await menuItem(device, 'Rename…');
  await device.waitForSelector('.screen-form input');
  await device.$eval('.screen-form input', input => input.select());
  await device.type('.screen-form input', '月報');
  await device.click('.screen-form button[type="submit"]');
  await saved('月報');
  await device.click('.focus-switcher-menu');
  await menuItem(device, 'Delete…');
  const remove = await device.waitForFunction(() => [...document.querySelectorAll('.workspace-dialog-actions button')].find(button => button.textContent.trim() === 'Delete'));
  await remove.asElement().click();
  await device.waitForFunction(() => !new URL(location.href).searchParams.has('focus') && !document.querySelector('.focus-area'));
  for (let attempt = 0; attempt < 50 && fs.readFileSync(focusFile, 'utf8').includes('月報'); attempt++) await new Promise(resolve => setTimeout(resolve, 100));
  assert(!fs.readFileSync(focusFile, 'utf8').includes('月報'), 'The deleted Focus must leave the Focus file');
  assert(fs.existsSync(path.join(root, 'notes/work/delta.md')), 'Deleting a Focus keeps its notes');
  console.log('PASS 8h a named Focus renames and deletes without touching its notes');
} catch (error) {
  if (page) await shot(page, 'failure').catch(() => {});
  if (device) await shot(device, 'failure-device').catch(() => {});
  throw error;
} finally {
  await browser.close();
  server.close();
  fs.rmSync(root, { recursive: true, force: true });
}
if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1; }
