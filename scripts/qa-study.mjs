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
const original = '---\ntitle: Vocabulary\nstatus: working\ncustom: keep-me\n---\n\nWhat does abandon mean?\n\n---\n\nGive up.\n\n---\n\nThey abandoned the plan.\n';
write('.github-notes.yaml', 'schema_version: 1\nworkspace:\n  title: Study QA\n  default_notebook: example\nnotebooks:\n  - id: example\n    title: Example\n    root: notes/example\n');
write('notes/example/vocabulary.md', original);
write('notes/example/other.md', '# Other\n\nA single-page note.');
write('.github-notes-screen.yaml', JSON.stringify({ version: 1, rows: [
  { id: 'reading', name: 'Reading', kind: 'dynamic', view: 'medium', source: { kind: 'folder', notebookId: 'example', path: 'notes/example', recursive: true } },
] }));
git('init', '-b', 'main'); git('config', 'user.name', 'QA'); git('config', 'user.email', 'qa@example.com'); git('add', '.'); git('commit', '-m', 'fixture');
process.env.GITHUB_NOTES_SOURCE = 'local'; process.env.GITHUB_NOTES_LOCAL_PATH = root; delete process.env.VERCEL; delete process.env.APP_URL;
const { createApp } = await import(`${product}/apps/local-server/dist/app.js`);
const server = createServer(createApp(product)); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH || (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : path.join(os.homedir(), '.cache/puppeteer/chrome/linux-131.0.6778.204/chrome-linux64/chrome'));
const browser = await puppeteer.launch({ executablePath, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const state = () => parse(fs.readFileSync(path.join(root, '.github-notes-study.yaml'), 'utf8'));
const assert = (ok, message) => { if (!ok) throw new Error(message); };
const errors = [];
let page;
try {
  page = await browser.newPage(); page.on('pageerror', error => errors.push(error.message));
  await page.setViewport({ width: 1440, height: 1000 });
  await page.evaluateOnNewDocument(() => localStorage.setItem('github-notes:language', 'en'));
  const url = `http://127.0.0.1:${server.address().port}/screen`;
  await page.goto(url, { waitUntil: 'networkidle0' });
  const open = async () => { await page.waitForSelector('[aria-label="Read / study: Vocabulary"]'); await page.click('[aria-label="Read / study: Vocabulary"]'); await page.waitForSelector('.study-dialog[open]'); };
  const click = async text => {
    const button = await page.evaluateHandle(text => [...document.querySelectorAll('.study-dialog[open] button')].find(button => button.textContent.trim() === text || button.firstChild?.textContent === text), text);
    const element = button.asElement(); assert(element, `Missing button: ${text}`); await element.click(); await button.dispose();
  };
  const saved = async count => {
    await page.waitForFunction(count => !document.querySelector('.study-result')?.textContent.includes('Saving') && !document.querySelector('.study-alert'), {}, count);
    await page.waitForNetworkIdle({ idleTime: 100, timeout: 10000 });
    assert(state().events.length === count, `Expected ${count} events, got ${state().events.length}`);
  };
  await open();
  assert(await page.$eval('.study-page', element => element.textContent.includes('What does abandon mean?') && !element.textContent.includes('Give up.')), 'Reading did not start on the first page');
  await click('Next page'); assert(await page.$eval('.study-page', element => element.textContent.includes('Give up.')), 'Second page missing');
  await click('Recall');
  assert(!await page.$('.study-ratings'), 'Ratings appeared before reveal');
  await click('Show answer'); await click('Remembered'); await saved(1);
  assert(state().notes[0].cards[0].scheduler.reps === 1, 'Rating did not persist');
  await click('Undo last action'); await saved(2);
  assert(state().notes[0].cards[0].scheduler.reps === 0, 'Undo did not restore memory');
  await click('Read'); await click('Read · tomorrow'); await saved(3);
  assert(state().notes[0].cards[0].scheduler.reps === 0 && state().events.at(-1).kind === 'read', 'Reading was counted as recall');
  await click('Schedule settings');
  const fill = async (selector, value) => {
    await page.focus(selector); const length = await page.$eval(selector, element => element.value.length);
    for (let i = 0; i <= length; i++) await page.keyboard.press('ArrowRight');
    for (let i = 0; i <= length; i++) await page.keyboard.press('Backspace');
    await page.keyboard.type(value);
  };
  await fill('.study-settings input[type="number"]', '95');
  await fill('.study-settings input:not([type="number"])', '2, 5, 10');
  await click('Save settings'); await saved(4);
  assert(state().notes[0].cards[0].policy.retention === .95 && state().notes[0].cards[0].policy.intervals[0] === 2, 'Policy not persisted');
  await click('Schedule settings'); await click('Read · next interval'); await saved(5);
  assert(state().notes[0].reading.step === 1, 'Fixed reading step missing');
  await click('Skip for now');
  await page.select('.screen-study-controls select', 'future');
  await page.waitForFunction(() => document.querySelectorAll('.screen-card').length === 1);
  await page.waitForNetworkIdle({ idleTime: 500 });
  await page.reload({ waitUntil: 'networkidle0' });
  assert(await page.$eval('.screen-study-controls select', element => element.value === 'future'), 'Lane filter did not persist');
  await open(); assert(await page.$eval('.study-schedule', element => element.textContent.includes('Read again')), 'Reading schedule missing after reload');
  assert(fs.readFileSync(path.join(root, 'notes/example/vocabulary.md'), 'utf8') === original, 'Study changed Markdown or frontmatter');
  console.log('PASS desktop paging, reveal, FSRS, undo, reading, policy, fixed intervals, lane filtering and reload');

  // A real competing client changes the workspace while the dialog remains open.
  const endpoint = url.replace('/screen', '/api/study');
  const competing = await fetch(endpoint).then(response => response.json());
  competing.study.notes[0].reading.step = 7;
  assert((await fetch(endpoint, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ study: competing.study, revision: competing.revision }) })).ok, 'Competing write failed');
  await click('Read · tomorrow');
  await page.waitForSelector('.study-alert');
  assert(state().notes[0].reading.step === 7 && state().events.length === 5, 'Stale client overwrote another device');
  await click('Reload study data'); await page.waitForFunction(() => !document.querySelector('.study-alert'));
  await click('Read · tomorrow'); await saved(6);
  console.log('PASS concurrent-device conflict and explicit reload recovery');

  await click('Skip for now');
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  await page.waitForNetworkIdle({ idleTime: 300 }); await open();
  const cdp = await page.createCDPSession();
  const swipe = async direction => {
    await page.$eval('.study-page', element => element.scrollIntoView({ block: 'center' }));
    const box = await (await page.$('.study-page')).boundingBox();
    const x = box.x + box.width * (direction === 'left' ? .8 : .2), y = box.y + Math.min(box.height * .6, 100);
    const distance = box.width * (direction === 'left' ? -.6 : .6);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    for (let i = 1; i <= 8; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + distance * i / 8, y }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  };
  await swipe('left'); await page.waitForFunction(() => document.querySelector('.study-page')?.textContent.includes('Give up.'));
  await click('Recall'); await swipe('right'); assert(state().events.length === 6, 'Question swipe rated an unrevealed answer');
  await click('Show answer'); await swipe('right'); await saved(7);
  assert(state().events.at(-1).rating === 3, 'Right swipe did not rate Remembered');
  await click('Show answer'); await swipe('left'); await saved(8);
  assert(state().events.at(-1).rating === 1, 'Left swipe did not rate Forgot');
  await click('Undo last action'); await saved(9);
  for (const width of [320, 390]) {
    await page.setViewport({ width, height: 844, isMobile: true, hasTouch: true });
    const fits = await page.$eval('.study-dialog', element => { const box = element.getBoundingClientRect(); return box.x >= 0 && box.right <= innerWidth + 1 && element.scrollWidth <= element.clientWidth + 1; });
    assert(fits, `Study dialog overflows at ${width}px`);
    await page.$eval('.study-footer-actions', element => element.scrollIntoView({ block: 'center' }));
    const undo = await page.$eval('.study-footer-actions button:last-child', element => { const box = element.getBoundingClientRect(); return box.height >= 44 && box.y >= 0 && box.bottom <= innerHeight; });
    assert(undo, `Undo is unreachable at ${width}px`);
  }
  fs.mkdirSync(path.join(product, 'artifacts/qa'), { recursive: true });
  await page.screenshot({ path: path.join(product, 'artifacts/qa/study-mobile.png') });
  console.log('PASS native touch paging and ratings, reveal gate, undo and mobile controls');

  await click('Skip for now'); write('notes/example/vocabulary.md', original.replace('Give up.', 'Stop doing something.'));
  await page.reload({ waitUntil: 'networkidle0' }); await open(); await page.waitForSelector('.study-alert');
  const cardId = state().notes[0].cards[0].id;
  await click('Remap and reset memory'); await saved(10);
  assert(state().notes[0].cards[0].id === cardId && state().notes[0].cards[0].scheduler.reps === 0, 'Remapping lost identity or failed to reset');
  assert(!errors.length, errors.join('; '));
  console.log('PASS external Markdown edit detection and explicit remapping');
} catch (error) {
  fs.mkdirSync(path.join(product, 'artifacts/qa'), { recursive: true });
  if (page) { await page.screenshot({ path: path.join(product, 'artifacts/qa/study-failure.png') }); console.error(await page.$eval('body', element => element.innerText)); }
  throw error;
} finally {
  await browser.close(); await new Promise(resolve => server.close(resolve)); fs.rmSync(root, { recursive: true, force: true });
}
