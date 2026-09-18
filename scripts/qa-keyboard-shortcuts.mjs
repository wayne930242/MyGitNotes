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
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'github-notes-shortcuts-'));
const write = (file, content) => { fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true }); fs.writeFileSync(path.join(root, file), content); };
const git = (...args) => execFileSync('git', args, { cwd: root, stdio: 'pipe' });
write('.github-notes.yaml', 'schema_version: 1\nworkspace:\n  title: Shortcut QA\n  default_notebook: example\nnotebooks:\n  - id: example\n    title: Example\n    root: notes/example\n');
write('notes/example/example.md', ['# Example', '', 'Alpha needle.', '', '## Section Two', '', 'Second needle.', ...Array.from({ length: 50 }, (_, index) => `Filler line ${index + 1}`), '', '## Final Section', '', 'Last line.'].join('\n'));
git('init', '-b', 'main'); git('config', 'user.name', 'QA'); git('config', 'user.email', 'qa@example.com'); git('add', '.'); git('commit', '-m', 'fixture');
process.env.MYGITNOTES_SOURCE = 'local'; process.env.MYGITNOTES_LOCAL_PATH = root; delete process.env.VERCEL; delete process.env.APP_URL;
const { createApp } = await import(`${product}/apps/local-server/dist/app.js`);
const server = createServer(createApp(product)); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await puppeteer.launch({ executablePath: resolveQaChromePath(), headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage(); await page.setViewport({ width: 1440, height: 1000 });
const base = `http://127.0.0.1:${server.address().port}`;
const chord = async (...keys) => { for (const key of keys.slice(0, -1)) await page.keyboard.down(key); await page.keyboard.press(keys.at(-1)); for (const key of keys.slice(0, -1).reverse()) await page.keyboard.up(key); };
const primaryModifier = process.platform === 'darwin' ? 'Meta' : 'Control';
const palette = '[aria-label="Commands"]';
const help = '[aria-label="Keyboard shortcuts"]';
const openPalette = async () => {
  await page.waitForFunction(selector => !document.querySelector(selector), {}, palette);
  await page.$eval('[data-header-command]', button => button.click());
  await page.waitForSelector(palette);
};
const focusNav = async (label = 'Notes') => { const target = await page.$(`.header-nav button[aria-label="${label}"], [data-header-agent][aria-label="${label}"]`); await target?.focus(); };
const assert = (value, message) => { if (!value) throw Error(message); };
/** Types a command's name into the already-open palette and picks it, since typed text always
 *  wins over any accelerator hint shown in the list - there is no direct-key shortcut anymore. */
const chooseCommand = async (text) => {
  await page.type(`${palette} input`, text);
  await page.waitForFunction((sel, needle) => document.querySelector(sel)?.textContent.toLowerCase().includes(needle), {}, `${palette} .keyboard-shortcuts-list .is-active`, text.toLowerCase());
  await page.keyboard.press('Enter');
};

try {
  await page.goto(`${base}/notes`, { waitUntil: 'networkidle0' });
  await focusNav(); await openPalette();
  assert(await page.$eval(palette, panel => panel.getAttribute('data-mode')) === 'palette', 'Alt+/ did not open command palette mode');
  assert(await page.$$eval(`${palette} [data-shortcut-key]`, items => items.map(item => item.getAttribute('data-shortcut-key')).join(',')) === '1,2,3,4,N,/,comma,[,?', 'Palette command set is incomplete');
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

  for (const [text, route] of [['Agent System', '/agent'], ['Files', '/files'], ['Screen', '/screen'], ['Notes', '/notebooks/example']]) {
    await focusNav(route === '/agent' ? 'Agent System' : route === '/assets' ? 'Assets' : route === '/screen' ? 'Screen' : 'Notes');
    await openPalette();
    await chooseCommand(text);
    await page.waitForFunction(selector => !document.querySelector(selector), {}, palette);
    await page.waitForFunction(expected => location.pathname === expected, {}, route);
  }

  await focusNav(); await openPalette();
  await page.type(`${palette} input`, 'N');
  assert(await page.$(palette), 'Typing N filtered the query instead of firing the New Note accelerator');
  await page.type(`${palette} input`, 'ew Note');
  await page.waitForFunction(sel => document.querySelector(sel)?.textContent.toLowerCase().includes('new note'), {}, `${palette} .keyboard-shortcuts-list .is-active`);
  await page.keyboard.press('Enter');
  await page.waitForSelector('input[placeholder="e.g. Sprint Planning, Project Ideas..."]');
  await page.evaluate(() => [...document.querySelectorAll('button')].find(button => button.textContent.trim() === 'Cancel').click());
  await focusNav(); await openPalette(); await chooseCommand('Focus note search');
  await page.waitForFunction(() => document.querySelector('.header-search input') === document.activeElement);

  await openPalette(); await chooseCommand('Settings');
  await page.waitForFunction(() => location.pathname === '/settings');
  await focusNav('Notes'); await chord(primaryModifier, 'Slash'); await page.waitForSelector(help);
  assert(await page.$eval(help, panel => panel.getAttribute('data-mode')) === 'help', `${primaryModifier}+/ did not open keyboard help`);
  await new Promise(resolve => setTimeout(resolve, 2800));
  assert(await page.$(help), 'Keyboard help closed on a timer');
  await page.keyboard.press('Escape');

  await openPalette(); await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
  await page.waitForFunction(() => location.pathname === '/agent');

  await focusNav('Agent System'); await openPalette();
  assert(await page.$eval('[data-shortcut-key="/"]', item => item.getAttribute('aria-disabled')) === 'true', 'Search command is not disabled outside Notes');
  await page.type(`${palette} input`, 'Focus note search');
  await page.waitForFunction(sel => document.querySelectorAll(`${sel} .keyboard-shortcuts-list [role="option"]`).length === 1, {}, palette);
  assert(!(await page.$(`${palette} .is-active`)), 'A disabled command should not become the active selection');
  await page.keyboard.press('Enter');
  assert(await page.$(palette) && new URL(page.url()).pathname === '/agent', 'Disabled command executed or dismissed the palette');
  await page.click(`${palette} input`, { clickCount: 3 });
  await page.keyboard.type('no-such-command');
  assert(await page.$(`${palette} [role="status"]`), 'No-results state is missing');
  await page.keyboard.press('Escape');
  await openPalette(); await page.mouse.click(20, 300); await page.waitForFunction(selector => !document.querySelector(selector), {}, palette);
  await page.goto(`${base}/notebooks/example/notes/example.md`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('[aria-label="Note editor"]');
  assert(await page.$$eval('.header-nav button', buttons => buttons.every(button => button.disabled)), 'Home navigation remains active while note editor is open');
  assert(!await page.$(palette), 'Command palette opened while note editor is open');
  await page.click('button[aria-label="Document tools"]'); await page.click('.note-panel-tabs [role="tab"][aria-label="Find in note"]'); await page.waitForSelector('[role="search"][aria-label="Find in note"] input');
  await page.type('[role="search"][aria-label="Find in note"] input', 'needle');
  assert((await page.$eval('.note-find-count', node => node.textContent)) === '1 of 2', 'Find did not report the first of two full-note matches');
  await page.keyboard.press('Enter');
  assert((await page.$eval('.note-find-count', node => node.textContent)) === '2 of 2', 'Enter did not advance note search');
  await page.keyboard.press('Escape');
  // Document tools reopens the last panel (Find here), so Outline is chosen by its tab.
  await page.click('button[aria-label="Document tools"]'); await page.click('.note-panel-tabs [role="tab"][aria-label="Outline"]'); await page.waitForSelector('.note-outline');
  fs.mkdirSync(`${product}/artifacts/qa`, { recursive: true });
  await page.screenshot({ path: `${product}/artifacts/qa/note-document-panel-desktop.png` });
  assert(await page.$$eval('.note-outline nav button', buttons => buttons.map(button => button.querySelector('span').textContent).join('|')) === 'Example|Section Two|Final Section', 'Markdown outline is incomplete');
  await page.click('.note-panel-tabs [role="tab"][aria-label="File Git status"]');
  assert(await page.$eval('.note-git-panel', panel => panel.textContent.includes('notes/example/example.md') && panel.textContent.includes('main')), 'File Git panel omitted the note path or branch');
  assert(await page.$eval('button[aria-label="Restore note"]', button => button.disabled), 'Clean file restore should be disabled');
  await page.screenshot({ path: `${product}/artifacts/qa/note-git-panel-desktop.png` });
  await page.click('.note-panel-tabs [role="tab"][aria-label="Outline"]');
  // Focused panel tabs keep their own keys, so J/K run from the outline itself.
  await page.waitForSelector('.note-outline nav button[aria-current="true"]'); await page.focus('.note-outline nav button[aria-current="true"]');
  await page.keyboard.press('j');
  assert((await page.$eval('.note-outline nav button[aria-current="true"] span', node => node.textContent)) === 'Section Two', 'J did not move outline focus');
  await page.keyboard.press('k');
  assert((await page.$eval('.note-outline nav button[aria-current="true"] span', node => node.textContent)) === 'Example', 'K did not move outline focus');
  // Choosing a heading keeps the outline open (dc3ba56).
  await page.keyboard.press('Enter');
  assert(await page.$('.note-outline'), 'Choosing an outline heading closed the panel');
  await page.$$eval('button', buttons => buttons.find(button => button.textContent.trim() === 'Source').click());
  await page.waitForSelector('textarea[aria-label="Note content"]');
  // A tab click keeps focus on the tab list, so the search field is focused directly.
  await page.click('.note-panel-tabs [role="tab"][aria-label="Find in note"]'); await page.click('[role="search"][aria-label="Find in note"] input'); await page.waitForFunction(() => document.activeElement?.matches('[role="search"][aria-label="Find in note"] input')); await new Promise(resolve => setTimeout(resolve, 30)); await page.keyboard.press('KeyA', { commands: ['SelectAll'] }); await page.keyboard.type('Second');
  await page.waitForFunction(() => document.querySelector('.note-find-count')?.textContent === '1 of 1');
  await page.waitForFunction(() => { const input = document.querySelector('textarea[aria-label="Note content"]'); return input.selectionStart === input.value.indexOf('Second'); });
  // Document tools reopens the last panel, so Outline becomes the last one before the panel closes.
  await page.click('.note-panel-tabs [role="tab"][aria-label="Outline"]'); await page.waitForSelector('.note-outline');
  await page.keyboard.press('Escape'); await page.waitForFunction(() => !document.querySelector('.note-outline'));
  await page.$eval('textarea[aria-label="Note content"]', input => { input.scrollTop = input.scrollHeight; input.dispatchEvent(new Event('scroll')); });
  const scrollBeforeOutline = await page.$eval('textarea[aria-label="Note content"]', input => input.scrollTop);
  await page.click('button[aria-label="Document tools"]');
  await page.waitForSelector('.note-outline');
  await new Promise(resolve => setTimeout(resolve, 100));
  assert(await page.$eval('textarea[aria-label="Note content"]', (input, before) => Math.abs(input.scrollTop - before) < 1, scrollBeforeOutline), 'Opening outline changed the current document viewport');
  assert(await page.$eval('.note-outline nav button[aria-current="true"] span', node => node.textContent) === 'Final Section', 'Outline did not focus the heading for the current viewport');
  await page.$$eval('.note-outline nav button', buttons => buttons.find(button => button.textContent.includes('Section Two')).click());
  assert(await page.$eval('textarea[aria-label="Note content"]', input => input.selectionStart === input.value.indexOf('## Section Two')), 'Source outline did not jump to its heading');
  console.log('PASS Alt+/ searchable command palette, visible launcher, persistent lifetime, focus restoration, typed selection, arrow navigation, help, outside dismissal, contextual disablement, editor navigation suspension, leader find, J/K outline and Live/Source navigation');
} finally {
  await browser.close(); await new Promise(resolve => server.close(resolve)); fs.rmSync(root, { recursive: true, force: true });
}
