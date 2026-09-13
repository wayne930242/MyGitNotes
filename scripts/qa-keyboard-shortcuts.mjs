import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';

const product = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(`${product}/apps/web/package.json`);
const puppeteer = require('puppeteer-core');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'github-notes-shortcuts-'));
const write = (file, content) => { fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true }); fs.writeFileSync(path.join(root, file), content); };
const git = (...args) => execFileSync('git', args, { cwd: root, stdio: 'pipe' });
write('.github-notes.yaml', 'schema_version: 1\nworkspace:\n  title: Shortcut QA\n  default_notebook: example\nnotebooks:\n  - id: example\n    title: Example\n    root: notes/example\n');
write('notes/example/example.md', '# Example\n\nAlpha needle.\n\n## Section Two\n\nSecond needle.\n');
git('init', '-b', 'main'); git('config', 'user.name', 'QA'); git('config', 'user.email', 'qa@example.com'); git('add', '.'); git('commit', '-m', 'fixture');
process.env.GITHUB_NOTES_SOURCE = 'local'; process.env.GITHUB_NOTES_LOCAL_PATH = root; delete process.env.VERCEL; delete process.env.APP_URL;
const { createApp } = await import(`${product}/apps/local-server/dist/app.js`);
const server = createServer(createApp(product)); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await puppeteer.launch({ executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || path.join(os.homedir(), '.cache/puppeteer/chrome/linux-131.0.6778.204/chrome-linux64/chrome'), headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage(); await page.setViewport({ width: 1440, height: 1000 });
const base = `http://127.0.0.1:${server.address().port}`;
const chord = async (...keys) => { for (const key of keys.slice(0, -1)) await page.keyboard.down(key); await page.keyboard.press(keys.at(-1)); for (const key of keys.slice(0, -1).reverse()) await page.keyboard.up(key); };
const palette = '[aria-label="Commands"]';
const help = '[aria-label="Keyboard shortcuts"]';
const openPalette = async () => {
  await page.waitForFunction(selector => !document.querySelector(selector), {}, palette);
  await page.$eval('[data-header-command]', button => button.click());
  await page.waitForSelector(palette);
};
const focusNav = async (label = 'Notes') => { await page.focus(`.header-nav button[aria-label="${label}"]`); };
const assert = (value, message) => { if (!value) throw Error(message); };

try {
  await page.goto(`${base}/notes`, { waitUntil: 'networkidle0' });
  await focusNav(); await openPalette();
  assert(await page.$eval(palette, panel => panel.getAttribute('data-mode')) === 'palette', 'Alt+/ did not open command palette mode');
  assert(await page.$$eval(`${palette} [data-shortcut-key]`, items => items.map(item => item.getAttribute('data-shortcut-key')).join(',')) === '1,2,3,4,N,/,comma,?', 'Palette command set is incomplete');
  assert(await page.$eval(`${palette} input`, input => input === document.activeElement), 'Palette search did not receive focus');
  await page.keyboard.press('Escape');
  assert(await page.$eval('.header-nav button[aria-label="Notes"]', button => button === document.activeElement), 'Escape did not restore previous focus');

  await focusNav(); await openPalette(); await new Promise(resolve => setTimeout(resolve, 2800));
  assert(await page.$(palette), 'Command palette closed on a timer');
  await page.keyboard.press('Escape');

  await page.click('[data-header-command]'); await page.waitForSelector(palette);
  await page.type(`${palette} input`, 'agent'); await page.keyboard.press('Enter');
  await page.waitForFunction(selector => !document.querySelector(selector), {}, palette);
  await page.waitForFunction(() => location.pathname === '/agent');

  for (const [key, route] of [['2', '/agent'], ['3', '/assets'], ['4', '/screen'], ['1', '/notebooks/example']]) {
    await focusNav(route === '/agent' ? 'Agent System' : route === '/assets' ? 'Assets' : route === '/screen' ? 'Screen' : 'Notes');
    await openPalette(); await page.keyboard.press(key); await page.waitForFunction(selector => !document.querySelector(selector), {}, palette); await page.waitForFunction(expected => location.pathname === expected, {}, route);
  }

  await focusNav(); await openPalette(); await chord('Shift', 'KeyN'); await page.waitForSelector('input[placeholder="e.g. Sprint Planning, Project Ideas..."]');
  await page.evaluate(() => [...document.querySelectorAll('button')].find(button => button.textContent.trim() === 'Cancel').click());
  await focusNav(); await openPalette(); await page.keyboard.press('/');
  await page.waitForFunction(() => document.querySelector('.header-search input') === document.activeElement);

  await openPalette(); await page.keyboard.press(',');
  await page.waitForFunction(() => location.pathname === '/settings');
  await focusNav('Notes'); await chord('Control', 'Slash'); await page.waitForSelector(help);
  assert(await page.$eval(help, panel => panel.getAttribute('data-mode')) === 'help', 'Ctrl+/ did not open keyboard help');
  await new Promise(resolve => setTimeout(resolve, 2800));
  assert(await page.$(help), 'Keyboard help closed on a timer');
  await page.keyboard.press('Escape');

  await openPalette(); await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
  await page.waitForFunction(() => location.pathname === '/agent');

  await focusNav('Agent System'); await openPalette();
  assert(await page.$eval('[data-shortcut-key="/"]', item => item.getAttribute('aria-disabled')) === 'true', 'Search command is not disabled outside Notes');
  await page.keyboard.press('/');
  assert(await page.$(palette) && new URL(page.url()).pathname === '/agent', 'Disabled command executed or dismissed the palette');
  await page.keyboard.type('no-such-command');
  assert(await page.$(`${palette} [role="status"]`), 'No-results state is missing');
  await page.keyboard.press('Escape');
  await openPalette(); await page.mouse.click(20, 300); await page.waitForFunction(selector => !document.querySelector(selector), {}, palette);
  await page.goto(`${base}/notebooks/example/notes/example.md`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('[aria-label="Note editor"]');
  assert(await page.$$eval('.header-nav button', buttons => buttons.every(button => button.disabled)), 'Home navigation remains active while note editor is open');
  assert(!await page.$(palette), 'Command palette opened while note editor is open');
  await page.click('[aria-label="Find in note"]'); await page.waitForSelector('[role="search"][aria-label="Find in note"] input');
  await page.type('[role="search"][aria-label="Find in note"] input', 'needle');
  assert((await page.$eval('.note-find-count', node => node.textContent)) === '1 of 2', 'Find did not report the first of two full-note matches');
  await page.keyboard.press('Enter');
  assert((await page.$eval('.note-find-count', node => node.textContent)) === '2 of 2', 'Enter did not advance note search');
  await page.keyboard.press('Escape');
  await page.click('[aria-label="Outline"]'); await page.waitForSelector('.note-outline');
  assert(await page.$$eval('.note-outline nav button', buttons => buttons.map(button => button.textContent.trim()).join('|')) === 'Example1|Section Two5', 'Markdown outline is incomplete');
  await page.keyboard.press('j');
  assert((await page.$eval('.note-outline nav button[aria-current="true"] span', node => node.textContent)) === 'Section Two', 'J did not move outline focus');
  await page.keyboard.press('k');
  assert((await page.$eval('.note-outline nav button[aria-current="true"] span', node => node.textContent)) === 'Example', 'K did not move outline focus');
  await page.keyboard.press('Enter'); await page.waitForFunction(() => !document.querySelector('.note-outline'));
  await page.$$eval('button', buttons => buttons.find(button => button.textContent.trim() === 'Source').click());
  await page.waitForSelector('textarea[aria-label="Note content"]');
  await page.click('[aria-label="Find in note"]'); await page.waitForFunction(() => document.activeElement?.matches('[role="search"][aria-label="Find in note"] input')); await new Promise(resolve => setTimeout(resolve, 30)); await chord('Control', 'a'); await page.keyboard.type('Second');
  await page.waitForFunction(() => document.querySelector('.note-find-count')?.textContent === '1 of 1');
  await page.waitForFunction(() => { const input = document.querySelector('textarea[aria-label="Note content"]'); return input.selectionStart === input.value.indexOf('Second'); });
  await page.keyboard.press('Escape'); await page.click('[aria-label="Outline"]');
  await page.$$eval('.note-outline nav button', buttons => buttons.find(button => button.textContent.includes('Section Two')).click());
  assert(await page.$eval('textarea[aria-label="Note content"]', input => input.selectionStart === input.value.indexOf('## Section Two')), 'Source outline did not jump to its heading');
  console.log('PASS Alt+/ searchable command palette, visible launcher, persistent lifetime, focus restoration, quick keys, arrow navigation, help, outside dismissal, contextual disablement, editor navigation suspension, leader find, J/K outline and Live/Source navigation');
} finally {
  await browser.close(); await new Promise(resolve => server.close(resolve)); fs.rmSync(root, { recursive: true, force: true });
}
