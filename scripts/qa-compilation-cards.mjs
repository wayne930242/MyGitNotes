import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { SUPPORTED_SCHEMA_VERSION } from '../packages/core/dist/config.js';
import { assertReadingLayout, createQaWorkspace, launchQaBrowser, product, qaRequire, slotReading, startQaServer } from './lib/qa-harness.mjs';

// Lane cards of a compilation: the narrow vertical layout (L1-L5) and that changing layout never writes a file (S7), then editing a note in its card (E1-E12, E15, E16, L6, L7) and the Graph arrangement's own in-place editing (G1).
const require = qaRequire();
const { root, write, commitFixture, git } = createQaWorkspace('github-notes-compilation-cards-qa-');
write('.github-notes.yaml', `schema_version: ${SUPPORTED_SCHEMA_VERSION}\nworkspace:\n  title: Cards QA\n  default_notebook: work\nnotebooks:\n  - id: work\n    title: Work\n    root: notes/work\n`);
const BODY = 'A long paragraph so the card has to scroll its own content.\n\n'.repeat(30);
const noteIds = ['a', 'b', 'c', 'd', 'e', 'f'];
for (const id of noteIds) write(`notes/work/${id}.md`, `---\ntitle: Note ${id.toUpperCase()}\n---\n# Note ${id.toUpperCase()}\n\n${BODY}`);
for (let i = 0; i < 60; i++) write(`notes/work/many/m${String(i).padStart(2, '0')}.md`, `---\ntitle: Many ${String(i).padStart(2, '0')}\n---\n# Many ${i}\n\nShort body.\n`);
const items = ids => ids.map(id => `  - id: pin-${id}\n    kind: note\n    path: notes/work/${id}.md\n`).join('');
const custom = (id, title, size, ids) => write(`notes/work/${id}.compilation.yml`, `version: 1\nid: ${id}\ntitle: ${title}\narrangement: lane\nsize: ${size}\nitems:\n${items(ids)}`);
custom('pins', 'Pins', 'small', noteIds);
custom('thumbs', 'Thumbs', 'thumbnail', noteIds);
custom('medium', 'Medium', 'medium', noteIds);
custom('short', 'Short', 'thumbnail', ['a', 'b', 'c']);
custom('unpin', 'Unpin', 'small', ['d', 'e']);
// The Graph fixture's notes are not edited anywhere else, so no recovery draft from an earlier step waits on them.
for (const id of ['ga', 'gb']) write(`notes/work/${id}.md`, `---\ntitle: Graph ${id.toUpperCase()}\n---\nGraph note ${id}.\n`);
write('notes/work/graphed.compilation.yml', 'version: 1\nid: graphed\ntitle: Graphed\narrangement: graph\nitems:\n  - id: pin-ga\n    kind: note\n    path: notes/work/ga.md\n  - id: pin-gb\n    kind: note\n    path: notes/work/gb.md\n');
for (const [n, day] of [[1, '03'], [2, '02'], [3, '01']]) write(`notes/work/recent/r${n}.md`, `---\ntitle: Recent ${n}\nupdated: "2026-01-${day}T10:00:00.000Z"\n---\nRecent note ${n} body.\n`);
write('notes/work/recent.compilation.yml', 'version: 1\nid: recent\ntitle: Recent\narrangement: lane\nsize: small\nsource:\n  kind: folder\n  path: notes/work/recent\n  recursive: true\nsort:\n  field: updated\n  order: desc\n');
write('notes/work/many.compilation.yml', 'version: 1\nid: many\ntitle: Many\narrangement: lane\nsize: small\nsource:\n  kind: folder\n  path: notes/work/many\n  recursive: true\nsort:\n  field: title\n  order: asc\n');
const focus = (id, division, panes) => ({ id, notebookId: 'work', name: id, division, panes: panes.map(paths => ({ tabs: paths.map(file => ({ kind: 'note', path: `notes/work/${file}.compilation.yml` })) })) });
write('.github-notes-focus.yaml', JSON.stringify({ version: 1, focuses: [focus('split2', 'columns-2', [['pins'], ['many']]), focus('split3', 'columns-3', [['pins'], ['short'], ['many']])] }));
commitFixture();
const { server, base } = await startQaServer(root);
const browser = await launchQaBrowser(require);
const shots = process.env.QA_SHOTS || path.join(product, 'artifacts/qa/compilation-cards');
fs.mkdirSync(shots, { recursive: true });
const errors = [];
let page;
let size = { width: 1440, height: 900 };
/** A new page of the current size. Every page holds a workspace event stream open, and the sixth would wait behind the browser's six connections per host, so each load gets a page of its own. */
const freshPage = async () => {
  await page?.close();
  page = await browser.newPage();
  page.on('pageerror', error => errors.push(error.message));
  if (process.env.QA_DEBUG) {
    page.on('console', message => console.log('console', message.text()));
    page.on('response', response => response.status() >= 400 && console.log('http', response.status(), response.url()));
  }
  await page.evaluateOnNewDocument(() => localStorage.setItem('github-notes:language', 'en'));
  await page.setViewport(size);
};

