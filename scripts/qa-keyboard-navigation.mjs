import fs from 'node:fs';
import { createQaWorkspace, launchQaBrowser, product, qaRequire, startQaServer } from './lib/qa-harness.mjs';

// Phase 1 of the keyboard and navigation redesign: the registry-driven quick open and help, the fixed note list search,
// Go to Graph, Mod+/ inside the Markdown editor, the header button's chord, and the note leader, find and outline keys.
// Keys are synthesized through CDP, so this proves page behaviour only; browser accelerators need real OS keys.
const require = qaRequire();
const { root, write, commitFixture } = createQaWorkspace('github-notes-keyboard-');
write('.github-notes.yaml', 'schema_version: 1\nworkspace:\n  title: Keyboard QA\n  default_notebook: example\nnotebooks:\n  - id: example\n    title: Example\n    root: notes/example\n');
write('notes/example/example.md', ['# Example', '', 'Alpha needle.', '', '## Section Two', '', 'Second needle.', ...Array.from({ length: 50 }, (_, index) => `Filler line ${index + 1}`), '', '## Final Section', '', 'Last line.'].join('\n'));
commitFixture('QA');
const { server, base } = await startQaServer(root);
const browser = await launchQaBrowser(require);
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 1000 });
const mac = await page.evaluate(() => /Mac|iPhone|iPad/.test(navigator.platform));
const mod = mac ? 'Meta' : 'Control';
const chord = async (...keys) => {
  for (const key of keys.slice(0, -1)) await page.keyboard.down(key);
  await page.keyboard.press(keys.at(-1));
  for (const key of keys.slice(0, -1).reverse()) await page.keyboard.up(key);
};
const panel = '.keyboard-shortcuts-panel';
const palette = `${panel}[data-mode="palette"]`;
const help = `${panel}[data-mode="help"]`;
const assert = (value, message) => {
  if (!value) throw new Error(message);
};
const closed = () => page.waitForFunction(selector => !document.querySelector(selector), {}, panel);
const runCommand = async (text, id) => {
  await chord(mod, 'Shift', 'KeyP');
  await page.waitForSelector(palette);
  assert(await page.$eval(`${palette} input`, input => input.value) === '>', `${mod}+Shift+P did not open quick open on commands`);
  await page.type(`${palette} input`, text);
  await page.waitForFunction((sel, id) => document.querySelector(`${sel} .is-active`)?.getAttribute('data-command-id') === id, {}, palette, id);
  await page.keyboard.press('Enter');
  await closed();
};
const shots = `${product}/artifacts/qa`;
fs.mkdirSync(shots, { recursive: true });

