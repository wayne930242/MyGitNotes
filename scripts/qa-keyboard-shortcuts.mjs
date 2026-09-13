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
write('notes/example/example.md', '# Example\n');
git('init', '-b', 'main'); git('config', 'user.name', 'QA'); git('config', 'user.email', 'qa@example.com'); git('add', '.'); git('commit', '-m', 'fixture');
process.env.GITHUB_NOTES_SOURCE = 'local'; process.env.GITHUB_NOTES_LOCAL_PATH = root; delete process.env.VERCEL; delete process.env.APP_URL;
const { createApp } = await import(`${product}/apps/local-server/dist/app.js`);
const server = createServer(createApp(product)); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await puppeteer.launch({ executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || path.join(os.homedir(), '.cache/puppeteer/chrome/linux-131.0.6778.204/chrome-linux64/chrome'), headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage(); await page.setViewport({ width: 1440, height: 1000 });
const base = `http://127.0.0.1:${server.address().port}`;
const chord = async (...keys) => { for (const key of keys.slice(0, -1)) await page.keyboard.down(key); await page.keyboard.press(keys.at(-1)); for (const key of keys.slice(0, -1).reverse()) await page.keyboard.up(key); };
const openLeader = async () => { await page.waitForFunction(() => !document.querySelector('[aria-label="Keyboard shortcuts"]')); await chord('Control', 'Alt', 'KeyK'); await page.waitForSelector('[aria-label="Keyboard shortcuts"]'); };
const focusNav = async (label = 'Notes') => { await page.focus(`.header-nav button[aria-label="${label}"]`); };
const assert = (value, message) => { if (!value) throw Error(message); };

try {
  await page.goto(`${base}/notes`, { waitUntil: 'networkidle0' });
  await focusNav(); await chord('Control', 'KeyK');
  assert(!await page.$('[aria-label="Keyboard shortcuts"]'), 'Browser-reserved Ctrl+K still opens the application leader');
  await focusNav(); await openLeader();
  assert(await page.$eval('[aria-label="Keyboard shortcuts"]', panel => panel.getAttribute('data-mode')) === 'leader', 'Primary chord did not open pending leader mode');
  assert(await page.$$eval('[aria-label="Keyboard shortcuts"] [data-shortcut-key]', items => items.map(item => item.getAttribute('data-shortcut-key')).join(',')) === '1,2,3,4,N,/,comma,?', 'Leader command set is incomplete');
  assert(await page.$eval('[aria-label="Keyboard shortcuts"]', panel => panel === document.activeElement), 'Leader panel did not receive focus');
  await page.keyboard.press('Escape');
  assert(await page.$eval('.header-nav button[aria-label="Notes"]', button => button === document.activeElement), 'Escape did not restore previous focus');

  await focusNav(); await openLeader(); await new Promise(resolve => setTimeout(resolve, 2800));
  assert(!await page.$('[aria-label="Keyboard shortcuts"]'), 'Pending leader did not expire');

  await page.focus('.header-search input'); await chord('Control', 'KeyK');
  assert(!await page.$('[aria-label="Keyboard shortcuts"]'), 'Browser-reserved Ctrl+K intercepted an editable control');
  await chord('Control', 'Alt', 'KeyK'); await page.waitForSelector('[aria-label="Keyboard shortcuts"]'); await page.keyboard.press('Escape');

  for (const [key, route] of [['2', '/agent'], ['3', '/assets'], ['4', '/screen'], ['1', '/notebooks/example']]) {
    await focusNav(route === '/agent' ? 'Agent System' : route === '/assets' ? 'Assets' : route === '/screen' ? 'Screen' : 'Notes');
    await openLeader(); await page.keyboard.press(key); await page.waitForFunction(expected => location.pathname === expected, {}, route);
  }

  await focusNav(); await openLeader(); await page.keyboard.press('KeyN'); await page.waitForSelector('input[placeholder="e.g. Sprint Planning, Project Ideas..."]');
  await page.evaluate(() => [...document.querySelectorAll('button')].find(button => button.textContent.trim() === 'Cancel').click());
  await focusNav(); await openLeader(); await page.keyboard.press('/');
  await page.waitForFunction(() => document.querySelector('.header-search input') === document.activeElement);

  await chord('Control', 'Alt', 'KeyK'); await page.waitForSelector('[aria-label="Keyboard shortcuts"]'); await page.keyboard.press(',');
  await page.waitForFunction(() => location.pathname === '/settings');
  await focusNav('Notes'); await openLeader(); await page.keyboard.press('?');
  assert(await page.$eval('[aria-label="Keyboard shortcuts"]', panel => panel.getAttribute('data-mode')) === 'help', 'Question mark did not pin keyboard help');
  await new Promise(resolve => setTimeout(resolve, 2800));
  assert(await page.$('[aria-label="Keyboard shortcuts"]'), 'Pinned keyboard help expired');
  await page.keyboard.press('Escape');

  await focusNav('Agent System'); await openLeader();
  assert(await page.$eval('[data-shortcut-key="/"]', item => item.getAttribute('aria-disabled')) === 'true', 'Search command is not disabled outside Notes');
  await page.keyboard.press('/');
  assert(await page.$('[aria-label="Keyboard shortcuts"]') && new URL(page.url()).pathname === '/settings', 'Disabled command executed or dismissed the panel');
  await page.keyboard.press('Escape');
  console.log('PASS reserved Ctrl+K, global Ctrl+Alt+K leader/help, timeout, focus restoration, navigation, New note, search, Settings and contextual disablement');
} finally {
  await browser.close(); await new Promise(resolve => server.close(resolve)); fs.rmSync(root, { recursive: true, force: true });
}
