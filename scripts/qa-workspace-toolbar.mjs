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
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'github-notes-toolbar-qa-'));
const write = (file, text) => { fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true }); fs.writeFileSync(path.join(root, file), text); };
const git = (...args) => execFileSync('git', args, { cwd: root, stdio: 'pipe' });
const original = '---\ntitle: Vocabulary\nstatus: working\ncustom: keep-me\n---\n\nWhat does abandon mean?\n\n---\n\nGive up.\n\n---\n\nThey abandoned the plan.\n' + '\nA longer example paragraph for reading and scrolling.\n'.repeat(40);
write('.github-notes.yaml', 'schema_version: 1\nworkspace:\n  title: Study QA\n  default_notebook: example\nnotebooks:\n  - id: example\n    title: Example\n    root: notes/example\n');
write('notes/example/vocabulary.md', original);
write('notes/example/other.md', '# Other\n\nA single-page note.');
write('notes/AGENTS.md', '# Workspace guide\n');
write('.github-notes-screen.yaml', JSON.stringify({ version: 1, rows: [
  { id: 'reading', name: 'Reading', kind: 'dynamic', view: 'medium', source: { kind: 'folder', notebookId: 'example', path: 'notes/example', recursive: true } },
  { id: 'custom', name: 'Custom', kind: 'custom', view: 'small', items: [] },
] }));
git('init', '-b', 'main'); git('config', 'user.name', 'QA'); git('config', 'user.email', 'qa@example.com'); git('add', '.'); git('commit', '-m', 'fixture');
process.env.GITHUB_NOTES_SOURCE = 'local'; process.env.GITHUB_NOTES_LOCAL_PATH = root; delete process.env.VERCEL; delete process.env.APP_URL;
const { createApp } = await import(`${product}/apps/local-server/dist/app.js`);
const server = createServer(createApp(product)); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH || (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : path.join(os.homedir(), '.cache/puppeteer/chrome/linux-131.0.6778.204/chrome-linux64/chrome'));
const browser = await puppeteer.launch({ executablePath, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const assert = (ok, message) => { if (!ok) throw new Error(message); };
const page = await browser.newPage(), errors = [];
page.on('pageerror', error => errors.push(error.message));
await page.evaluateOnNewDocument(() => { if (location.protocol === 'http:') localStorage.setItem('github-notes:language', 'zh-TW'); });
const base = `http://127.0.0.1:${server.address().port}`;
const fits = async selector => {
  await page.$eval(selector, element => element.scrollIntoView({ block: 'center' }));
  assert(await page.$eval(selector, element => {
  const box = element.getBoundingClientRect();
  return box.width > 0 && box.left >= 0 && box.right <= innerWidth && box.top >= 0 && box.bottom <= innerHeight;
}), `Control outside viewport: ${selector}`);
};
try {
  for (const width of [320, 390, 820, 1440]) {
    await page.setViewport({ width, height: 844, isMobile: width < 768, hasTouch: width < 1101, deviceScaleFactor: 1 });
    for (const route of ['notes', 'screen', 'assets', 'agent', 'settings']) {
      await page.goto(`${base}/${route}`, { waitUntil: 'networkidle0' });
      await page.waitForSelector('#workspace-sidebar-toggle-slot [data-sidebar-toggle]');
      assert(await page.$$eval('[data-sidebar-toggle]', buttons => buttons.length === 1), `Duplicate sidebar toggle: ${route}`);
      if (width < 1101) {
        await fits('[data-sidebar-toggle]');
        assert(await page.$eval('.header-notebook', header => {
          const toggle = header.querySelector('[data-sidebar-toggle]').getBoundingClientRect();
          const select = header.querySelector('.select-trigger').getBoundingClientRect();
          return Math.abs(toggle.top + toggle.height / 2 - select.top - select.height / 2) < 2;
        }), `Notebook and sidebar are on different rows: ${route}`);
        await page.click('[data-sidebar-toggle]');
        const panel = route === 'notes' ? '#notebook-panel' : '[data-responsive-sidebar]';
        await page.waitForFunction(selector => document.querySelector(selector)?.classList.contains('is-open'), {}, panel);
        assert(await page.$eval('[data-sidebar-toggle]', button => button.getAttribute('aria-expanded') === 'true'), 'Toggle does not reflect open state');
        await page.click('[data-sidebar-toggle]');
        await page.waitForFunction(selector => !document.querySelector(selector)?.classList.contains('is-open'), {}, panel);
      } else {
        assert(await page.$eval('[data-sidebar-toggle]', button => button.getBoundingClientRect().width === 0), `Mobile toggle visible on desktop: ${route}`);
      }
    }
    await page.goto(`${base}/screen`, { waitUntil: 'networkidle0' });
    await page.waitForSelector('.screen-lane-header');
    assert(!await page.$('.study-lane') && !await page.$('.study-stage-settings'), 'Ordinary lanes enabled study by default');
    assert(await page.$$eval('#screen-lane-reading .screen-lane-filter', labels => labels.length === 1), 'Study filtering appears in an ordinary lane');
    if (width < 768) {
      for (const lane of ['reading', 'custom']) {
        const prefix = `#screen-lane-${lane}`;
        assert(await page.$eval(`${prefix} .screen-lane-actions`, toolbar => toolbar.getBoundingClientRect().height <= 52), 'Collapsed mobile toolbar occupies multiple rows');
        await page.click(`${prefix} .screen-lane-query-toggle`);
        await fits(`${prefix} .screen-lane-query`);
        await fits(`${prefix} .screen-lane-filter select`);
        assert(await page.$$eval(`${prefix} .screen-lane-filter`, labels => labels.every(label => getComputedStyle(label).whiteSpace === 'nowrap')), 'Filter labels wrap');
        await page.click(`${prefix} .screen-lane-query-toggle`);
      }
      await page.click('#screen-lane-reading .screen-lane-query-toggle');
    } else {
      assert(await page.$$eval('.screen-lane-filter', labels => labels.every(label => label.closest('.screen-lane-header') && getComputedStyle(label).whiteSpace === 'nowrap')), 'Filters are detached from toolbar or wrap');
    }
    await page.select('#screen-lane-reading .screen-lane-filter select', 'inbox');
    await page.waitForFunction(() => document.querySelectorAll('#screen-lane-reading .screen-card').length === 0);
    await page.select('#screen-lane-reading .screen-lane-filter select', '');
    await page.waitForFunction(() => document.querySelectorAll('#screen-lane-reading .screen-card').length === 2);
    await page.click('#screen-lane-reading .screen-sort-select');
    await page.click('[data-option-value="title:desc"]');
    await page.waitForFunction(() => !Object.keys(localStorage).some(key => key.startsWith('github-notes:screen-draft:')));
    await page.reload({ waitUntil: 'networkidle0' });
    assert(await page.$eval('#screen-lane-reading .screen-sort-select', select => select.getAttribute('value') === 'title:desc'), 'Sort was lost on reload');
    fs.mkdirSync(path.join(product, 'artifacts/qa'), { recursive: true });
    await page.screenshot({ path: path.join(product, `artifacts/qa/workspace-toolbar-${width}.png`) });
    console.log(`PASS shared header on five pages, compact lane toolbar, filtering and saved sorting at ${width}px`);
  }
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await page.goto(`${base}/notes`, { waitUntil: 'networkidle0' });
  for (const [route, selector] of [['screen', '.header-nav button[aria-label="屏幕"]'], ['assets', '.header-nav button[aria-label="資源庫"]'], ['agent', '.header-nav button[aria-label="Agent 系統"]'], ['settings', '.header-settings'], ['notes', '.header-nav button[aria-label="筆記"]']]) {
    await page.click(selector);
    await page.waitForFunction(route => document.querySelector('.app-shell')?.getAttribute('data-workspace-tab') === route, {}, route);
    await page.waitForFunction(() => document.querySelectorAll('#workspace-sidebar-toggle-slot [data-sidebar-toggle]').length === 1);
    await page.click('[data-sidebar-toggle]');
    const panel = route === 'notes' ? '#notebook-panel' : '[data-responsive-sidebar]';
    await page.waitForFunction(selector => document.querySelector(selector)?.classList.contains('is-open'), {}, panel);
    await page.click('[data-sidebar-toggle]');
  }
  console.log('PASS sidebar ownership through client-side navigation');
  await page.setViewport({ width: 320, height: 420, isMobile: true, hasTouch: true });
  await page.goto(`${base}/agent`, { waitUntil: 'networkidle0' });
  await fits('[data-sidebar-toggle]');
  await fits('.header-notebook .select-trigger');
  assert(await page.$eval('[data-markdown-editor]', editor => editor.getBoundingClientRect().height >= 100), 'Reduced-height header crowds out editor');
  await page.setViewport({ width: 1440, height: 1000, isMobile: false, hasTouch: false });
  await page.goto(`${base}/screen`, { waitUntil: 'networkidle0' });
  await page.click('.screen-sidebar-controls button');
  await page.waitForSelector('dialog[open]');
  assert(await page.$eval('dialog[open] .select-trigger[aria-label]', select => select.getAttribute('value') === 'small'), 'New lane defaults to study');
  assert(!await page.$('dialog[open] .study-stage-settings'), 'Ordinary lane settings contain a progression editor');
  await page.click('dialog[open] .workspace-dialog-actions .ui-button-primary');
  await page.waitForFunction(() => !Object.keys(localStorage).some(key => key.startsWith('github-notes:screen-draft:')));
  const readScreen = () => parse(fs.readFileSync(path.join(root, '.github-notes-screen.yaml'), 'utf8'));
  assert(readScreen().rows.at(-1).view === 'small' && !readScreen().rows.at(-1).progression, 'Default lane persists study configuration');
  const edit = '.screen-sidebar-lane:nth-of-type(2) button:last-child';
  await page.click(edit);
  await chooseSelect(page, 'dialog[open] .select-trigger[aria-label]', 'study');
  await page.waitForSelector('dialog[open] .study-stage-settings');
  await page.keyboard.press('Escape');
  assert(readScreen().rows[1].view === 'small' && !readScreen().rows[1].progression, 'Cancel applied study configuration');
  await page.click(edit);
  await chooseSelect(page, 'dialog[open] .select-trigger[aria-label]', 'study');
  await page.click('dialog[open] .workspace-dialog-actions .ui-button-primary');
  await page.waitForFunction(() => !Object.keys(localStorage).some(key => key.startsWith('github-notes:screen-draft:')));
  await page.waitForSelector('#screen-lane-custom .study-lane');
  assert(readScreen().rows[1].view === 'study' && readScreen().rows[1].progression.stages.length > 0, 'Explicit study opt-in was not saved');
  await page.click('#screen-lane-custom .screen-view-tabs button:nth-child(2)');
  await page.waitForFunction(() => !document.querySelector('#screen-lane-custom .study-lane'));
  await page.waitForFunction(() => !Object.keys(localStorage).some(key => key.startsWith('github-notes:screen-draft:')));
  assert(readScreen().rows[1].view === 'small', 'Ordinary mode was not restored');
  console.log('PASS ordinary lane defaults, explicit study opt-in, editing cancellation and layout restoration');
  assert(!errors.length, errors.join('; '));
  console.log('PASS reduced-height Agent header and no runtime errors');
} catch (error) {
  console.error(await page.evaluate(() => ({ url: location.href, text: document.body.innerText.slice(0, 1500) })));
  throw error;
} finally {
  await browser.close(); await new Promise(resolve => server.close(resolve)); fs.rmSync(root, { recursive: true, force: true });
}
