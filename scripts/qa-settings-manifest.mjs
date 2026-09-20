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
const require = createRequire(`${product}/apps/web/package.json`);
const puppeteer = require('puppeteer-core');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'github-notes-manifest-'));
const write = (file, content) => {
  fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  fs.writeFileSync(path.join(root, file), content);
};
const git = (...args) => execFileSync('git', args, { cwd: root, stdio: 'pipe' });
write('notes/.github-notes.yaml', 'schema_version: 1\nworkspace:\n  title: Manifest QA\n  default_notebook: example\nfiles:\n  hide_dotfiles: true\npreferences:\n  defaultYoutubeDisplayMode: thumbnail\n  defaultShowLineNumbers: false\n  defaultFocusMode: false\nnotebooks:\n  - id: example\n    title: Example\n    root: notes/example\n    metadata:\n      - key: status\n        type: string\n        label: Status\n    pathAliases:\n      docs: notes/example\n');
write('notes/example/regular.md', '# Regular Note\n');
git('init', '-b', 'main');
git('config', 'user.name', 'Browser QA');
git('config', 'user.email', 'qa@example.com');
git('add', '.');
git('commit', '-m', 'fixture');
process.env.MYGITNOTES_SOURCE = 'local';
process.env.MYGITNOTES_LOCAL_PATH = root;
delete process.env.VERCEL;
delete process.env.APP_URL;
const { createApp } = await import(`${product}/apps/local-server/dist/app.js`);
const server = createServer(createApp(product));
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await puppeteer.launch({ executablePath: resolveQaChromePath(), headless: true, pipe: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const visit = route => page.goto(base + route, { waitUntil: 'networkidle0' });
try {
  await page.setViewport({ width: 1440, height: 1000 });
  await visit('/settings');
  for (const theme of ['flexoki', 'github', 'catppuccin', 'rose-pine', 'gruvbox', 'tokyo-night', 'carbon', 'solarized', 'everforest'].flatMap(family => [`${family}:light`, `${family}:dark`])) {
    await page.evaluate(theme => {
      localStorage.setItem('github_notes_theme', theme.split(':')[0]);
      localStorage.setItem('github_notes_theme_mode', theme.split(':')[1]);
    }, theme);
    await visit('/settings');
    await page.click('#settings-manifest [role="tab"]:first-child');
    await page.focus('#settings-manifest textarea');
    const colors = await page.$eval('#settings-manifest textarea', element => {
      const style = getComputedStyle(element);
      return { caret: style.caretColor, text: style.color, background: style.backgroundColor, readonly: element.readOnly, focused: element === document.activeElement };
    });
    assert(colors.focused && !colors.readonly);
    assert.equal(colors.caret, colors.text, `Manifest caret must match its text: ${theme}`);
    assert.notEqual(colors.caret, colors.background);
    const original = await page.$eval('#settings-manifest textarea', input => input.value);
    await page.keyboard.press('End');
    await page.keyboard.type(' # caret QA');
    assert(await page.$eval('#settings-manifest textarea', input => input.value.includes('# caret QA')), 'Focused textarea must accept keyboard input');
    await page.keyboard.down('Control');
    await page.keyboard.press('KeyA');
    await page.keyboard.up('Control');
    await page.keyboard.type(original);
  }
  await page.setViewport({ width: 390, height: 844 });
  await page.evaluate(() => {
    localStorage.setItem('github_notes_theme', 'github');
    localStorage.setItem('github_notes_theme_mode', 'dark');
    localStorage.setItem('github-notes:language', 'en');
  });
  await visit('/settings');
  assert.equal(await page.$eval('#settings-manifest [role="tab"][aria-selected="true"]', node => node.textContent), 'Form');
  const formControls = await page.$$('#settings-manifest input, #settings-manifest select');
  for (const control of formControls) {
    const tag = await control.evaluate(node => node.tagName);
    const type = await control.evaluate(node => node.type);
    if (tag === 'SELECT') {
      const values = await control.$$eval('option', options => options.map(option => option.value));
      await control.select(values.at(-1));
    } else if (type === 'checkbox') {
      await control.click();
    } else {
      await control.focus();
      await page.keyboard.press('End');
      await page.keyboard.type('-qa');
    }
  }
  await page.$$eval('#settings-manifest button', buttons => buttons.find(button => button.textContent.includes('Add field'))?.click());
  await page.$$eval('#settings-manifest button', buttons => buttons.find(button => button.textContent.includes('Add alias'))?.click());
  const geometry = await page.$eval('#settings-manifest', node => ({ scrollWidth: node.scrollWidth, clientWidth: node.clientWidth }));
  assert(geometry.scrollWidth <= geometry.clientWidth, 'Manifest form must not overflow at phone width');
  assert.equal(await page.$$eval('#settings-manifest button[aria-label="Remove"]', buttons => buttons.length), 4, 'Added rows expose accessible remove controls');
  const screenshot = path.join(os.tmpdir(), 'settings-manifest-390-dark.png');
  await page.$eval('#settings-manifest', node => node.scrollIntoView());
  await page.screenshot({ path: screenshot, fullPage: true });
  assert.deepEqual(errors, []);
  console.log(`PASS manifest modes, every field type, and phone geometry; screenshot: ${screenshot}`);
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
  fs.rmSync(root, { recursive: true, force: true });
}
