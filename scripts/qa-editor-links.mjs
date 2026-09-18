import assert from 'node:assert/strict';
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
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'github-notes-links-'));
const content = '# Link QA\n\n[Named link](https://example.com/named)\n\n(https://example.com/bare?x=1&y=2).\n\n<https://example.com/angle>\n\n[**Bold link**](https://example.com/bold)\n\n[Unsafe](javascript:alert%281%29)\n\n`https://example.com/code`\n\n| Link |\n| --- |\n| [Table link](https://example.com/table) |\n';
fs.mkdirSync(path.join(root, 'notes/example'), { recursive: true });
fs.writeFileSync(path.join(root, '.github-notes.yaml'), 'schema_version: 1\nworkspace:\n  title: Link QA\n  default_notebook: example\nnotebooks:\n  - id: example\n    title: Example\n    root: notes/example\n');
fs.writeFileSync(path.join(root, 'notes/example/links.md'), content);
const git = (...args) => execFileSync('git', args, { cwd: root, stdio: 'pipe' });
git('init', '-b', 'main'); git('config', 'user.name', 'Browser QA'); git('config', 'user.email', 'qa@example.com'); git('add', '.'); git('commit', '-m', 'fixture');
process.env.MYGITNOTES_SOURCE = 'local';
process.env.MYGITNOTES_LOCAL_PATH = root;
delete process.env.VERCEL; delete process.env.APP_URL;
const { createApp } = await import(`${product}/apps/local-server/dist/app.js`);
const server = createServer(createApp(process.env.LINK_QA_PRODUCT || product));
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await puppeteer.launch({
  executablePath: resolveQaChromePath(),
  headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 1100 });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const open = async theme => {
  await page.evaluateOnNewDocument(theme => localStorage.setItem('github_notes_theme', theme), theme);
  await page.goto(`${base}/notebooks/example/notes/links.md`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.live-md-rendered table a');
};
const clickText = async (text, modifier) => {
  const point = await page.evaluate(text => {
    const walker = document.createTreeWalker(document.querySelector('.cm-content'), NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode; const start = node.textContent.indexOf(text);
      if (start < 0) continue;
      const range = document.createRange(); range.setStart(node, start); range.setEnd(node, start + text.length);
      const box = range.getBoundingClientRect(); return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    }
    throw Error(`Missing visible text: ${text}`);
  }, text);
  if (modifier) await page.keyboard.down(modifier);
  try { await page.mouse.click(point.x, point.y); }
  finally { if (modifier) await page.keyboard.up(modifier); }
};
// macOS turns Control+click into a context-menu click, so new-tab clicks use Command there.
const newTabKey = process.platform === 'darwin' ? 'Meta' : 'Control';
const contrast = (a, b) => {
  const luminance = rgb => rgb.match(/[\d.]+/g).slice(0, 3).map(Number).map(v => v / 255).map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4).reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
  const values = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (values[0] + 0.05) / (values[1] + 0.05);
};
try {
  if (!process.env.LINK_QA_CASE || process.env.LINK_QA_CASE === 'color') {
    for (const theme of ['github-dark', 'nord-arctic', 'midnight-violet', 'clean-indigo']) {
      await open(theme);
      const colors = await page.evaluate(() => {
        const walker = document.createTreeWalker(document.querySelector('.cm-content'), NodeFilter.SHOW_TEXT);
        const result = [];
        while (walker.nextNode()) {
          const node = walker.currentNode;
          if (!/Named link|https:\/\/example.com\/(bare|angle)|Bold link|Table link/.test(node.textContent)) continue;
          let ancestor = node.parentElement; let background;
          while (ancestor) {
            background = getComputedStyle(ancestor).backgroundColor;
            if (background !== 'rgba(0, 0, 0, 0)' && background !== 'transparent') break;
            ancestor = ancestor.parentElement;
          }
          result.push({ text: node.textContent, color: getComputedStyle(node.parentElement).color, background });
        }
        return result;
      });
      console.log(`${theme}: minimum link contrast ${Math.min(...colors.map(c => contrast(c.color, c.background))).toFixed(2)}:1`);
      assert.ok(colors.length >= 5);
      for (const sample of colors) assert.ok(contrast(sample.color, sample.background) >= 4.5, `${theme}: insufficient contrast for ${sample.text}`);
      fs.mkdirSync(path.join(product, 'artifacts/qa'), { recursive: true });
      await page.screenshot({ path: path.join(product, `artifacts/qa/editor-links-${theme}.png`) });
    }
  }
  if (!process.env.LINK_QA_CASE || process.env.LINK_QA_CASE === 'click') {
    await open('midnight-violet');
    const expectPopup = async (text, modifier, destination) => {
      const popupPromise = browser.waitForTarget(target => target.url() === destination, { timeout: 3000 });
      await clickText(text, modifier);
      const target = await popupPromise;
      const popup = await target.page();
      assert.equal(target.url(), destination);
      assert.equal(await popup.evaluate(() => window.opener === null), true);
      await popup.close(); await page.bringToFront();
      assert.equal(page.url(), `${base}/notebooks/example/notes/links.md`);
    };
    await expectPopup('Named link', newTabKey, 'https://example.com/named');
    // A plain link click navigates, so the caret reaches the link line from the heading instead.
    await clickText('Link QA');
    await page.waitForFunction(() => document.querySelector('.cm-content').textContent.startsWith('# Link QA'));
    const namedLinkRevealed = () => page.evaluate(() => document.querySelector('.cm-content').textContent.includes('[Named link]'));
    for (let step = 0; step < 4 && !await namedLinkRevealed(); step++) {
      await page.keyboard.press('ArrowDown');
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    }
    assert.ok(await namedLinkRevealed(), 'The active link line must show its Markdown source');
    await expectPopup('Named link', newTabKey, 'https://example.com/named');
    await expectPopup('Named link', 'Meta', 'https://example.com/named');
    await expectPopup('https://example.com/bare?x=1&y=2', newTabKey, 'https://example.com/bare?x=1&y=2');
    await expectPopup('https://example.com/angle', newTabKey, 'https://example.com/angle');
    await expectPopup('Bold link', newTabKey, 'https://example.com/bold');
    await expectPopup('Table link', newTabKey, 'https://example.com/table');
    const targetsBefore = browser.targets().length;
    await clickText('Unsafe', newTabKey);
    await clickText('https://example.com/code', newTabKey);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(browser.targets().length, targetsBefore, 'Unsafe links and code must not open tabs');
    assert.equal(fs.readFileSync(path.join(root, 'notes/example/links.md'), 'utf8'), content, 'Link clicks must not change the note');
    console.log('PASS link clicks: Ctrl/Cmd, active line, bare URL, angle URL, nested formatting, table, unsafe protocol and code');
  }
  if (!process.env.LINK_QA_CASE || process.env.LINK_QA_CASE === 'mobile') {
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
    await open('midnight-violet');
    const icons = await page.$$('.live-md-external-link');
    assert.equal(icons.length, 4, 'Every safe inline link needs its own external-link button');
    // Rendered table links open on a plain tap, so they carry no separate button.
    const targets = [...['named', 'bare?x=1&y=2', 'angle', 'bold'].map(suffix => [suffix, true]), ['table', false]];
    for (const [suffix, icon] of targets) {
      const destination = `https://example.com/${suffix}`;
      const selector = icon ? `.live-md-external-link[href="${destination}"]` : `.live-md-rendered a[href="${destination}"]`;
      const size = await page.$eval(selector, element => {
        const rect = element.getBoundingClientRect();
        return { width: rect.width, height: rect.height, label: element.getAttribute('aria-label'), target: element.target, rel: element.rel };
      });
      if (icon) {
        assert.ok(size.width >= 28 && size.height >= 28, 'Mobile link icon needs a usable tap target');
        assert.ok(size.label); assert.equal(size.target, '_blank'); assert.match(size.rel, /noopener/);
      }
      const popupPromise = browser.waitForTarget(target => target.url() === destination, { timeout: 3000 });
      await page.tap(selector);
      const popup = await (await popupPromise).page();
      assert.equal(await popup.evaluate(() => window.opener === null), true);
      await popup.close(); await page.bringToFront();
      assert.equal(page.url(), `${base}/notebooks/example/notes/links.md`);
    }
    assert.equal(fs.readFileSync(path.join(root, 'notes/example/links.md'), 'utf8'), content);
    fs.mkdirSync(path.join(product, 'artifacts/qa'), { recursive: true });
    await page.screenshot({ path: path.join(product, 'artifacts/qa/editor-links-mobile.png') });
    console.log('PASS mobile: external icons open a new tab without changing the note');
  }
  assert.deepEqual(errors, []);
} finally {
  await browser.close(); await new Promise(resolve => server.close(resolve));
  fs.rmSync(root, { recursive: true, force: true });
}
