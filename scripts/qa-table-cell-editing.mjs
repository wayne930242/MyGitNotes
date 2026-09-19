import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { resolveQaChromePath } from './qa-chrome.mjs';
const product = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(`${product}/apps/web/package.json`);
const puppeteer = require('puppeteer-core');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'github-notes-browser-'));
const write = (p, s) => {
  fs.mkdirSync(path.dirname(path.join(root, p)), { recursive: true });
  fs.writeFileSync(path.join(root, p), s);
};
const git = (...args) => execFileSync('git', args, { cwd: root, stdio: 'pipe' });
write('notes/.github-notes.yaml', 'schema_version: 1\nworkspace:\n  title: Folder QA\n  default_notebook: example\nnotebooks:\n  - id: example\n    title: Example\n    root: notes/example\n');
write('notes/example/root.md', '# Table editing\n\n| Name | Details |\n| --- | --- |\n| Alpha | A long first line with enough text to occupy the available cell width and demonstrate wrapping.<br>Second line of the investigation notes. |\n| Beta | Short note |\n');
write('notes/example/projects/_dir.yml', 'title: Projects\norder: -1\n');
write('notes/example/projects/deep/_dir.yml', 'title: Deep work\n');
write('notes/example/projects/deep/nested.md', '# Nested Note\n');
write('notes/example/assets/pixel.png', Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64'));
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
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await puppeteer.launch({ executablePath: resolveQaChromePath(), headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 1000 });
const errors = [];
page.on('pageerror', e => {
  errors.push(e.message);
  console.error('PAGE ERROR', e.message);
});
page.setDefaultTimeout(8000);
const click = async text => {
  const ok = await page.evaluate(text => {
    const b = Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === text);
    b?.click();
    return !!b;
  }, text);
  if (!ok) throw Error(`Missing button: ${text}`);
};
// Editing commands are explicit because macOS binds no Control+End or Control+A shortcut in textareas.
const textEnd = () => page.keyboard.press('End', { commands: ['MoveToEndOfDocument'] });
const selectAll = () => page.keyboard.press('KeyA', { commands: ['SelectAll'] });
const tableRoot = '.live-md-table';
const cell = '.live-md-table tbody tr:first-child td:nth-child(2)';
const editor = '.live-table-cell-editor';
const contrast = async () =>
  page.$eval('.live-table-toolbar select', select => {
    const luminance = color => {
      const parts = color.match(/[\d.]+/g).slice(0, 3).map(Number).map(n => {
        const value = n / 255;
        return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
      });
      return parts[0] * 0.2126 + parts[1] * 0.7152 + parts[2] * 0.0722;
    };
    return {
      scheme: getComputedStyle(select).colorScheme,
      ratios: [...select.options].map(option => {
        const style = getComputedStyle(option), a = luminance(style.color), b = luminance(style.backgroundColor);
        return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      }),
    };
  });
const rect = selector =>
  page.$eval(selector, e => {
    const r = e.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  });