const fileText = rel => fs.readFileSync(path.join(root, rel), 'utf8');
const compilationFiles = ['pins', 'thumbs', 'medium', 'short', 'many', 'recent', 'graphed', 'unpin'].map(id => `notes/work/${id}.compilation.yml`);
// --no-optional-locks keeps this check from refreshing the index under the running server.
const untouched = () => assert.equal(git('--no-optional-locks', 'status', '--porcelain').toString().trim(), '', 'A layout change wrote a file');
/** The box of the element `selector` names, read in one step so a card that re-renders between two calls cannot leave a stale handle behind. */
const boxOf = async selector => {
  await page.waitForFunction(selector => document.querySelector(selector)?.getBoundingClientRect().width > 0, {}, selector);
  return page.$eval(selector, element => element.getBoundingClientRect().toJSON());
};
const shot = name => page.screenshot({ path: path.join(shots, `${name}.png`) });
const settle = ms => new Promise(resolve => setTimeout(resolve, ms));
const viewport = (width, height = 900) => {
  size = { width, height };
  return page.setViewport(size);
};
/** Loads `url` in a fresh page until `selector` shows. */
const load = async (url, selector) => {
  await freshPage();
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector(selector, { timeout: 20000 });
};
const zoom = async (id, width, height) => {
  await viewport(width, height);
  await load(`${base}/notebooks/work/notes/${id}.compilation.yml`, '.compilation-view .screen-card');
};
const focusUrl = id => `${base}/notebooks/work?view=list&focus=${id}`;
const openFocus = async (id, width, height) => {
  await viewport(width, height);
  await load(focusUrl(id), '[data-focus-pane] .compilation-view .screen-card');
  await page.waitForFunction(() => [...document.querySelectorAll('[data-focus-pane]')].every(pane => pane.querySelector('.compilation-view .screen-card')), { timeout: 20000 });
};
/** What the lane inside `scope` looks like: layout direction, cards' boxes, scroll extents and the controls it offers. */
const measure = scope =>
  page.evaluate(scope => {
    const view = document.querySelector(`${scope} .compilation-view`) ?? document.querySelector(scope);
    const lane = view.querySelector('.screen-lane'), strip = view.querySelector('.screen-lane-strip');
    const slots = [...strip.querySelectorAll('.screen-card-slot')].map(slot => slot.getBoundingClientRect());
    const stripBox = strip.getBoundingClientRect(), style = getComputedStyle(strip);
    return { viewWidth: view.getBoundingClientRect().width, orientation: lane.dataset.orientation, direction: style.flexDirection, overflowX: style.overflowX, overflowY: style.overflowY, stripWidth: stripBox.width, scrollWidth: strip.scrollWidth, clientWidth: strip.clientWidth, scrollHeight: strip.scrollHeight, clientHeight: strip.clientHeight, cards: slots.length, widths: slots.map(box => Math.round(box.width * 10) / 10), lefts: slots.map(box => Math.round(box.left * 10) / 10), tops: slots.map(box => box.top), rights: slots.map(box => box.right), stripRight: stripBox.right, contentHeights: [...strip.querySelectorAll('.screen-card-content')].map(content => Math.round(content.getBoundingClientRect().height)), scrollButtons: view.querySelectorAll('.screen-lane-scroll').length, pageOverflow: document.documentElement.scrollWidth - innerWidth };
  }, scope);
const assertVertical = (m, label, { scrolls = true } = {}) => {
  assert.equal(m.orientation, 'vertical', `${label}: JS orientation`);
  assert.equal(m.direction, 'column', `${label}: CSS lists cards in a column`);
  assert.equal(m.overflowX, 'hidden', `${label}: no sideways scrolling`);
  assert.equal(m.overflowY, 'auto', `${label}: scrolls vertically`);
  assert.equal(m.scrollButtons, 0, `${label}: scroll buttons are absent`);
  assert.ok(m.scrollWidth <= m.clientWidth + 1, `${label}: the list overflows sideways (${m.scrollWidth} > ${m.clientWidth})`);
  assert.ok(m.cards >= 2, `${label}: needs cards`);
  const lane = m.clientWidth - 4;
  m.widths.forEach(width => assert.ok(Math.abs(width - lane) <= 2, `${label}: card width ${width} is not the lane width ${lane}`));
  assert.ok(new Set(m.lefts).size === 1, `${label}: cards share a left edge`);
  m.tops.slice(1).forEach((top, index) => assert.ok(top > m.tops[index], `${label}: cards go top to bottom`));
  m.rights.forEach(right => assert.ok(right <= m.stripRight + 0.5, `${label}: a card is wider than the lane`));
  if (scrolls) assert.ok(m.scrollHeight > m.clientHeight, `${label}: the list does not scroll vertically`);
  assert.ok(m.pageOverflow <= 0, `${label}: the page scrolls sideways by ${m.pageOverflow}`);
};
const assertHorizontal = (m, label) => {
  assert.equal(m.orientation, 'horizontal', `${label}: JS orientation`);
  assert.equal(m.direction, 'row', `${label}: CSS keeps the strip`);
  assert.equal(m.overflowY, 'hidden', `${label}: strip does not scroll vertically`);
  assert.equal(m.scrollButtons, 2, `${label}: scroll buttons are present`);
  assert.ok(m.scrollWidth > m.clientWidth, `${label}: the strip does not scroll sideways`);
  m.widths.forEach(width => assert.ok(width <= m.clientWidth, `${label}: a card is wider than the lane`));
  m.tops.slice(1).forEach(top => assert.equal(top, m.tops[0], `${label}: cards sit in one row`));
};
/** Whether Alt+wheel over `selector` was taken for sideways scrolling, and how far the strip moved. */
const altWheel = async (scope, selector) => {
  await page.waitForFunction(selector => document.querySelector(selector)?.getBoundingClientRect().width > 0, {}, `${scope} ${selector}`);
  const box = await boxOf(`${scope} ${selector}`);
  await page.mouse.move(box.x + box.width / 2, Math.min(box.y + 40, box.y + box.height - 2));
  const before = await page.$eval(`${scope} .screen-lane-strip`, strip => strip.scrollLeft);
  const prevented = await page.$eval(`${scope} ${selector}`, element => {
    const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 160, altKey: true });
    element.dispatchEvent(event);
    return event.defaultPrevented;
  });
  const after = await page.$eval(`${scope} .screen-lane-strip`, strip => strip.scrollLeft);
  return { prevented, moved: after - before };
};
const wheelScroll = async (scope, deltaY) => {
  const strip = await page.$(`${scope} .screen-lane-strip`);
  const box = await strip.boundingBox();
  await page.mouse.move(box.x + 4, box.y + 6);
  const before = await strip.evaluate(element => element.scrollTop);
  await page.mouse.wheel({ deltaY });
  await page.waitForFunction((element, from) => element.scrollTop !== from, {}, strip, before).catch(() => {});
  return (await strip.evaluate(element => element.scrollTop)) - before;
};
const order = rel => [...fileText(rel).matchAll(/path: notes\/work\/(\w+)\.md/g)].map(match => match[1]).join('');
const waitOrder = async (rel, expected) => {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (order(rel) === expected) return;
    await settle(100);
  }
  assert.fail(`${rel} holds ${order(rel)}, expected ${expected}`);
};
const titles = scope => page.$$eval(`${scope} .screen-card-title`, cards => cards.map(card => card.textContent));
const before = Object.fromEntries(compilationFiles.map(file => [file, fileText(file)]));

