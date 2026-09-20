import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { resolveQaChromePath } from './qa-chrome.mjs';
import { assertFreshBuild } from './lib/require-fresh-build.mjs';
const product = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
assertFreshBuild(product);
fs.mkdirSync(path.join(product, 'artifacts/qa'), { recursive: true });
const require = createRequire(`${product}/apps/web/package.json`);
const puppeteer = require('puppeteer-core'), { stringify, parse } = require('yaml');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'notes-graph-editing-'));
const write = (name, value) => {
  fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
  fs.writeFileSync(path.join(root, name), value);
};
write('.github-notes.yaml', stringify({ schema_version: 1, workspace: { title: '關聯圖試用', default_notebook: 'a' }, notebooks: [{ id: 'a', title: '研究', root: 'notes/a' }, { id: 'b', title: '案例', root: 'notes/b' }] }));
const fixtures = [['notes/a/a.md', 'Alpha', '第一則筆記。'], ['notes/a/b.md', 'Beta', '第二則筆記。'], ['notes/b/c.md', '中文案例', '案例內容。'], ['notes/b/d.md', 'Delta', '其他案例。']];
for (const [file, title, body] of fixtures) write(file, `---\ntitle: ${title}\ntags: [research]\n---\n${body}\n`);
write('.github-notes-screen.yaml', stringify({ version: 1, rows: [{ id: 'dynamic', name: '動態研究', kind: 'dynamic', view: 'small', source: { kind: 'tag', tag: 'research' } }, { id: 'mixed', name: '筆記與附件', kind: 'custom', view: 'small', items: [{ id: 'ma', kind: 'note', path: 'notes/a/a.md', notebookId: 'a' }, { id: 'mf', kind: 'folder', path: 'notes/b', notebookId: 'b' }] }] }));
for (const args of [['init', '-b', 'main'], ['config', 'user.name', 'Graph QA'], ['config', 'user.email', 'qa@example.com'], ['add', '.'], ['commit', '-m', 'fixture']]) execFileSync('git', args, { cwd: root, stdio: 'pipe' });
process.env.MYGITNOTES_SOURCE = 'local';
process.env.MYGITNOTES_LOCAL_PATH = root;
delete process.env.VERCEL;
delete process.env.APP_URL;
const { createApp } = await import(`${product}/apps/local-server/dist/app.js`);
const server = createServer(createApp(product));
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await puppeteer.launch({ executablePath: resolveQaChromePath('GRAPH_QA_CHROME'), headless: true, pipe: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage(), errors = [];
page.on('pageerror', error => errors.push(error.message));
await page.evaluateOnNewDocument(() => localStorage.setItem('github-notes:language', 'en'));
await page.setViewport({ width: 1500, height: 1050 });
const click = async (text, within = '') => {
  const elements = await page.$$(`${within} button`);
  for (const element of elements) {
    if (await element.evaluate((el, text) => (el.textContent.trim() === text || el.getAttribute('aria-label') === text) && !el.disabled, text)) {
      await element.click();
      return;
    }
  }
  throw Error('Missing button ' + text);
};
const cardA = '[data-graph-note="notes/a/a.md"]', cardB = '[data-graph-note="notes/a/b.md"]';
const setMode = async (card, mode) => {
  const toggle = await page.$(card + ' [data-mode-toggle]');
  if (await toggle.evaluate(el => el.dataset.modeToggle) !== mode) await toggle.click();
};
const go = async route => {
  await page.goto(base + route, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.graph-page-container');
};
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const waitFile = async (file, text, present = true) => {
  for (let i = 0; i < 80; i++) {
    if (fs.readFileSync(path.join(root, file), 'utf8').includes(text) === present) return;
    await pause(100);
  }
  throw Error(`${present ? 'Missing' : 'Lingering'} saved content ${file}: ${text}`);
};
// The editor's own undo binds Mod-z, which is Command on macOS.
const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
const chord = async (keys, ...modifiers) => {
  for (const key of modifiers) await page.keyboard.down(key);
  await page.keyboard.press(keys);
  for (const key of [...modifiers].reverse()) await page.keyboard.up(key);
};
const clickRow = async title => {
  const row = await page.evaluateHandle(title => [...document.querySelectorAll('.workspace-scroll :is(.note-list tbody tr, [data-notepath], .cursor-pointer.rounded-xl)')].find(row => row.textContent.includes(title)), title);
  assert(row.asElement(), `Browse row ${title} is missing`);
  const label = await row.evaluateHandle((row, title) => [...row.querySelectorAll('*')].reverse().find(el => el.textContent.trim() === title), title);
  await (label.asElement() ?? row.asElement()).click();
};
const menuItem = async label => {
  const item = await page.waitForFunction(label => [...document.querySelectorAll('.focus-menu [role^="menuitem"]')].find(item => item.textContent.trim() === label), {}, label);
  await item.asElement().click();
};
try {
  await go('/graph?notebook=all');
  await page.waitForFunction(() => document.querySelector('[data-graph-nodes]')?.dataset.graphNodes === '4');
  await click('Select notes (0)');
  await page.click('.graph-note-selector label:nth-child(1) input');
  await page.click('.graph-note-selector label:nth-child(2) input');
  await click('Select notes (2)');
  await click('Expand notes');
  await page.waitForSelector(cardA + ' .cm-content');
  await page.waitForSelector(cardB + ' .cm-content');
  assert.equal(await page.$$eval('[data-graph-note]', cards => cards.length), 2);
  assert.equal(await page.$eval(cardA, el => getComputedStyle(el).animationName), 'graph-note-enter');
  await page.click('button[aria-label="Reset view"]');
  await pause(500);
  const expandedBounds = await page.$$eval('[data-graph-note]', cards =>
    cards.map(card => {
      const r = card.getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
    }));
  assert(expandedBounds[0].right <= expandedBounds[1].left || expandedBounds[1].right <= expandedBounds[0].left || expandedBounds[0].bottom <= expandedBounds[1].top || expandedBounds[1].bottom <= expandedBounds[0].top);
  await page.screenshot({ path: `${product}/artifacts/qa/graph-initial.png` });
  console.log('PASS selection and two expanded note nodes');
  await setMode(cardA, 'raw');
  await page.click(cardA + ' textarea');
  await page.keyboard.down('Control');
  await page.keyboard.press('KeyA');
  await page.keyboard.up('Control');
  await page.keyboard.type('Alpha edited. ');
  await setMode(cardB, 'raw');
  await page.click(cardB + ' textarea');
  await page.keyboard.down('Control');
  await page.keyboard.press('KeyA');
  await page.keyboard.up('Control');
  await page.keyboard.type('Beta edited.');
  await waitFile('notes/a/a.md', 'Alpha edited.');
  await waitFile('notes/a/b.md', 'Beta edited.');
  console.log('PASS independent saves to both notes');
  // The card carries the editor's status: saved to disk, still uncommitted in the working tree, as zoom reports it.
  await page.waitForFunction(card => document.querySelector(card + ' .note-compact-status')?.dataset.state === 'pending', {}, cardA);
  assert.equal(await page.$eval(cardA + ' .note-compact-status', el => el.textContent), 'Uncommitted Changes');
  // A connection inserts through the card's editor, so the editor's own history undoes it.
  await setMode(cardA, 'live');
  await page.waitForSelector(cardA + ' .cm-content');
  const connector = await page.$(cardA + ' button[aria-label="Drag to connect, or click to choose a note"]'), target = await page.$(cardB + ' .graph-note-title');
  const a = await connector.boundingBox(), b = await target.boundingBox();
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 12 });
  await page.mouse.up();
  await waitFile('notes/a/a.md', '[Beta](b.md)');
  assert(!fs.readFileSync(path.join(root, 'notes/a/b.md'), 'utf8').includes('[Alpha]'));
  console.log('PASS pointer connection writes only its source');
  // Undo and redo autosave like any edit; the redone link is read from disk because the live editor renders it as a chip once the caret leaves it.
  await page.focus(cardA + ' .cm-content');
  await chord('KeyZ', mod);
  assert(!await page.$eval(cardA + ' .cm-content', el => el.textContent.includes('[Beta](b.md)')));
  await waitFile('notes/a/a.md', '[Beta](b.md)', false);
  await chord('KeyZ', mod, 'Shift');
  await waitFile('notes/a/a.md', '[Beta](b.md)');
  console.log('PASS connection undo and redo');
  await setMode(cardA, 'raw');
  await page.waitForSelector(cardA + ' textarea');
  await page.click(cardA + ' textarea');
  await page.keyboard.press('End');
  await page.keyboard.type('\n[example](中文');
  // Candidates are debounced; wait until the list reflects the typed query before accepting.
  await page.waitForFunction(card => document.querySelector(card + ' .note-source-completions [role="option"]')?.textContent.startsWith('中文案例'), {}, cardA);
  await page.keyboard.press('Enter');
  await waitFile('notes/a/a.md', '[example](../b/c.md)');
  console.log('PASS source-mode Chinese note completion');
  await setMode(cardA, 'live');
  await page.focus(cardA + ' .cm-content');
  await page.keyboard.down('Control');
  await page.keyboard.press('End');
  await page.keyboard.up('Control');
  await page.keyboard.type('\n[delta](Delta');
  await page.waitForFunction(() => document.querySelector('.cm-tooltip-autocomplete')?.textContent.includes('Delta'));
  await pause(200);
  await page.keyboard.press('Enter');
  await waitFile('notes/a/a.md', '[delta](../b/d.md)');
  console.log('PASS live-mode note completion');
  await click('Save as lane');
  await page.waitForSelector('dialog[open]');
  await page.type('input[aria-label="Swimlane name"]', 'Graph selection');
  await click('Save as lane', 'dialog[open]');
  let saved;
  for (let i = 0; i < 60; i++) {
    saved = parse(fs.readFileSync(path.join(root, '.github-notes-screen.yaml'), 'utf8')).rows.find(row => row.name === 'Graph selection');
    if (saved) break;
    await pause(100);
  }
  assert(saved);
  assert.equal(saved.items.length, 2);
  assert.equal(saved.graph.nodes.filter(n => n.expanded).length, 2);
  await go('/graph?notebook=all&lanes=' + saved.id);
  await page.waitForSelector(cardA);
  assert.equal(await page.$$eval('[data-graph-note]', cards => cards.length), 2);
  await click('Select notes (0)');
  await page.click('.graph-note-selector label:nth-child(1) input');
  await click('Select notes (1)');
  await click('Collapse notes');
  assert.equal(await page.$$eval('.graph-card-position.is-closing', cards => cards.length), 1);
  assert.equal(await page.$eval('.graph-card-position.is-closing .graph-note-card', el => getComputedStyle(el).animationName), 'graph-note-exit');
  await page.$eval('.graph-card-position.is-closing .graph-note-card', el => el.getAnimations().forEach(animation => animation.pause()));
  await pause(260);
  assert.equal(await page.$$eval('.graph-card-position.is-closing', els => els.length), 1, 'Keep closing card mounted until its animation actually finishes');
  await page.$eval('.graph-card-position.is-closing .graph-note-card', el => el.getAnimations().forEach(animation => animation.finish()));
  await page.waitForFunction(() => document.querySelectorAll('[data-graph-note]').length === 1);
  assert.equal(await page.$$eval('[data-graph-note]', cards => cards.length), 1);
  const collapsedLayoutA = saved.graph.nodes.find(node => node.path === 'notes/a/a.md'), collapsedLayoutB = saved.graph.nodes.find(node => node.path === 'notes/a/b.md');
  const collapsedCardB = await (await page.$(cardB)).boundingBox(), collapsedScale = collapsedCardB.width / (collapsedLayoutB.width || 360);
  const collapsedAlpha = { x: collapsedCardB.x + collapsedCardB.width / 2 + (collapsedLayoutA.x - collapsedLayoutB.x) * collapsedScale, y: collapsedCardB.y + collapsedCardB.height / 2 + (collapsedLayoutA.y - collapsedLayoutB.y) * collapsedScale };
  await page.mouse.move(collapsedAlpha.x, collapsedAlpha.y);
  await page.waitForSelector('.graph-hover-expand');
  const expandButton = await (await page.$('.graph-hover-expand')).boundingBox();
  await page.$eval('canvas', (canvas, point) => canvas.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, clientX: point.x, clientY: point.y })), { x: expandButton.x - 15, y: expandButton.y + 14 });
  await page.waitForSelector(cardA);
  console.log('PASS double-click expands a collapsed note node');
  await page.click(cardA + ' button[aria-label="Collapse notes"]');
  await page.waitForFunction(() => document.querySelectorAll('[data-graph-note]').length === 1);
  console.log('PASS save selected membership, restore layout, collapse independently');
  // Items 36–37: a graph card, a Focus pane and zoom edit one note through one mounted editor and one draft.
  // The lane keeps the saved layout, so Beta is the card still expanded inside the pane.
  await page.goto(base + '/notebooks/a?view=list', { waitUntil: 'networkidle0' });
  await page.click('.focus-switcher-main');
  await page.waitForSelector('.focus-area');
  await page.click('.focus-division-trigger');
  await menuItem('Left and right');
  await page.waitForFunction(() => document.querySelectorAll('[data-focus-pane]').length === 2);
  await clickRow('Beta');
  await page.waitForSelector('[data-focus-pane="0"] .note-editor[data-frame="pane"]');
  await page.click('[data-focus-pane="1"] .focus-menu-trigger');
  await menuItem('Graph selection');
  const laneCardB = '[data-focus-pane="1"] ' + cardB;
  await page.waitForSelector(laneCardB + ' .note-preview');
  assert.equal(await page.$$eval('.note-editor', els => els.length), 1, 'One editor for a note shown in a pane and a card');
  // The card scales in while the lane camera settles on its fit; its controls are clickable once both stop moving.
  await page.$eval(laneCardB, el => Promise.all(el.getAnimations({ subtree: true }).map(animation => animation.finished)));
  await page.waitForFunction(
    card => {
      const r = document.querySelector(card).getBoundingClientRect(), key = [r.x, r.y, r.width].map(Math.round).join();
      const held = window.__cardRect === key;
      window.__cardRect = key;
      return held;
    },
    { polling: 200 },
    laneCardB,
  );
  await click('Edit here', laneCardB);
  await page.waitForSelector(laneCardB + ' .note-editor[data-frame="compact"]');
  await page.waitForSelector('[data-focus-pane="0"] .note-preview');
  assert.equal(await page.$$eval('.note-editor', els => els.length), 1, 'Claiming moves the one editor into the card');
  await setMode(laneCardB, 'live');
  await page.waitForSelector(laneCardB + ' .cm-content');
  await page.click(laneCardB + ' .cm-content');
  await chord('End', 'Control');
  await page.keyboard.type('\nShared draft.');
  assert.equal(await page.$eval(laneCardB + ' .note-compact-status', el => el.dataset.state), 'pending');
  await page.click('[data-focus-pane="0"] .focus-pane-actions [aria-label="Open in zoom"]');
  await page.waitForSelector('.note-editor[data-frame="zoom"]');
  assert.equal(await page.$$eval('.note-editor', els => els.length), 1, 'Zoom borrows the card editor instead of mounting another');
  assert(await page.$eval('.note-editor[data-frame="zoom"] .cm-content', el => el.textContent.includes('Shared draft.')), 'Zoom shows the card draft');
  await page.click('.note-editor[data-frame="zoom"] .cm-content');
  await chord('End', 'Control');
  await page.keyboard.type('\nZoom edit.');
  await page.click('[aria-label="Close note"]');
  await page.waitForSelector(laneCardB + ' .note-editor[data-frame="compact"]');
  assert(await page.$eval(laneCardB + ' .cm-content', el => el.textContent.includes('Zoom edit.')), 'The card keeps the zoom edit');
  await waitFile('notes/a/b.md', 'Shared draft.');
  await waitFile('notes/a/b.md', 'Zoom edit.');
  console.log('PASS graph card, Focus pane and zoom share one editor and one draft');
  await page.goto(base + '/screen', { waitUntil: 'networkidle0' });
  await page.waitForSelector('#screen-lane-' + saved.id + ' .graph-page-container');
  await page.click('#screen-lane-dynamic button[aria-label="Graph"]');
  await page.waitForSelector('#screen-lane-dynamic .graph-page-container');
  // The version 1 all-notebook tag lane migrates into default notebook a.
  await page.waitForSelector('#screen-lane-dynamic [data-graph-nodes="2"]');
  await page.click('#screen-lane-mixed button[aria-label="Graph"]');
  await page.waitForSelector('#screen-lane-mixed [data-graph-nodes="1"]');
  console.log('PASS embedded custom/dynamic lane graphs and non-note exclusion');
  await go('/graph?notebook=all&lanes=' + saved.id);
  await page.setViewport({ width: 390, height: 844 });
  await pause(300);
  assert(await page.$('.graph-selection-toolbar'));
  await page.setViewport({ width: 1500, height: 1050 });
  await go('/graph?notebook=all&lanes=' + saved.id);
  await page.waitForSelector(cardB);
  await page.click('button[aria-label="Reset view"]');
  await pause(400);
  const beforeMove = await (await page.$(cardB)).boundingBox(), header = await (await page.$(cardB + ' .graph-note-title')).boundingBox();
  await page.mouse.move(header.x + 20, header.y + header.height / 2);
  await page.mouse.down();
  await page.mouse.move(header.x + 100, header.y + header.height / 2 + 40, { steps: 8 });
  await page.mouse.up();
  await pause(200);
  const afterMove = await (await page.$(cardB)).boundingBox();
  assert(Math.abs(afterMove.x - beforeMove.x - 80) < 5);
  assert(Math.abs(afterMove.y - beforeMove.y - 40) < 5);
  const handle = await (await page.$(cardB + ' .graph-card-resize')).boundingBox();
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle.x + handle.width / 2 + 60, handle.y + handle.height / 2 + 40, { steps: 8 });
  await page.mouse.up();
  await pause(200);
  const afterResize = await (await page.$(cardB)).boundingBox();
  assert(afterResize.width > afterMove.width + 50);
  assert(afterResize.height > afterMove.height + 30);
  console.log('PASS note dragging and resizing');
  await go('/graph?notebook=all');
  await pause(1600);
  await click('Box select');
  const surface = await (await page.$('.graph-page-container')).boundingBox();
  await page.mouse.move(surface.x + 10, surface.y + 150);
  await page.mouse.down();
  await page.mouse.move(surface.x + surface.width - 10, surface.y + surface.height - 10, { steps: 10 });
  await page.mouse.up();
  await click('Select notes (4)');
  await click('Select notes (4)');
  await click('Expand notes');
  await pause(500);
  const boxes = await page.$$eval('[data-graph-note]', cards =>
    cards.map(card => {
      const r = card.getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
    }));
  assert.equal(boxes.length, 4);
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], b = boxes[j];
      assert(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top);
    }
  }
  console.log('PASS box selection expands four notes without overlap');
  assert.equal(await page.$eval('.graph-selection-toolbar', el => getComputedStyle(el).flexDirection), 'column');
  assert.equal(await page.$$eval('[data-graph-note] .markdown-insert-toolbar', els => els.length), 0);
  assert.equal(await page.$$eval('[data-graph-note] .graph-note-actions', els => els.length), 0);
  assert(await page.$eval('[data-graph-note] header', el => el.offsetHeight < 45));
  assert(await page.$eval('[data-graph-note]', el => el.style.borderColor && el.style.getPropertyValue('--graph-node-color')));
  await click('Choose or edit a swimlane');
  await page.select('.graph-lane-panel select', saved.id);
  await page.waitForFunction(() => document.querySelector('[data-graph-nodes]')?.dataset.graphNodes === '2');
  await click('Minimize swimlane panel');
  assert.equal(await page.$eval('.graph-lane-label', el => el.textContent), 'Graph selection');
  assert.equal(await page.$$('.graph-lane-panel').then(els => els.length), 0);
  assert.equal(await page.$eval('button[aria-label="Choose or edit a swimlane"]', el => el.getAttribute('aria-pressed')), 'true');
  assert(
    await page.$eval('button[aria-label="Choose or edit a swimlane"]', el => {
      const probe = document.createElement('span');
      probe.style.color = 'var(--color-primary)';
      el.append(probe);
      const same = getComputedStyle(probe).color === getComputedStyle(el).color;
      probe.remove();
      return same;
    }),
  );
  await page.click('.graph-lane-label');
  const savedLayoutResponse = page.waitForResponse(response => response.url().endsWith('/api/screen-page') && response.request().method() === 'PUT');
  await click('Save swimlane', '.graph-lane-panel');
  const savedLayoutRecord = await (await savedLayoutResponse).json();
  const savedLayoutRow = savedLayoutRecord.page.rows.find(row => row.id === saved.id);
  assert(savedLayoutRow.graph.nodes.some(node => node.path === 'notes/a/b.md' && node.expanded && node.width > 360));
  assert(await page.$eval('.graph-save-hint', el => el.textContent.includes('positions') && el.textContent.includes('expanded')));
  console.log('PASS minimized swimlane name, primary active tool, explicit layout save');
  await page.click('.graph-lane-panel input[type="checkbox"]');
  // An active lane scopes the graph to its notebook, so outside notes and picker choices come only from notebook a.
  await page.waitForFunction(() => new URLSearchParams(location.search).get('notebook') === 'a' && document.querySelector('[data-graph-nodes]')?.dataset.graphNodes === '2');
  await click('Select notes (0)');
  assert.deepEqual(await page.$$eval('.graph-note-selector label', labels => labels.map(label => label.textContent.trim()).sort()), ['Alpha', 'Beta']);
  const labels = await page.$$('.graph-note-selector label');
  for (const label of labels) if (await label.evaluate(el => el.textContent.includes('Beta'))) await label.click();
  await click('Select notes (1)');
  const savedRow = () => parse(fs.readFileSync(path.join(root, '.github-notes-screen.yaml'), 'utf8')).rows.find(row => row.id === saved.id);
  await click('Choose or edit a swimlane');
  await click('Remove selection from swimlane');
  for (let i = 0; i < 60 && savedRow().items.length !== 1; i++) await pause(100);
  assert.equal(savedRow().items.length, 1);
  assert(fs.existsSync(path.join(root, 'notes/a/b.md')));
  await page.waitForSelector('.graph-card-position.is-outside-lane');
  assert(await page.$eval('.graph-card-position.is-outside-lane', el => Number(getComputedStyle(el).opacity) < 1));
  await click('Add selection to swimlane');
  for (let i = 0; i < 60 && savedRow().items.length !== 2; i++) await pause(100);
  assert.equal(savedRow().items.length, 2);
  await page.select('.graph-lane-panel select', 'dynamic');
  await pause(100);
  assert.equal(await page.$$eval('.graph-lane-membership', els => els.length), 0);
  await click('Edit swimlane', '.graph-lane-panel');
  await page.waitForSelector('dialog[open]');
  await page.keyboard.press('Escape');
  console.log('PASS compact card controls, colored borders, swimlane selection and membership edits');
  await page.goto(base + '/screen', { waitUntil: 'networkidle0' });
  const embedded = '#screen-lane-' + saved.id;
  await page.waitForSelector(embedded + ' ' + cardB);
  await page.$eval(embedded, el => el.scrollIntoView({ block: 'start' }));
  await pause(500);
  await page.click('.workspace-sidebar-toggle');
  await pause(250);
  assert(
    await page.$eval('.workspace-responsive-sidebar.is-open', el => {
      const r = el.getBoundingClientRect();
      return Boolean(document.elementFromPoint(r.left + 50, r.top + 180)?.closest('.workspace-responsive-sidebar'));
    }),
  );
  await page.click('.workspace-sidebar-toggle');
  await pause(250);
  assert.equal(await page.$$eval(embedded + ' .graph-selection-toolbar', els => els.length), 0);
  assert.equal(await page.$$eval(embedded + ' .graph-controls', els => els.length), 0);
  const nodePositions = savedRow().graph.nodes, layoutA = nodePositions.find(node => node.path === 'notes/a/a.md'), layoutB = nodePositions.find(node => node.path === 'notes/a/b.md');
  const box = await (await page.$(embedded + ' ' + cardB)).boundingBox(), k = box.width / (layoutB.width || 360);
  const ax = box.x + box.width / 2 + (layoutA.x - layoutB.x) * k, ay = box.y + box.height / 2 + (layoutA.y - layoutB.y) * k;
  await page.mouse.move(ax, ay);
  await page.waitForSelector(embedded + ' .graph-hover-expand');
  await page.click(embedded + ' .graph-hover-expand');
  await page.waitForSelector(embedded + ' ' + cardA);
  await pause(900);
  const expandedHeight = await page.$eval(embedded + ' .graph-page-container', el => el.clientHeight);
  await page.click(embedded + ' ' + cardA + ' button[aria-label="Collapse notes"]');
  await pause(1000);
  const collapsedHeight = await page.$eval(embedded + ' .graph-page-container', el => el.clientHeight);
  assert(expandedHeight > collapsedHeight, `Expanded canvas ${expandedHeight} must exceed collapsed ${collapsedHeight}`);
  // The canvas now refits after collapse. Use the settled card transform and saved graph positions.
  const latestNodes = savedRow().graph.nodes, latestA = latestNodes.find(n => n.path === 'notes/a/a.md'), latestB = latestNodes.find(n => n.path === 'notes/a/b.md');
  const currentB = await (await page.$(embedded + ' ' + cardB)).boundingBox(), currentK = currentB.width / (latestB.width || 360);
  await page.mouse.move(currentB.x + currentB.width / 2 + (latestA.x - latestB.x) * currentK, currentB.y + currentB.height / 2 + (latestA.y - latestB.y) * currentK);
  await page.waitForSelector(embedded + ' .graph-hover-expand');
  console.log('PASS embedded canvas grows on expansion and shrinks on collapse');
  const hoverButton = await (await page.$(embedded + ' .graph-hover-expand')).boundingBox();
  await page.mouse.click(hoverButton.x - 14, hoverButton.y + 14, { delay: 80 });
  await page.waitForSelector(embedded + ' [data-selected-count="1"]');
  await page.keyboard.press('Enter');
  await page.waitForSelector(embedded + ' ' + cardA);
  await page.click(embedded + ' .graph-fullscreen-tool button');
  await page.waitForFunction(id => location.pathname === '/graph' && new URLSearchParams(location.search).get('lanes') === id, {}, saved.id);
  console.log('PASS embedded hover and Enter expansion, hidden toolbars, full-page swimlane navigation');
  await page.waitForFunction(() => {
    const cards = [...document.querySelectorAll('[data-graph-note]')];
    return cards.length === 2 && cards.every(card => card.getBoundingClientRect().width < 650);
  });
  await pause(300);
  await page.screenshot({ path: `${product}/artifacts/qa/graph-editing.png`, fullPage: true });
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  assert.equal(await page.$eval(cardA, el => getComputedStyle(el).animationName), 'none');
  await page.click(cardA + ' button[aria-label="Collapse notes"]');
  assert.equal(await page.$$eval('.is-closing', els => els.length), 0);
  console.log('PASS note enter/exit animations and reduced-motion preference');
  assert.deepEqual(errors, []);
  fs.writeFileSync(`${product}/artifacts/qa/graph-editing-result.json`, JSON.stringify({ base, root, savedLane: saved.id, errors }, null, 2));
  console.log('PASS browser checks', JSON.stringify({ base, root, savedLane: saved.id }));
} catch (error) {
  await page.screenshot({ path: `${product}/artifacts/qa/graph-editing-failure.png`, fullPage: true });
  console.error('PAGE ERRORS', errors);
  throw error;
} finally {
  await browser.close();
  if (!process.argv.includes('--serve')) server.close();
}
if (process.argv.includes('--serve')) console.log('PREVIEW ' + base + '/graph?notebook=all');