try {
  await page.goto(`${base}/notes`, { waitUntil: 'networkidle2' });
  const button = await page.$eval('[data-header-command]', node => ({ title: node.getAttribute('title'), keys: node.getAttribute('aria-keyshortcuts') }));
  assert(button.keys === (mac ? 'Meta+Shift+F' : 'Control+Shift+F'), `Header quick open button names ${button.keys}`);
  assert(button.title === `Quick open (${mac ? '⌘⇧F' : 'Ctrl+Shift+F'})`, `Header quick open tooltip is "${button.title}"`);

  // Mod+Shift+F opens note search from the page; Escape restores focus.
  await page.focus('.header-nav button[aria-label="Notes"]');
  await chord(mod, 'Shift', 'KeyF');
  await page.waitForSelector(palette);
  await page.waitForFunction(sel => document.activeElement === document.querySelector(`${sel} input`), {}, palette);
  assert(await page.$eval(`${palette} input`, input => input.value === ''), 'Quick open did not start on an empty note search');
  await page.keyboard.press('Escape');
  await closed();
  assert(await page.$eval('.header-nav button[aria-label="Notes"]', node => node === document.activeElement), 'Escape did not restore focus');

  // The command list comes from the registry: pages including Graph, new note, note list search, help.
  await chord(mod, 'Shift', 'KeyP');
  await page.waitForSelector(palette);
  const ids = await page.$$eval(`${palette} [data-command-id]`, rows => rows.map(row => row.getAttribute('data-command-id')));
  for (const id of ['nav.notes', 'nav.graph', 'nav.assets', 'nav.agent', 'nav.settings', 'note.new', 'note.searchList', 'help.open']) assert(ids.includes(id), `Quick open lacks ${id}: ${ids.join(',')}`);
  assert(!ids.includes('palette.notes') && !ids.includes('palette.commands'), 'Quick open lists its own opening chords');
  await page.keyboard.press('Escape');
  await closed();

  await runCommand('graph', 'nav.graph');
  await page.waitForFunction(() => location.pathname === '/graph');
  await page.click('.header-nav button[aria-label="Notes"]');
  await page.waitForFunction(() => location.pathname.startsWith('/notebooks/') || location.pathname === '/notes');
  await page.waitForSelector('.note-toolbar-search input');

  // "Search the note list" lands in the toolbar search field (the old command focused a selector that no longer exists).
  await runCommand('search the note list', 'note.searchList');
  await page.waitForFunction(() => document.activeElement === document.querySelector('.note-toolbar-search input'));

  // Help: generated from the registry, every entry once, grouped, and filtered by name or key.
  await page.focus('.header-nav button[aria-label="Notes"]');
  await chord(mod, 'Slash');
  await page.waitForSelector(help);
  const counts = await page.$eval(help, node => ({ rows: node.querySelectorAll('[data-shortcut-id]').length, unique: new Set([...node.querySelectorAll('[data-shortcut-id]')].map(row => row.getAttribute('data-shortcut-id'))).size, registry: Number(node.querySelector('[data-registry-count]').getAttribute('data-registry-count')), groups: node.querySelectorAll('section h3').length }));
  assert(counts.rows === counts.registry && counts.unique === counts.rows && counts.rows > 80, `Help lists ${counts.rows} rows (${counts.unique} unique) for ${counts.registry} registry commands`);
  assert(counts.groups >= 10, `Help shows only ${counts.groups} groups`);
  await page.waitForFunction(sel => document.activeElement === document.querySelector(`${sel} input[type="search"]`), {}, help);
  await page.screenshot({ path: `${shots}/keyboard-help-desktop.png` });
  await page.type(`${help} input[type="search"]`, mac ? '⌘⇧P' : 'ctrl+shift+p');
  assert((await page.$$eval(`${help} [data-shortcut-id]`, rows => rows.map(row => row.getAttribute('data-shortcut-id')))).join(',') === 'palette.commands', 'Help filter by key text did not find only the command chord');
  await page.$eval(`${help} input[type="search"]`, input => input.select());
  await page.keyboard.type('graph');
  assert((await page.$$eval(`${help} [data-shortcut-id]`, rows => rows.map(row => row.getAttribute('data-shortcut-id')))).includes('nav.graph'), 'Help filter by name did not find Go to Graph');
  await chord(mod, 'Slash');
  await closed();

  // In a zoomed note, Mod+/ inside the Markdown editor opens help and no longer inserts an HTML comment.
  await page.goto(`${base}/notebooks/example/notes/example.md`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('[aria-label="Note editor"]');
  assert(await page.$$eval('.header-nav button', buttons => buttons.every(button => button.disabled)), 'Home navigation remains active while note editor is open');
  await page.waitForSelector('[data-live-markdown] .cm-content');
  await page.click('[data-live-markdown] .cm-content');
  const before = await page.$eval('[data-live-markdown] .cm-content', node => node.textContent);
  await chord(mod, 'Slash');
  await page.waitForSelector(help);
  assert(await page.$eval('[data-live-markdown] .cm-content', node => node.textContent) === before && !before.includes('<!--'), 'Mod+/ in the Markdown editor changed the note');
  await page.screenshot({ path: `${shots}/keyboard-help-editor.png` });
  await page.keyboard.press('Escape');
  await closed();
  assert(await page.evaluate(() => Boolean(document.activeElement?.closest('[data-live-markdown]'))), 'Closing help did not return to the editor');

  // The note leader, find and outline keys, unchanged.
  await chord(mod, 'Shift', 'KeyE');
  await page.waitForSelector('.note-editor-leader');
  assert((await page.$eval('.note-editor-leader small', node => node.textContent)).includes(mac ? '⌘⇧E' : 'Ctrl+Shift+E'), 'Leader hint does not use the registry notation');
  await page.keyboard.press('f');
  // The find field takes focus and selects its text on the next frame; type only after that.
  await page.waitForFunction(() => document.activeElement?.matches('[role="search"][aria-label="Find in note"] input'));
  await page.keyboard.type('needle');
  await page.waitForFunction(() => document.querySelector('.note-find-count')?.textContent === '1 of 2');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelector('.note-find-count')?.textContent === '2 of 2');
  await page.keyboard.press('Escape');
  await page.click('button[aria-label="Document tools"]');
  await page.click('.note-panel-tabs [role="tab"][aria-label="Outline"]');
  await page.waitForSelector('.note-outline nav button[aria-current="true"]');
  assert(await page.$$eval('.note-outline nav button', buttons => buttons.map(button => button.querySelector('span').textContent).join('|')) === 'Example|Section Two|Final Section', 'Markdown outline is incomplete');
  await page.focus('.note-outline nav button[aria-current="true"]');
  await page.keyboard.press('j');
  assert((await page.$eval('.note-outline nav button[aria-current="true"] span', node => node.textContent)) === 'Section Two', 'J did not move outline focus');
  await page.keyboard.press('k');
  assert((await page.$eval('.note-outline nav button[aria-current="true"] span', node => node.textContent)) === 'Example', 'K did not move outline focus');

  // At phone width the note list search sits behind a toggle; the command opens it.
  await page.goto(`${base}/notes`, { waitUntil: 'networkidle2' });
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await page.waitForSelector('.note-search-toggle');
  assert(await page.$eval('.note-toolbar-search', node => !node.hasAttribute('data-open') && getComputedStyle(node).display === 'none'), 'The phone search field is not behind its toggle');
  await page.$eval('[data-header-command]', node => node.click());
  await page.waitForSelector(palette);
  await page.type(`${palette} input`, '>search the note list');
  await page.waitForFunction(sel => document.querySelector(`${sel} .is-active`)?.getAttribute('data-command-id') === 'note.searchList', {}, palette);
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.activeElement === document.querySelector('.note-toolbar-search input') && document.querySelector('.note-toolbar-search').hasAttribute('data-open'));
  await page.screenshot({ path: `${shots}/keyboard-search-list-phone.png` });
  console.log('PASS registry quick open and help (count equals the registry, grouped, filtered by name and key), header chord tooltip and aria-keyshortcuts, Go to Graph, note list search at 1440 and 390 px, Mod+/ help inside the Markdown editor, leader find and J/K outline');
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
  fs.rmSync(root, { recursive: true, force: true });
}