await freshPage();
try {
  // L2: a wide compilation keeps the strip, its scroll buttons and Alt+wheel; no card is wider than the lane.
  await zoom('pins', 1440, 900);
  let m = await measure('.compilation-view');
  assertHorizontal(m, 'zoom 1440');
  assert.ok(m.viewWidth >= 1400, `zoom frame is ${m.viewWidth}px wide`);
  const alt = await altWheel('.compilation-view', '.screen-card-content');
  assert.ok(alt.prevented && alt.moved > 0, `Alt+wheel does not scroll the strip sideways: ${JSON.stringify(alt)}`);
  await shot('zoom-1440-strip');
  console.log('PASS wide zoom keeps the horizontal strip, scroll buttons and Alt+wheel');

  // L1/L2: the 559/560 boundary follows the compilation's own width; S7: crossing it writes nothing.
  for (const [width, vertical] of [[559, true], [560, false], [561, false]]) {
    await zoom('pins', width, 900);
    m = await measure('.compilation-view');
    assert.equal(Math.round(m.viewWidth), width, `zoom frame is not as wide as the viewport at ${width}`);
    (vertical ? assertVertical : assertHorizontal)(m, `zoom ${width}`);
    await shot(`zoom-${width}`);
  }
  untouched();
  console.log('PASS 559px lists cards top to bottom, 560px keeps the strip');

  // S7: resizing a mounted compilation across the threshold flips the layout in place and writes nothing.
  await zoom('pins', 1440, 900);
  for (const [width, vertical] of [[500, true], [1000, false], [559, true], [560, false], [390, true]]) {
    await viewport(width, 900);
    await page.waitForFunction(expected => document.querySelector('.compilation-view .screen-lane').dataset.orientation === expected, {}, vertical ? 'vertical' : 'horizontal');
    m = await measure('.compilation-view');
    (vertical ? assertVertical : assertHorizontal)(m, `resized to ${width}`);
  }
  untouched();
  for (const file of compilationFiles) assert.equal(fileText(file), before[file], `${file} changed on disk`);
  console.log('PASS resizing across 560px switches layout in place and never writes a compilation file (S7)');

  // L1: the three sizes keep their content heights in the vertical layout.
  await zoom('thumbs', 390, 900);
  const thumb = await measure('.compilation-view');
  assertVertical(thumb, 'thumbnail 390');
  await shot('zoom-390-thumbnail');
  await zoom('pins', 390, 900);
  const small = await measure('.compilation-view');
  assertVertical(small, 'small 390');
  await shot('zoom-390-small');
  await zoom('medium', 390, 900);
  const medium = await measure('.compilation-view');
  assertVertical(medium, 'medium 390');
  await shot('zoom-390-medium');
  const heights = [thumb, small, medium].map(measured => measured.contentHeights[0]);
  assert.deepEqual(heights, [125, 255, 405], `Card content heights follow the size: ${heights}`);
  assert.ok(medium.widths[0] <= 390, 'A medium card is wider than the phone');
  console.log('PASS 390px page lists cards at full width with thumbnail < small < medium heights and no sideways overflow');

  // L3: plain wheel scrolls the list, Alt+wheel is not taken, no sideways movement.
  await zoom('pins', 390, 900);
  assert.ok(await wheelScroll('.compilation-view', 200) > 0, 'Plain wheel does not scroll the vertical list');
  const narrowAlt = await altWheel('.compilation-view', '.screen-lane');
  assert.deepEqual(narrowAlt, { prevented: false, moved: 0 }, 'Alt+wheel is still taken for sideways scrolling in the vertical list');
  assert.equal(await page.$eval('.compilation-view .screen-lane-strip', strip => strip.scrollLeft), 0);
  console.log('PASS plain wheel scrolls the vertical list and Alt+wheel stays untouched');

  // L1/L2: a split Focus pane is narrow on a wide screen, so the container decides, not the viewport.
  await openFocus('split2', 1000, 900);
  const pane1 = '[data-focus-pane="1"]';
  m = await measure(pane1);
  assert.ok(m.viewWidth < 560, `The right Focus pane is ${m.viewWidth}px, not narrow`);
  assertVertical(m, `split pane ${Math.round(m.viewWidth)}px`);
  const left = await measure('[data-focus-pane="0"]');
  assertVertical(left, `left split pane ${Math.round(left.viewWidth)}px`);
  await shot('focus-split-1000');
  await openFocus('split3', 1440, 900);
  for (const pane of [0, 1, 2]) {
    const wide = await measure(`[data-focus-pane="${pane}"]`);
    assert.ok(wide.viewWidth < 560, `Pane ${pane} is ${wide.viewWidth}px at 1440 wide`);
    assertVertical(wide, `third pane ${pane}`, { scrolls: pane !== 1 });
  }
  await shot('focus-three-panes-1440');
  console.log(`PASS split Focus panes (${Math.round(m.viewWidth)}px) list cards top to bottom although the viewport is wide`);
  untouched();

  // A pane of about 500px for the user's screenshot, wherever the browse dock leaves it.
  await openFocus('split2', 1000, 900);
  for (let width = 900; width <= 1300; width += 20) {
    await viewport(width, 900);
    await settle(150);
    const candidate = await measure(pane1);
    if (candidate.viewWidth >= 490 && candidate.viewWidth <= 520) {
      await shot('focus-split-pane-500');
      console.log(`PASS captured the right pane at ${Math.round(candidate.viewWidth)}px (viewport ${width}px)`);
      break;
    }
  }

  // L5: a dynamic compilation loads its next page when the reader reaches the end of the vertical list.
  await openFocus('split2', 1000, 900);
  const many = '[data-focus-pane="1"]';
  assert.equal((await titles(many)).length, 50, 'The first page is not 50 cards');
  assert.equal(await page.$eval(`${many} .screen-lane-strip`, strip => strip.scrollTop), 0);
  await page.$eval(`${many} .screen-lane-strip`, strip => {
    strip.scrollTop = strip.scrollHeight;
  });
  await page.waitForFunction(selector => document.querySelectorAll(`${selector} .screen-card-title`).length === 60, { timeout: 10000 }, many);
  assert.deepEqual((await titles(many)).slice(-2), ['Many 58', 'Many 59']);
  console.log('PASS reaching the end of the vertical list loads the next page of a dynamic compilation');

  // A drag preview follows the pointer inside a narrow Focus pane: the compilation view must not become the containing block of its fixed position.
  await openFocus('split3', 1440, 900);
  const paneHandle = '[data-focus-pane="1"] [aria-label="Move item: Note A"]';
  await page.click('[data-focus-pane="1"] .reorder-toggle');
  await page.waitForSelector(paneHandle);
  const slot = await boxOf('[data-focus-pane="1"] .screen-card-slot');
  const grip = await boxOf(paneHandle);
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(grip.x + grip.width / 2 + 24, grip.y + grip.height / 2 + 24, { steps: 8 });
  await page.waitForSelector('.screen-drag-overlay');
  const overlay = await boxOf('.screen-drag-overlay');
  await page.mouse.up();
  assert.ok(slot.x > 400, `The pane does not start away from the page edge (${slot.x})`);
  assert.ok(overlay.x >= grip.x - 20 && overlay.x <= grip.x + 60 && overlay.y >= grip.y - 20 && overlay.y <= grip.y + 60, `The drag preview is not under the pointer: preview ${JSON.stringify(overlay)}, handle ${JSON.stringify(grip)}`);
  await settle(300);
  assert.equal(order('notes/work/short.compilation.yml'), 'abc', 'A drag that ended over its own card reordered the list');
  console.log('PASS the drag preview stays under the pointer in a narrow Focus pane');

  // L4: reorder in the vertical layout, by pointer, to the end of the list, and by keyboard.
  const reorderScope = '.compilation-view';
  const openReorder = async () => {
    await zoom('short', 390, 900);
    await page.click(`${reorderScope} .reorder-toggle`);
    await page.waitForSelector(`${reorderScope} [aria-label^="Move item: "]`);
  };
  await openReorder();
  const handle = title => boxOf(`${reorderScope} [aria-label="Move item: ${title}"]`);
  const drag = async (from, toX, toY) => {
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(toX, toY, { steps: 16 });
    await settle(120);
  };
  // Onto the second card: A takes B's place.
  let a = await handle('Note A'), b = await handle('Note B');
  await drag(a, b.x + b.width / 2, b.y + b.height / 2);
  assert.equal(await page.$$eval(`${reorderScope} .screen-card-slot`, slots => slots.some(slot => slot.style.transform.includes('translate3d') && /,\s*-?[1-9]/.test(slot.style.transform))), true, 'The drop indicator does not move cards vertically');
  await page.mouse.up();
  await waitOrder('notes/work/short.compilation.yml', 'bac');
  console.log('PASS dragging a card down the vertical list moves it');
  // Below the last card: the dragged card goes last.
  await page.waitForFunction(() => document.querySelector('.compilation-view .screen-card-title')?.textContent === 'Note B');
  a = await handle('Note B');
  const strip = await boxOf(`${reorderScope} .screen-lane-strip`);
  const lastCard = (await page.$$eval(`${reorderScope} .screen-card-slot`, slots => slots.map(slot => slot.getBoundingClientRect().bottom))).at(-1);
  assert.ok(strip.y + strip.height - lastCard > 40, 'The fixture leaves no room below the last card');
  await drag(a, strip.x + strip.width / 2, strip.y + strip.height - 12);
  await page.mouse.up();
  await waitOrder('notes/work/short.compilation.yml', 'acb');
  console.log('PASS dropping below the last card places it last');
  // Keyboard: ArrowUp and ArrowDown move the card.
  // dnd-kit measures the droppable cards a moment after the keyboard drag starts, so a press that lands before that moves nothing; the move is tried again.
  const keyboardMove = async (title, key, expected) => {
    for (let attempt = 0; attempt < 4; attempt++) {
      await page.focus(`${reorderScope} [aria-label="Move item: ${title}"]`);
      await page.keyboard.press('Space');
      await page.waitForFunction(label => document.querySelector(`[aria-label="${label}"]`)?.getAttribute('aria-pressed') === 'true', {}, `Move item: ${title}`);
      await settle(300);
      await page.keyboard.press(key);
      await settle(400);
      await page.keyboard.press('Space');
      for (let wait = 0; wait < 15 && order('notes/work/short.compilation.yml') !== expected; wait++) await settle(100);
      if (order('notes/work/short.compilation.yml') === expected) return;
    }
    await waitOrder('notes/work/short.compilation.yml', expected);
  };
  await keyboardMove('Note B', 'ArrowUp', 'abc');
  await keyboardMove('Note A', 'ArrowDown', 'bac');
  await shot('zoom-390-reorder');
  console.log('PASS keyboard reorder moves a card up with ArrowUp and down with ArrowDown in the vertical list');
  for (const file of compilationFiles.filter(file => !file.includes('short'))) assert.equal(fileText(file), before[file], `${file} changed on disk`);

  // ---- Editing a note in its card (E1-E12, L6, L7) ----
  const cardSel = id => `.screen-card[data-screen-item="pin-${id}"]`;
  const noteFile = id => `notes/work/${id}.md`;
  const waitFile = async (file, text, present = true) => {
    for (let attempt = 0; attempt < 120; attempt++) {
      if (fileText(file).includes(text) === present) return;
      await settle(100);
    }
    assert.fail(`${present ? 'Missing' : 'Lingering'} saved content in ${file}: ${text} (file holds ${JSON.stringify(fileText(file).slice(0, 160))})`);
  };
  const editorFocused = () => Boolean(document.activeElement?.closest('[data-editing] .cm-content, [data-editing] textarea'));
  const editing = () => page.$$eval('.screen-card[data-editing]', cards => cards.map(card => card.dataset.screenItem));
  const dialogOpen = label => page.$(`[role="dialog"][aria-label="${label}"]`).then(Boolean);
  const startByBody = async (scope, id) => {
    await click(`${scope} ${cardSel(id)} .compilation-inline-reading p`);
    await page.waitForSelector(`${scope} ${cardSel(id)}[data-editing] .cm-content`);
    await page.waitForFunction(editorFocused);
  };
  const cardText = (scope, id) => page.$eval(`${scope} ${cardSel(id)}`, card => card.querySelector('.screen-card-content').textContent);
  const cardBox = (scope, id) =>
    page.$eval(`${scope} ${cardSel(id)}`, card => {
      const box = card.getBoundingClientRect(), content = card.querySelector('.screen-card-content').getBoundingClientRect();
      return { height: Math.round(box.height), contentHeight: Math.round(content.height), top: box.top, bottom: box.bottom, left: box.left, right: box.right };
    });
  // Cards show their path until the lane's notes arrive, so each control is waited for before it is used.
  const click = async selector => {
    await page.waitForSelector(selector, { visible: true, timeout: 20000 });
    await page.click(selector);
  };
  const tap = async selector => {
    await page.waitForSelector(selector, { visible: true, timeout: 20000 });
    await page.tap(selector);
  };
  // A named screenshot for the person who reviews the result, written when QA_SHOTS_FINAL names a folder.
  const finalShot = async name => {
    if (!process.env.QA_SHOTS_FINAL) return;
    fs.mkdirSync(process.env.QA_SHOTS_FINAL, { recursive: true });
    await page.screenshot({ path: path.join(process.env.QA_SHOTS_FINAL, `${name}.png`) });
  };

  // E1, E5, E6: a body click edits the card and focuses the editor; a body click on another card saves the first on disk and moves editing there.
  await zoom('pins', 1440, 900);
  const smallCard = await cardBox('.compilation-view', 'a');
  const readingA = await slotReading(page, cardSel('a'));
  await startByBody('.compilation-view', 'a');
  assert.deepEqual(await editing(), ['pin-a']);
  await page.keyboard.type('EDIT-A ');
  // E15, E16: the card edits in the reading layout, and the text starts at the top of its body.
  await assertReadingLayout(page, cardSel('a'), readingA, 'small card at 1440px', { fills: true });
  assert.equal((await cardBox('.compilation-view', 'a')).height, smallCard.height, 'The card grew when it began editing');
  assert.ok(await page.$eval(`${cardSel('a')} .cm-scroller`, scroller => scroller.scrollHeight > scroller.clientHeight), 'The editor does not scroll inside the card');
  await shot('card-editing-zoom-1440-small');
  await finalShot('card-small-editing-1440');
  await click(`${cardSel('b')} .compilation-inline-reading p`);
  await page.waitForSelector(`${cardSel('b')}[data-editing] .cm-content`);
  await waitFile(noteFile('a'), 'EDIT-A');
  assert.deepEqual(await editing(), ['pin-b'], 'A second card did not take over editing');
  // The saved card leaves no recovery draft behind, or reopening it would offer to restore text that is already on disk.
  await settle(1000);
  assert.deepEqual(await page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith('gh_notes_draft:') && key.endsWith(':notes/work/a.md'))), [], 'A saved card left a recovery draft in storage');
  assert.ok((await cardText('.compilation-view', 'a')).includes('EDIT-A'), 'Card A does not read with the saved text');
  console.log('PASS a body click edits the card in place; another card saves the first and takes over (E1, E5, E6)');

  // E4: the title opens the note in zoom on the same editing session; closing zoom gives the editor back to the card.
  await page.waitForFunction(editorFocused);
  await page.keyboard.type('EDIT-B ');
  await click(`${cardSel('b')} .screen-card-title`);
  await page.waitForSelector('[role="dialog"][aria-label="Note editor"] .cm-content');
  const zoomText = await page.$eval('[role="dialog"][aria-label="Note editor"] .cm-content', element => element.textContent);
  assert.ok(zoomText.includes('EDIT-B'), `Zoom does not share the editing session: ${zoomText.slice(0, 80)}`);
  assert.ok((await cardText('.compilation-view', 'b')).includes('This note is open in zoom.'), 'The card does not say the note is in zoom');
  await click('button[aria-label="Close note"]');
  await page.waitForSelector(`${cardSel('b')}[data-editing] .cm-content`);
  assert.ok((await page.$eval(`${cardSel('b')} .cm-content`, element => element.textContent)).includes('EDIT-B'), 'The card lost its text after zoom');
  // Escape typed in the borrowed zoom editor does not end the card's slot behind it: after zoom closes, the card is still editing with its text.
  await click(`${cardSel('b')} .screen-card-title`);
  await page.waitForSelector('[role="dialog"][aria-label="Note editor"] .cm-content');
  await page.click('[role="dialog"][aria-label="Note editor"] .cm-content');
  await page.keyboard.press('Escape');
  await settle(500);
  await click('button[aria-label="Close note"]');
  await page.waitForFunction(() => !document.querySelector('[role="dialog"][aria-label="Note editor"]'));
  await page.waitForSelector(`${cardSel('b')}[data-editing] .cm-content`);
  assert.ok(await dialogOpen('Compilation'), 'Closing zoom closed the compilation as well');
  assert.ok((await page.$eval(`${cardSel('b')} .cm-content`, element => element.textContent)).includes('EDIT-B'), 'The card lost its text after Escape in zoom');
  console.log('PASS zoom borrows the card editor and gives it back, also after Escape typed in zoom (E4)');

  // K2: Escape returns the card to reading with focus on Edit; the next Escape closes the compilation.
  await click(`${cardSel('b')} .cm-content`);
  await page.keyboard.press('Escape');
  await page.waitForFunction(selector => !document.querySelector(selector).hasAttribute('data-editing'), {}, cardSel('b'));
  assert.ok(await dialogOpen('Compilation'), 'The first Escape closed the compilation');
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), 'Edit Note B', 'Focus is not on the Edit button');
  await waitFile(noteFile('b'), 'EDIT-B');
  assert.ok((await cardText('.compilation-view', 'b')).includes('EDIT-B'), 'Card B does not read with the saved text');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('[role="dialog"][aria-label="Compilation"]'));
  console.log('PASS Escape returns the card to reading with focus on Edit, then closes the compilation (K2)');

  // E3: the thumbnail and medium cards keep their size too, and the editor scrolls inside them.
  for (const [id, label] of [['thumbs', 'thumbnail'], ['medium', 'medium']]) {
    await zoom(id, 1440, 900);
    const sized = await cardBox('.compilation-view', 'a');
    const readingSized = await slotReading(page, cardSel('a'));
    await startByBody('.compilation-view', 'a');
    assert.equal((await cardBox('.compilation-view', 'a')).height, sized.height, `The ${label} card grew when it began editing`);
    await assertReadingLayout(page, cardSel('a'), readingSized, `${label} card at 1440px`, { fills: true });
    await finalShot(`card-${label}-editing-1440`);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('.screen-card[data-editing]'));
  }
  console.log('PASS thumbnail and medium cards keep their size while editing (E3)');

  // E2/E13-ish: a button edits as well, and Done saves; a link in the body does not start editing.
  await zoom('pins', 1440, 900);
  // The very corner of the body counts as the body, not as the card's chrome.
  await page.waitForSelector(`${cardSel('c')} .compilation-inline-reading`, { visible: true });
  const corner = await page.$eval(`${cardSel('c')} .screen-card-content`, element => element.getBoundingClientRect().toJSON());
  await page.mouse.click(corner.x + 3, corner.y + 3);
  await page.waitForSelector(`${cardSel('c')}[data-editing] .cm-content`);
  assert.equal(await page.$('[role="dialog"][aria-label="Note editor"]'), null, 'A click at the edge of the body opened zoom instead of editing');
  await page.waitForFunction(editorFocused);
  await page.keyboard.type('EDIT-C ');
  await click(`${cardSel('c')} button[aria-label="Finish editing Note C"]`);
  await page.waitForFunction(selector => !document.querySelector(selector).hasAttribute('data-editing'), {}, cardSel('c'));
  await waitFile(noteFile('c'), 'EDIT-C');
  await click(`${cardSel('c')} button[aria-label="Edit Note C"]`);
  await page.waitForSelector(`${cardSel('c')}[data-editing] .cm-content`);
  await page.waitForFunction(editorFocused);
  await page.keyboard.type('EDIT-C2 ');
  await click(`${cardSel('c')} button[aria-label="Finish editing Note C"]`);
  await page.waitForFunction(selector => !document.querySelector(selector).hasAttribute('data-editing'), {}, cardSel('c'));
  await waitFile(noteFile('c'), 'EDIT-C2');
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), 'Edit Note C');
  console.log('PASS Edit and Done work from the card heading (E1, E6)');

  // E11: a dynamic compilation sorted by update time keeps the editing card where it is until editing ends.
  await viewport(1440, 900);
  await load(`${base}/notebooks/work/notes/recent.compilation.yml`, '.compilation-view .screen-card');
  assert.deepEqual(await titles('.compilation-view'), ['Recent 1', 'Recent 2', 'Recent 3']);
  await click('.compilation-view .screen-card-slot:nth-child(2) .compilation-inline-reading p');
  await page.waitForSelector('.compilation-view .screen-card[data-editing] .cm-content');
  await page.waitForFunction(editorFocused);
  const lists = [];
  page.on('response', response => response.request().method() === 'POST' && response.url().includes('/api/notes/lookup') && lists.push(Date.now()));
  await page.keyboard.type('HELD ');
  await waitFile('notes/work/recent/r2.md', 'HELD');
  // The lane reads its notes again after the save; only then does the order below say anything.
  const saved = Date.now();
  for (let wait = 0; wait < 100 && !lists.some(time => time > saved); wait++) await settle(100);
  assert.ok(lists.some(time => time > saved), 'The lane did not read its notes again after the autosave');
  await settle(300);
  assert.deepEqual(await titles('.compilation-view'), ['Recent 1', 'Recent 2', 'Recent 3'], 'The editing card moved while it was autosaved');
  assert.equal(await page.$$eval('.compilation-view .screen-card-slot', slots => slots.findIndex(slot => slot.querySelector('[data-editing]'))), 1, 'The editing card is not where it was');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('.screen-card[data-editing]'));
  await page.waitForFunction(() => document.querySelector('.compilation-view .screen-card-title')?.textContent === 'Recent 2', { timeout: 10000 });
  assert.deepEqual(await titles('.compilation-view'), ['Recent 2', 'Recent 1', 'Recent 3']);
  console.log('PASS a dynamic updated:desc lane holds the editing card in place, then applies the live order (E11)');

  // E12: turning reorder on saves and ends the editing, hides Edit, and body clicks do not edit; unpinning the editing card saves it first.
  await zoom('pins', 1440, 900);
  await startByBody('.compilation-view', 'd');
  await page.keyboard.type('EDIT-D ');
  await click('.compilation-view .reorder-toggle');
  await page.waitForSelector('.compilation-view [aria-label^="Move item: "]');
  assert.deepEqual(await editing(), [], 'Reorder mode left a card editing');
  await waitFile(noteFile('d'), 'EDIT-D');
  assert.equal(await page.$$eval('.compilation-view button[aria-label^="Edit "]', buttons => buttons.length), 0, 'Edit is offered in reorder mode');
  await click(`${cardSel('e')} .compilation-inline-reading p`);
  assert.deepEqual(await editing(), [], 'A body click edited in reorder mode');
  await page.waitForSelector('[role="dialog"][aria-label="Note editor"]');
  await click('button[aria-label="Close note"]');
  await page.waitForFunction(() => !document.querySelector('[role="dialog"][aria-label="Note editor"]'));
  await zoom('unpin', 1440, 900);
  await startByBody('.compilation-view', 'd');
  await page.keyboard.type('UNPIN-D ');
  await click(`${cardSel('d')} button[aria-label="Unpin: Note D"]`);
  await waitFile(noteFile('d'), 'UNPIN-D');
  await waitFile('notes/work/unpin.compilation.yml', 'pin-d', false);
  console.log('PASS reorder mode saves the editing card first and offers no Edit; unpinning saves before the card goes (E8, E12)');

  // L6/L7: a Focus pane of about 500px lists cards top to bottom; the card edits there, keeps its size and scrolls inside.
  await openFocus('split2', 1000, 900);
  let paneWidth = 0;
  for (let width = 900; width <= 1300; width += 20) {
    await viewport(width, 900);
    await settle(150);
    paneWidth = (await measure('[data-focus-pane="0"]')).viewWidth;
    if (paneWidth >= 490 && paneWidth <= 520) break;
  }
  assert.ok(paneWidth >= 490 && paneWidth <= 520, `No viewport gave a pane of about 500px (${paneWidth})`);
  const pane0 = '[data-focus-pane="0"]';
  assertVertical(await measure(pane0), `focus pane ${Math.round(paneWidth)}px`);
  const paneCard = await cardBox(pane0, 'a');
  const readingPane = await slotReading(page, `${pane0} ${cardSel('a')}`);
  await startByBody(pane0, 'a');
  await page.keyboard.type('PANE-A ');
  // E16: in a narrow pane the text starts at the top of the card body and the editor fills it, before any blank lines push it down.
  await assertReadingLayout(page, `${pane0} ${cardSel('a')}`, readingPane, `card in a ${Math.round(paneWidth)}px pane`, { fills: true });
  await finalShot('card-editing-focus-pane-500');
  for (let line = 0; line < 40; line++) await page.keyboard.press('Enter');
  await settle(400);
  const paneEditing = await cardBox(pane0, 'a');
  assert.equal(paneEditing.height, paneCard.height, 'The pane card grew while editing');
  assert.ok(await page.$eval(`${pane0} ${cardSel('a')} .cm-scroller`, scroller => scroller.scrollHeight > scroller.clientHeight), 'The pane editor does not scroll inside the card');
  assert.ok(paneEditing.right <= paneWidth + (await page.$eval(`${pane0} .compilation-view`, view => view.getBoundingClientRect().left)) + 1, 'The editing card is wider than the pane');
  await shot('card-editing-focus-pane-500');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('.screen-card[data-editing]'));
  await waitFile(noteFile('a'), 'PANE-A');
  console.log(`PASS a card edits in a ${Math.round(paneWidth)}px Focus pane without growing, and the editor scrolls inside it (L6)`);

  // L7: crossing 560px keeps the editing card, its unsaved text and its place in view.
  await zoom('pins', 900, 900);
  await startByBody('.compilation-view', 'f');
  await page.keyboard.type('CROSS-F ');
  for (const width of [500, 900, 400]) {
    await viewport(width, 900);
    await page.waitForFunction(expected => document.querySelector('.compilation-view .screen-lane').dataset.orientation === expected, {}, width < 560 ? 'vertical' : 'horizontal');
    await settle(200);
    assert.deepEqual(await editing(), ['pin-f'], `Editing was lost at ${width}px`);
    assert.ok((await page.$eval(`${cardSel('f')} .cm-content`, element => element.textContent)).includes('CROSS-F'), `The unsaved text was lost at ${width}px`);
    const box = await cardBox('.compilation-view', 'f');
    const strip = await page.$eval('.compilation-view .screen-lane-strip', element => element.getBoundingClientRect().toJSON());
    // The last card sits far down the column and far right in the strip, so only scrolling it back into view after the layout change keeps it in the lane.
    assert.ok(box.top >= strip.top - 2 && box.bottom <= strip.bottom + 2 && box.left >= strip.left - 2 && box.right <= strip.right + 2, `The editing card is out of view at ${width}px: ${JSON.stringify({ box, strip })}`);
  }
  console.log('PASS resizing across 560px keeps the editing card, its unsaved text and keeps it in view (L7)');
  await click(`${cardSel('f')} .cm-content`);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('.screen-card[data-editing]'));
  await waitFile(noteFile('f'), 'CROSS-F');

  // E1 on a phone: the Edit button edits, and a touch tap on the body opens the note in zoom.
  await zoom('pins', 390, 900);
  const readingPhone = await slotReading(page, cardSel('c'));
  await tap(`${cardSel('c')} .compilation-inline-reading p`);
  await page.waitForSelector('[role="dialog"][aria-label="Note editor"]');
  assert.deepEqual(await editing(), [], 'A touch tap edited the card');
  await click('button[aria-label="Close note"]');
  await page.waitForFunction(() => !document.querySelector('[role="dialog"][aria-label="Note editor"]'));
  await click(`${cardSel('c')} button[aria-label="Edit Note C"]`);
  await page.waitForSelector(`${cardSel('c')}[data-editing] .cm-content`);
  await page.waitForFunction(editorFocused);
  assert.equal((await measure('.compilation-view')).pageOverflow <= 0, true, 'The phone page scrolls sideways while a card edits');
  // E16: on a phone the editor fills the card body, with no band under the text and no band above it.
  await assertReadingLayout(page, cardSel('c'), readingPhone, 'card at 390px', { fills: true });
  await finalShot('card-editing-390');
  console.log('PASS on a phone a touch tap opens zoom and the Edit button edits the card (E1, E2)');

  // G1: in the Graph arrangement a node expanded from its hover button edits in place, and the note saves as it does outside a compilation.
  await viewport(1440, 900);
  await load(`${base}/notebooks/work/notes/graphed.compilation.yml`, '.compilation-view [data-graph-nodes="2"]');
  await settle(2500);
  // The graph is drawn on a canvas, so the node dots are found by their colour.
  const dots = await page.evaluate(() => {
    const canvas = [...document.querySelectorAll('.compilation-view canvas')].sort((a, b) => b.width * b.height - a.width * a.height)[0];
    const box = canvas.getBoundingClientRect(), scale = canvas.width / box.width;
    const { data, width, height } = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
    const cells = new Map();
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        if (data[i + 3] > 200 && data[i] > 120 && data[i] - data[i + 1] > 40 && data[i] - data[i + 2] > 40) {
          const key = `${Math.floor(x / 24)},${Math.floor(y / 24)}`;
          const cell = cells.get(key) ?? { x: 0, y: 0, n: 0 };
          cell.x += x;
          cell.y += y;
          cell.n++;
          cells.set(key, cell);
        }
      }
    }
    const clusters = [];
    for (const cell of [...cells.values()].filter(cell => cell.n > 20).map(cell => ({ x: cell.x / cell.n, y: cell.y / cell.n, n: cell.n }))) {
      const near = clusters.find(cluster => Math.hypot(cluster.x - cell.x, cluster.y - cell.y) < 40);
      if (near) {
        near.x = (near.x * near.n + cell.x * cell.n) / (near.n + cell.n);
        near.y = (near.y * near.n + cell.y * cell.n) / (near.n + cell.n);
        near.n += cell.n;
      } else clusters.push({ ...cell });
    }
    return clusters.map(cluster => ({ x: box.left + cluster.x / scale, y: box.top + cluster.y / scale }));
  });
  assert.ok(dots.length >= 2, `Found ${dots.length} graph nodes on the canvas`);
  await page.mouse.move(dots[0].x, dots[0].y, { steps: 4 });
  await page.waitForSelector('.compilation-view button[aria-label^="Expand notes: "]', { timeout: 10000 });
  await click('.compilation-view button[aria-label^="Expand notes: "]');
  await page.waitForSelector('[data-graph-note] .cm-content', { timeout: 10000 });
  const graphNote = await page.$eval('[data-graph-note]', element => element.dataset.graphNote);
  const graphFile = noteFile(graphNote.endsWith('ga.md') ? 'ga' : 'gb');
  await settle(1500);
  await page.click('[data-graph-note] .cm-content');
  await page.keyboard.type('GRAPH-EDIT ');
  assert.ok((await page.$eval('[data-graph-note] .cm-content', element => element.textContent)).includes('GRAPH-EDIT'), 'The typed text did not land in the node editor');
  // Closing the compilation saves what the card edited, as it does for a lane card (E8). The graph card's own debounced autosave is not asserted:
  // inside a zoomed compilation it does not fire on the baseline either (ee56d62), so the guard checks the edit and the flush that exist today.
  await page.keyboard.press('Escape');
  if (await dialogOpen('Compilation')) {
    await settle(300);
    await page.keyboard.press('Escape');
  }
  await page.waitForFunction(() => !document.querySelector('[role="dialog"][aria-label="Compilation"]'), { timeout: 10000 });
  await waitFile(graphFile, 'GRAPH-EDIT');
  console.log('PASS a Graph node expands and edits in place inside a compilation, and closing saves it (G1)');

  assert.deepEqual(errors, []);
  console.log('PASS no page errors');
} catch (error) {
  await shot('failure').catch(() => {});
  throw error;
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
  fs.rmSync(root, { recursive: true, force: true });
}
