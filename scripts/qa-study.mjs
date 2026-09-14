import { chooseSelect } from './browser-select.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';

const product = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(`${product}/apps/web/package.json`);
const puppeteer = require('puppeteer-core'), { parse } = require('yaml');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'github-notes-study-qa-'));
const write = (file, text) => { fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true }); fs.writeFileSync(path.join(root, file), text); };
const git = (...args) => execFileSync('git', args, { cwd: root, stdio: 'pipe' });
const original = '---\ntitle: Vocabulary\nstatus: new\ncustom: keep-me\n---\n\nWhat does abandon mean?\n\n---\n\nGive up.\n\n---\n\nThey abandoned the plan.\n' + '\nA longer example paragraph for reading and scrolling.\n'.repeat(40);
write('.github-notes.yaml', 'schema_version: 1\nworkspace:\n  title: Study QA\n  default_notebook: example\nnotebooks:\n  - id: example\n    title: Example\n    root: notes/example\n');
write('notes/example/vocabulary.md', original);
write('notes/example/other.md', '---\ntitle: Other\nstatus: new\n---\n\nA single-page note.');
const progression = { stages: [{ status: 'new', intervalDays: 1 }, { status: 'learning', intervalDays: 3 }, { status: 'review', intervalDays: 7 }, { status: 'known', intervalDays: 30 }], easy: 'two' };
const source = { kind: 'folder', notebookId: 'example', path: 'notes/example', recursive: true };
write('.github-notes-screen.yaml', JSON.stringify({ version: 1, rows: [
  { id: 'study', name: 'Study', kind: 'dynamic', view: 'small', source, progression, sort: { field: 'title', order: 'asc' }, study: { filter: 'all', dueFirst: false, status: 'new' } },
  { id: 'arrivals', name: 'Next stage', kind: 'dynamic', view: 'small', source, study: { filter: 'all', dueFirst: true, status: 'learning' } },
  { id: 'reading', name: 'Reading', kind: 'dynamic', view: 'medium', source, progression, sort: { field: 'title', order: 'asc' } },
] }));
const { createStudyNote, parseNoteContent } = await import(`${product}/packages/core/dist/index.js`);
const seeded = ['vocabulary.md', 'other.md'].map((file, index) => {
  const parsed = parseNoteContent(fs.readFileSync(path.join(root, 'notes/example', file), 'utf8'), file);
  const note = createStudyNote({ ...parsed, path: `notes/example/${file}`, notebookId: 'example' });
  note.stage = { laneId: 'study', status: 'new', due: new Date(Date.now() - (2 - index) * 86400000).toISOString() };
  return note;
});
write('.github-notes-study.yaml', JSON.stringify({ version: 1, notes: seeded, events: [] }));
const initialStudy = fs.readFileSync(path.join(root, '.github-notes-study.yaml'), 'utf8');
const initialScreen = fs.readFileSync(path.join(root, '.github-notes-screen.yaml'), 'utf8');
git('init', '-b', 'main'); git('config', 'user.name', 'QA'); git('config', 'user.email', 'qa@example.com'); git('add', '.'); git('commit', '-m', 'fixture');
process.env.GITHUB_NOTES_SOURCE = 'local'; process.env.GITHUB_NOTES_LOCAL_PATH = root; delete process.env.VERCEL; delete process.env.APP_URL;
const { createApp } = await import(`${product}/apps/local-server/dist/app.js`);
const server = createServer(createApp(product)); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH || (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : path.join(os.homedir(), '.cache/puppeteer/chrome/linux-131.0.6778.204/chrome-linux64/chrome'));
const browser = await puppeteer.launch({ executablePath, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const state = () => parse(fs.readFileSync(path.join(root, '.github-notes-study.yaml'), 'utf8'));
const assert = (ok, message) => { if (!ok) throw new Error(message); };
const errors = []; let page;
try {
  page = await browser.newPage(); page.on('pageerror', error => errors.push(error.message));
  await page.setViewport({ width: 1440, height: 1000 });
  await page.evaluateOnNewDocument(() => localStorage.setItem('github-notes:language', 'en'));
  const url = `http://127.0.0.1:${server.address().port}/screen`, lane = '#screen-lane-study';
  await page.goto(url, { waitUntil: 'networkidle0' });
  assert(!await page.$('.study-lane') && !await page.$('.screen-lane-focus'), 'Study is still a lane layout or there is an extra fullscreen button');
  assert(await page.$eval(`${lane} .screen-card-title`, node => node.textContent === 'Other'), 'Ordinary title sorting is wrong');
  assert(await page.$$eval(`${lane} .screen-view-tabs button`, buttons => buttons.length === 3), 'Study appears in view tabs');
  await page.click(`${lane} .screen-start-study`);
  await page.waitForSelector('.screen-study-session');
  assert(!await page.$('.screen-sort-select') && !await page.$('.study-sort-hint') && !await page.$('.screen-focus-header h2'), 'Study navbar contains a sort selector or redundant heading');
  assert(fs.readFileSync(path.join(root, '.github-notes-screen.yaml'), 'utf8') === initialScreen, 'Starting study changed the lane layout');
  const waitCard = async () => page.waitForSelector(`${lane} [data-study-note="notes/example/vocabulary.md"]`);
  const saved = async count => {
    await page.waitForFunction(async count => {
      const value = await fetch('/api/study').then(response => response.json());
      return value.study.events.length === count;
    }, {}, count);
    assert(state().events.length === count, 'Unexpected event count');
  };
  const undo = async count => { await page.click(`${lane} button[aria-label="Undo last action"]`); await saved(count); await waitCard(); };
  await waitCard();
  assert(!await page.$('.study-dialog'), 'Study is still a note dialog');
  assert(!await page.$(`${lane} .study-ratings`), 'Answer ratings shown before reveal');
  assert(!await page.$eval(`${lane} .study-page`, node => node.textContent.includes('Give up.')), 'Answer leaked');
  let count = 0;
  await page.click(`${lane} button[aria-label="Next card"]`);
  await page.waitForSelector(`${lane} [data-study-note="notes/example/other.md"]`);
  await page.click(`${lane} button[aria-label="Previous card"]`); await waitCard();
  assert(fs.readFileSync(path.join(root, '.github-notes-study.yaml'), 'utf8') === initialStudy, 'Browsing cards wrote a study event');
  await page.click(`${lane} .study-reveal`);
  await page.click(`${lane} button[aria-label="Previous page"]`);
  assert(await page.$eval(`${lane} .study-page`, node => node.textContent.includes('What does abandon mean?')), 'Cannot return to the question');
  await page.click(`${lane} button[aria-label="Next page"]`);
  assert(await page.$eval(`${lane} .study-page`, node => node.textContent.includes('Give up.')), 'Cannot return to the revealed answer');
  await page.click(`${lane} button[aria-label="Next page"]`);
  assert(await page.$eval(`${lane} .study-page`, node => node.textContent.includes('They abandoned the plan.')), 'Later answer page missing');
  await page.reload({ waitUntil: 'networkidle0' }); await waitCard();
  console.log('PASS previous/next cards without writes and question/answer page navigation');
  for (const [rating, status, days] of [[1, 'new', 1], [2, 'new', 1], [3, 'learning', 3], [4, 'review', 7]]) {
    await page.click(`${lane} .study-reveal`);
    assert(await page.$eval(`${lane} .study-page`, node => node.textContent.includes('Give up.')), 'Answer not revealed');
    await page.click(`${lane} [data-rating="${rating}"]`); await saved(++count);
    const note = state().notes.find(note => note.path === 'notes/example/vocabulary.md'), event = state().events.at(-1);
    assert(note.stage.status === status && event.transition.intervalDays === days, 'Wrong stage or interval');
    assert(Math.abs(Date.parse(note.stage.due) - Date.parse(event.at) - days * 86400000) < 5, 'Interval differs from destination stage');
    const disk = parse(fs.readFileSync(path.join(root, 'notes/example/vocabulary.md'), 'utf8').split('---')[1]);
    assert(disk.status === status && disk.custom === 'keep-me', 'Status was not persisted or metadata changed');
    await page.waitForFunction(selector => document.querySelector(selector)?.getAttribute('data-study-note') !== 'notes/example/vocabulary.md', {}, `${lane} [data-study-note]`);

    await undo(++count);
  }
  console.log('PASS four familiarity levels, destination intervals, status routing, next card and undo');
  await page.click('.screen-focus-header button[aria-label="Edit swimlane: Study"]');
  await chooseSelect(page, 'dialog[open] .study-stage-settings .select-trigger', 'last');
  await page.click('dialog[open] .workspace-dialog-actions .ui-button-primary');
  await page.waitForFunction(() => !Object.keys(localStorage).some(key => key.startsWith('github-notes:screen-draft:')));
  await page.click(`${lane} .study-reveal`); await page.click(`${lane} [data-rating="4"]`); await saved(++count);
  assert(state().events.at(-1).transition.toStatus === 'known' && state().events.at(-1).transition.intervalDays === 30, 'Easy-to-last setting ignored');
  await undo(++count);
  console.log('PASS due-first session order independent of lane title sort and configurable easy-to-last progression');
  let failSave = true;
  await page.setRequestInterception(true);
  page.on('request', request => {
    if (failSave && request.method() === 'POST' && new URL(request.url()).pathname === '/api/study/action') void request.respond({ status: 503, contentType: 'application/json', body: '{"error":"Temporary outage"}' });
    else void request.continue();
  });
  await page.click(`${lane} .study-reveal`); await page.click(`${lane} [data-rating="3"]`);
  await page.waitForSelector(`${lane} .study-alert`);
  assert(state().events.length === count && await page.$(`${lane} [data-study-note="notes/example/vocabulary.md"] .study-ratings`), 'Failed save advanced the card or lost the answer');
  failSave = false; await page.click(`${lane} [data-rating="3"]`); await saved(++count); await undo(++count);
  console.log('PASS failed-save feedback and retry without duplicate history');
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  await page.reload({ waitUntil: 'networkidle0' }); await waitCard();
  const cdp = await page.createCDPSession();
  const swipe = async (selector, direction) => {
    await page.$eval(selector, element => element.scrollIntoView({ block: 'center' }));
    const box = await (await page.$(selector)).boundingBox(), y = box.y + box.height / 2;
    const start = box.x + box.width * (direction === 'right' ? .2 : .8), end = box.x + box.width * (direction === 'right' ? .8 : .2);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: start, y }] });
    for (let i = 1; i <= 6; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: start + (end - start) * i / 6, y }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  };
  await swipe(`${lane} .study-page`, 'right'); assert(state().events.length === count, 'Question swipe recorded a rating');
  await page.click(`${lane} .study-reveal`); await swipe(`${lane} .study-page`, 'right'); await saved(++count); await undo(++count);
  await page.click(`${lane} .study-reveal`); await swipe(`${lane} .study-page`, 'left'); await saved(++count); assert(state().events.at(-1).rating === 1, 'Left swipe did not reset stage'); await undo(++count);
  for (const width of [320, 390]) {
    await page.setViewport({ width, height: 844, isMobile: true, hasTouch: true });
    await page.click(`${lane} .study-reveal`);
    assert(await page.$$eval(`${lane} .study-ratings button`, buttons => buttons.every(button => { const box = button.getBoundingClientRect(); return box.width > 40 && box.left >= 0 && box.right <= innerWidth && box.height >= 44; })), 'Rating controls overflow');
    fs.mkdirSync(path.join(product, 'artifacts/qa'), { recursive: true }); await page.screenshot({ path: path.join(product, `artifacts/qa/study-lane-${width}.png`) });
    await page.reload({ waitUntil: 'networkidle0' }); await waitCard();
  }
  console.log('PASS mobile inline card, reveal gate, native touch ratings and 320/390px controls');
  await page.goto(url.replace('/screen', '/screen/lanes/reading?mode=reading'), { waitUntil: 'networkidle0' });
  const reading = '#screen-lane-reading';
  await chooseSelect(page, `${reading} .study-pick-card`, 'notes/example/vocabulary.md');
  await swipe(`${reading} .study-page`, 'left');
  await page.waitForFunction(selector => document.querySelector(selector)?.textContent.includes('Give up.'), {}, `${reading} .study-page`);
  await page.click(`${reading} [data-rating="2"]`); await saved(++count);
  assert(state().events.at(-1).kind === 'stage-read' && state().notes[0].cards[0].scheduler.reps === 0, 'Reading became an FSRS recall');
  await chooseSelect(page, `${reading} .study-pick-card`, 'notes/example/vocabulary.md');
  await page.click(`${reading} .study-postpone summary`);
  const custom = await page.$eval(`${reading} input[type="datetime-local"]`, input => {
    const value = `${new Date().getFullYear() + 1}-01-02T12:34`;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); return new Date(value).toISOString();
  });
  await page.click(`${reading} .study-postpone button`); await saved(++count);
  assert(state().notes.find(note => note.path === 'notes/example/vocabulary.md').stage.due === custom, 'Custom postponement was lost');
  console.log('PASS reading lane page swipes, reading events and manual postponement');
  await page.goto(url, { waitUntil: 'networkidle0' });
  await page.click(`${lane} .screen-lane-query-toggle`);
  await page.select(`${lane} .screen-lane-filter select`, '');
  await page.waitForFunction(() => !Object.keys(localStorage).some(key => key.startsWith('github-notes:screen-draft:')));
  await page.click(`${lane} .screen-start-study`);
  await page.waitForFunction(() => location.pathname === '/screen/lanes/study');
  await page.reload({ waitUntil: 'networkidle0' });
  assert(await page.$$eval('.screen-study-session', lanes => lanes.length === 1), 'Focus page includes other lanes');
  assert(await page.$eval('.workspace-header', header => header.getBoundingClientRect().height === 0), 'Global header visible in focus mode');
  assert(!await page.$('[data-sidebar-toggle]'), 'Sidebar toggle remains in focus mode');
  await chooseSelect(page, `${lane} .study-pick-card`, 'notes/example/other.md');
  await page.click('.study-card-navigation button[aria-label="Next card"]');
  await page.waitForSelector(`${lane} [data-study-note="notes/example/vocabulary.md"]`);
  await page.click(`${lane} .study-reveal`);
  await page.click(`${lane} button[aria-label="Previous page"]`);
  assert(await page.$eval(`${lane} .study-page`, node => node.textContent.includes('What does abandon mean?')), 'Focused mobile answer cannot return to question');
  await page.click(`${lane} button[aria-label="Next page"]`);
  assert(await page.$$eval('.study-ratings button', buttons => buttons.every(button => { const rect = button.getBoundingClientRect(); return rect.left >= 0 && rect.right <= innerWidth && rect.height >= 44; })), 'Focused mobile rating controls overflow');
  await page.screenshot({ path: path.join(product, 'artifacts/qa/study-focus-mobile.png') });
  await page.click(`${lane} [data-rating="3"]`); await saved(++count); await undo(++count);
  await page.click(`${lane} button[aria-label="Open link: Vocabulary"]`);
  await page.waitForSelector('[data-markdown-editor]');
  assert(new URL(page.url()).searchParams.get('returnTo').startsWith('/screen/lanes/study'), 'Editor lost focused origin');
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForSelector('[data-markdown-editor]');
  await page.click('.note-close');
  await page.waitForFunction(() => location.pathname === '/screen/lanes/study');
  await page.click('.study-back');
  await page.waitForSelector('[data-sidebar-toggle]');
  assert(await page.$$eval('.screen-lane', lanes => lanes.length === 3), 'Returning did not restore screen lanes');
  await page.goto(url.replace('/screen', '/screen/lanes/missing'), { waitUntil: 'networkidle0' });
  await page.waitForSelector('.screen-board-empty[role="status"]');
  await page.click('.study-back');
  console.log('PASS focused route reload, mobile paging/navigation, editor return and missing lane recovery');
  await page.goto(url.replace('/screen', '/screen/lanes/study'), { waitUntil: 'networkidle0' });
  for (const width of [320, 390, 820, 1440]) {
    await page.setViewport({ width, height: 844, isMobile: width < 768, hasTouch: width < 768 });
    await page.reload({ waitUntil: 'networkidle0' });
    assert(await page.$eval('.screen-focus-header', header => {
      const controls = [...header.querySelectorAll('button,select')].map(control => control.getBoundingClientRect());
      return header.getBoundingClientRect().height <= 62 && controls.every(rect => rect.left >= 0 && rect.right <= innerWidth && rect.height >= 44 && Math.abs(rect.top - controls[0].top) < 2);
    }), `Study navbar is not a single reachable row at ${width}px`);
  }
  await page.select('.study-navbar select', 'future');
  await page.reload({ waitUntil: 'networkidle0' });
  assert(await page.$eval('.study-navbar select', select => select.value === 'future'), 'Study filter lost on reload');
  await page.select('.study-navbar select', 'all');
  const { THEMES } = await import(`${product}/apps/web/src/lib/themes.ts`);
  for (const theme of THEMES) {
    await page.evaluate(id => localStorage.setItem('github_notes_theme', id), theme.id);
    await page.reload({ waitUntil: 'networkidle0' }); await page.waitForSelector('.study-mode-tabs button');
    for (const selector of ['.study-mode-tabs [aria-pressed="true"]', '.study-mode-tabs [aria-pressed="false"]', '.study-back', '.study-reveal']) {
      const button = await page.$(selector); if (!button) continue;
      await button.hover();
      await page.waitForFunction(selector => document.querySelector(selector).getAnimations().every(animation => animation.playState !== 'running'), {}, selector);
      assert(await button.evaluate(element => {
        const style = getComputedStyle(element);
        const luminance = color => { const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1; const context = canvas.getContext('2d'); context.fillStyle = color; context.fillRect(0, 0, 1, 1); const rgb = [...context.getImageData(0, 0, 1, 1).data].slice(0, 3).map(value => value / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4); return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722; };
        const a = luminance(style.backgroundColor), b = luminance(style.color);
        return (Math.max(a, b) + .05) / (Math.min(a, b) + .05) >= 4.5;
      }), `Shared button hover contrast failed: ${theme.id} ${selector}`);
    }
    await page.focus('.study-back'); await page.keyboard.press('Tab');
    assert(await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle !== 'none'), 'Shared button lost keyboard focus indication');
    const disabled = await page.$('.study-card-navigation button:disabled');
    if (disabled) {
      const before = await page.$eval('[data-study-note]', node => node.getAttribute('data-study-note'));
      await disabled.click();
      assert(await page.$eval('[data-study-note]', node => node.getAttribute('data-study-note')) === before, 'Disabled navigation changed card');
    }
  }
  console.log('PASS one-row study navbar, filter persistence and shared button hover/focus/disabled states across all themes');
  const diskBefore = fs.readFileSync(path.join(root, 'notes/example/vocabulary.md'), 'utf8');
  await page.setViewport({ width: 1440, height: 1000, isMobile: false, hasTouch: false });
  await page.goto(url.replace('/screen', '/notebooks/example/notes/vocabulary.md'), { waitUntil: 'networkidle0' });
  await page.waitForSelector('.live-md-page-break');
  assert(await page.$$eval('.live-md-page-break', elements => elements.length === 2 && elements.every(element => { const box = element.getBoundingClientRect(); return box.width > 200 && box.height >= 48; })), 'Markdown page boundaries disappeared');
  assert(fs.readFileSync(path.join(root, 'notes/example/vocabulary.md'), 'utf8') === diskBefore, 'Opening page layout rewrote Markdown');
  await page.screenshot({ path: path.join(product, 'artifacts/qa/note-page-layout.png') });
  assert(!errors.length, errors.join('; '));
  console.log('PASS visible editor page boundaries and unchanged Markdown');
} catch (error) {
  if (page) { console.error(await page.evaluate(() => ({ url: location.href, alerts: [...document.querySelectorAll('[role="alert"]')].map(node => node.textContent) }))); await page.screenshot({ path: path.join(product, 'artifacts/qa/study-failure.png') }); }
  throw error;
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); fs.rmSync(root, { recursive: true, force: true }); }
