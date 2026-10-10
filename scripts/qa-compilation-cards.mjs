import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { SUPPORTED_SCHEMA_VERSION } from '../packages/core/dist/config.js';
import { createQaWorkspace, launchQaBrowser, product, qaRequire, startQaServer } from './lib/qa-harness.mjs';

// Lane cards of a compilation: the narrow vertical layout (L1-L5) and that changing layout never writes a file (S7).
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
  await page.setViewport(size);
};

const fileText = rel => fs.readFileSync(path.join(root, rel), 'utf8');
const compilationFiles = ['pins', 'thumbs', 'medium', 'short', 'many'].map(id => `notes/work/${id}.compilation.yml`);
// --no-optional-locks keeps this check from refreshing the index under the running server.
const untouched = () => assert.equal(git('--no-optional-locks', 'status', '--porcelain').toString().trim(), '', 'A layout change wrote a file');
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
  const box = await (await page.$(`${scope} ${selector}`)).boundingBox();
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
  const slot = await (await page.$('[data-focus-pane="1"] .screen-card-slot')).boundingBox();
  const grip = await (await page.$(paneHandle)).boundingBox();
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(grip.x + grip.width / 2 + 24, grip.y + grip.height / 2 + 24, { steps: 8 });
  await page.waitForSelector('.screen-drag-overlay');
  const overlay = await (await page.$('.screen-drag-overlay')).boundingBox();
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
  const handle = async title => (await page.$(`${reorderScope} [aria-label="Move item: ${title}"]`)).boundingBox();
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
  const strip = await (await page.$(`${reorderScope} .screen-lane-strip`)).boundingBox();
  const lastCard = (await page.$$eval(`${reorderScope} .screen-card-slot`, slots => slots.map(slot => slot.getBoundingClientRect().bottom))).at(-1);
  assert.ok(strip.y + strip.height - lastCard > 40, 'The fixture leaves no room below the last card');
  await drag(a, strip.x + strip.width / 2, strip.y + strip.height - 12);
  await page.mouse.up();
  await waitOrder('notes/work/short.compilation.yml', 'acb');
  console.log('PASS dropping below the last card places it last');
  // Keyboard: ArrowUp and ArrowDown move the card.
  const keyboardMove = async (title, key, expected) => {
    await page.focus(`${reorderScope} [aria-label="Move item: ${title}"]`);
    await page.keyboard.press('Space');
    await page.waitForFunction(label => document.querySelector(`[aria-label="${label}"]`)?.getAttribute('aria-pressed') === 'true', {}, `Move item: ${title}`);
    await page.keyboard.press(key);
    await settle(150);
    await page.keyboard.press('Space');
    await waitOrder('notes/work/short.compilation.yml', expected);
  };
  await keyboardMove('Note B', 'ArrowUp', 'abc');
  await keyboardMove('Note A', 'ArrowDown', 'bac');
  await shot('zoom-390-reorder');
  console.log('PASS keyboard reorder moves a card up with ArrowUp and down with ArrowDown in the vertical list');
  for (const file of compilationFiles.filter(file => !file.includes('short'))) assert.equal(fileText(file), before[file], `${file} changed on disk`);

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