const checkGeometry = async before => {
  const after = await rect(cell), area = await rect(editor);
  for (const axis of ['x', 'y', 'width', 'height']) if (Math.abs(before[axis] - after[axis]) > 1) throw Error('Cell geometry changed while editing: ' + JSON.stringify({ before, after }));
  for (const axis of ['x', 'y', 'width', 'height']) if (Math.abs(after[axis] - area[axis]) > 2) throw Error('Textarea does not cover its cell: ' + JSON.stringify({ after, area }));
  if (!await page.$eval(editor, e => e.scrollHeight <= e.clientHeight + 1)) throw Error('Textarea clips its content');
};
const checkAutoHeight = async () => {
  const before = await rect(cell);
  const lineHeight = await page.$eval(editor, e => parseFloat(getComputedStyle(e).lineHeight));
  await textEnd();
  for (let line = 1; line <= 3; line++) {
    await page.keyboard.press('Enter');
    const grown = await rect(cell);
    if (Math.abs(grown.height - before.height - line * lineHeight) > 2) throw Error('Enter did not grow the row by one line: ' + JSON.stringify({ before, grown, line, lineHeight }));
    await checkGeometry(grown);
    const adjacent = await rect('.live-md-table tbody tr:first-child td:first-child');
    if (Math.abs(adjacent.height - grown.height) > 1) throw Error('Adjacent cell did not grow with the row');
  }
  for (let line = 2; line >= 0; line--) {
    await page.keyboard.press('Backspace');
    const shrunk = await rect(cell);
    if (Math.abs(shrunk.height - before.height - line * lineHeight) > 2) throw Error('Backspace did not shrink the row by one line');
    await checkGeometry(shrunk);
  }
  // Replacing existing multiline content must shrink below the opening height.
  await selectAll();
  await page.keyboard.type('Short');
  if ((await rect(cell)).height >= before.height - 2) throw Error('Replacing multiline text did not shrink the row');
  const short = await rect(cell);
  await page.keyboard.sendCharacter('\nPasted second line\nPasted third line');
  if ((await rect(cell)).height <= short.height + lineHeight) throw Error('Pasting multiline text did not grow the row');
  await checkGeometry(await rect(cell));
  await page.keyboard.press('Escape');
  if (Math.abs((await rect(cell)).height - before.height) > 1) throw Error('Cancel did not restore the original row height');
};
try {
  fs.mkdirSync(path.join(product, 'artifacts/qa'), { recursive: true });
  await page.goto(base + '/notebooks/example/notes/root.md', { waitUntil: 'networkidle0' });
  for (const theme of ['flexoki:light', 'flexoki:dark', 'catppuccin:dark']) {
    await page.evaluate(theme => {
      localStorage.setItem('github_notes_theme', theme.split(':')[0]);
      localStorage.setItem('github_notes_theme_mode', theme.split(':')[1]);
    }, theme);
    await page.reload({ waitUntil: 'networkidle0' });
    await page.waitForSelector(tableRoot);
    await page.hover('.live-table-toolbar select');
    const result = await contrast();
    if (result.ratios.some(ratio => ratio < 4.5)) throw Error('Dropdown contrast failed: ' + JSON.stringify({ theme, ...result }));
    if (result.scheme !== theme.split(':')[1]) throw Error('Native select uses the wrong color scheme');
    await page.click('.live-table-toolbar select');
    if (theme === 'catppuccin:dark') await page.screenshot({ path: product + '/artifacts/qa/table-dark-options.png', fullPage: true });
    await page.keyboard.press('Escape');
  }
  for (const mode of ['expanded', 'fit']) {
    const current = await page.$eval(tableRoot, e => e.dataset.tableWidth);
    if (current !== mode) {
      await page.hover(tableRoot);
      await page.click('[data-table-width-toggle]');
    }
    const before = await rect(cell);
    await page.click(cell, { count: 2 });
    await page.waitForSelector('textarea' + editor);
    await checkGeometry(before);
    const value = await page.$eval(editor, e => e.value);
    if (!value.includes('\nSecond line')) throw Error('Existing Markdown breaks are not editable newlines');
    await checkAutoHeight();
  }
  const before = await rect(cell);
  await page.click(cell, { count: 2 });
  await page.waitForSelector(editor);
  await checkGeometry(before);
  await textEnd();
  await page.keyboard.press('Enter');
  await page.keyboard.type('Third line with additional details.');
  if (!await page.$eval(editor, e => e.value.endsWith('\nThird line with additional details.'))) throw Error('Enter failed to insert a newline');
  await page.$eval(editor, e => e.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, isComposing: true, bubbles: true })));
  if (!await page.$(editor)) throw Error('IME composition committed the cell');
  await checkGeometry(await rect(cell));
  await page.screenshot({ path: product + '/artifacts/qa/table-dark-textarea.png', fullPage: true });
  await page.keyboard.down('Control');
  await page.keyboard.press('Enter');
  await page.keyboard.up('Control');
  await page.waitForFunction(() => document.querySelector('.live-md-table tbody tr:first-child td:nth-child(2)').querySelectorAll('br').length === 2);
  await page.click(cell, { count: 2 });
  await page.waitForSelector(editor);
  if (!await page.$eval(editor, e => e.value.endsWith('\nThird line with additional details.'))) throw Error('Multiline text failed to round trip');
  await page.keyboard.type('cancel this change');
  await page.keyboard.press('Escape');
  if (!await page.$eval(cell, e => e.textContent.includes('Third line'))) throw Error('Escape changed saved multiline text');
  await page.click('.live-md-table tbody tr:nth-child(2) td:nth-child(2)', { count: 2 });
  await page.waitForSelector(editor);
  await page.keyboard.type('Meta line one');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Meta line two');
  await page.keyboard.down('Meta');
  await page.keyboard.press('Enter');
  await page.keyboard.up('Meta');
  await page.waitForFunction(() => document.querySelector('.live-md-table tbody tr:nth-child(2) td:nth-child(2)').querySelector('br'));
  await page.waitForFunction(() => document.activeElement?.matches('.live-md-table td'));
  await page.keyboard.down('Control');
  await page.keyboard.press('KeyZ');
  await page.keyboard.up('Control');
  await page.waitForFunction(() => document.querySelector('.live-md-table tbody tr:nth-child(2) td:nth-child(2)').textContent === 'Short note');
  for (let attempt = 0; attempt < 50; attempt++) {
    const text = fs.readFileSync(path.join(root, 'notes/example/root.md'), 'utf8');
    if (text.includes('<br>Third line') && text.includes('Short note')) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  const saved = fs.readFileSync(path.join(root, 'notes/example/root.md'), 'utf8');
  if (!saved.includes('<br>Third line') || !saved.includes('Short note')) throw Error('Multiline edits were not saved');
  const neighborHeight = (await rect(cell)).height;
  await page.click('.live-md-table tbody tr:first-child td:first-child', { count: 2 });
  await page.waitForSelector(editor);
  await page.keyboard.type('A');
  if (Math.abs((await rect(cell)).height - neighborHeight) > 1) throw Error('Editing a short cell reduced the height needed by its neighbor');
  await page.keyboard.press('Escape');
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await page.waitForSelector(tableRoot);
  // Selecting the cell may scroll the editor; the geometry contract starts once the cell is selected.
  await page.tap(cell);
  const mobileBefore = await rect(cell);
  await page.tap('button[aria-label="Edit cell"]');
  await page.waitForSelector(editor);
  await checkGeometry(mobileBefore);
  await page.screenshot({ path: product + '/artifacts/qa/table-mobile-textarea.png', fullPage: true });
  await checkAutoHeight();
  if (errors.length) throw Error(errors.join('; '));
  console.log('PASS native select contrast; cell-aligned textarea; automatic row growth and shrinkage in both width modes and on mobile; cancel restores height; Ctrl/Meta+Enter apply; IME protection; undo; multiline disk round trip');
} catch (error) {
  console.error(error);
  await page.screenshot({ path: product + '/artifacts/qa/table-cell-editing-failure.png', fullPage: true });
  throw error;
} finally {
  await browser.close();
  await new Promise(r => server.close(r));
  fs.rmSync(root, { recursive: true, force: true });
}
