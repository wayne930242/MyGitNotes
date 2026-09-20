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
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'mygitnotes-core-qa-'));
const upstream = path.join(temp, 'upstream'), core = path.join(temp, 'core'), workspace = path.join(temp, 'workspace');
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const { buildInfo } = await import(`${product}/apps/local-server/dist/build-info.js`);
git(temp, 'clone', '--shared', product, upstream);
git(upstream, 'checkout', '-B', 'core', buildInfo.sha);
for (const repo of [upstream]) {
  git(repo, 'config', 'user.name', 'Core QA');
  git(repo, 'config', 'user.email', 'qa@example.com');
}
git(temp, 'clone', '--shared', upstream, core);
const before = git(core, 'rev-parse', 'HEAD');
fs.writeFileSync(path.join(upstream, 'core-qa-marker.txt'), 'next core');
git(upstream, 'add', 'core-qa-marker.txt');
git(upstream, 'commit', '-m', 'test: advance core fixture');
const after = git(upstream, 'rev-parse', 'HEAD');
fs.mkdirSync(path.join(workspace, 'notes/example'), { recursive: true });
fs.writeFileSync(path.join(workspace, 'notes/.github-notes.yaml'), 'schema_version: 1\nworkspace:\n  title: Core QA\n  default_notebook: example\nnotebooks:\n  - id: example\n    title: Example\n    root: notes/example\n');
fs.writeFileSync(path.join(workspace, 'notes/example/note.md'), '# Preserved workspace\n');
// A workspace branch does not determine product checkout update eligibility.
git(workspace, 'init', '-b', 'workspace-feature');
git(workspace, 'config', 'user.name', 'Core QA');
git(workspace, 'config', 'user.email', 'qa@example.com');
git(workspace, 'add', 'notes/.github-notes.yaml', 'notes/example/note.md');
git(workspace, 'commit', '-m', 'test: workspace fixture');
const workspaceHead = git(workspace, 'rev-parse', 'HEAD');
fs.symlinkSync(path.join(product, 'apps/web/dist'), path.join(core, 'apps/web/dist'), 'dir');
fs.appendFileSync(path.join(core, '.git/info/exclude'), '\n/apps/web/dist\n');
assert.equal(git(core, 'status', '--porcelain'), '');
process.env.MYGITNOTES_SOURCE = 'local';
process.env.MYGITNOTES_LOCAL_PATH = workspace;
delete process.env.VERCEL;
delete process.env.APP_URL;
const { createApp } = await import(`${product}/apps/local-server/dist/app.js`);
const server = createServer(createApp(core));
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await puppeteer.launch({ executablePath: resolveQaChromePath(), headless: true, pipe: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const evidence = [];
try {
  for (const [width, height, theme] of [[1440, 1000, 'light'], [390, 844, 'dark']]) {
    await page.setViewport({ width, height });
    await page.goto(base + '/settings', { waitUntil: 'networkidle0' });
    await page.evaluate(theme => {
      localStorage.setItem('github_notes_theme_mode', theme);
      localStorage.setItem('github-notes:language', 'en');
    }, theme);
    await page.reload({ waitUntil: 'networkidle0' });
    await page.waitForSelector('[data-core-state="update_available"]');
    assert.equal(await page.$eval('[data-core-running-behind]', node => node.getAttribute('data-core-running-behind')), '1');
    assert.equal(await page.$eval('[data-core-update]', button => button.disabled), false);
    assert.equal(git(core, 'rev-parse', 'HEAD'), before, 'Checking must not update core');
    const bounds = await page.$eval('#settings-updates', node => {
      const rect = node.getBoundingClientRect();
      return { left: rect.left, right: rect.right };
    });
    assert(bounds.left >= 0 && bounds.right <= width, 'Core panel fits the viewport');
    await page.$eval('#settings-updates', node => node.scrollIntoView());
    const screenshot = path.join(os.tmpdir(), `core-update-${width}-${theme}.png`);
    await page.screenshot({ path: screenshot });
    evidence.push({ width, theme, screenshot, preUpdate: await page.$eval('#settings-updates', node => node.innerText) });
  }
  await page.click('[data-core-update]');
  await page.waitForSelector('[data-core-state="up_to_date"]');
  assert.equal(git(core, 'rev-parse', 'HEAD'), after);
  assert.equal(await page.$eval('[data-core-running-behind]', node => node.getAttribute('data-core-running-behind')), '1');
  assert.equal(git(workspace, 'rev-parse', 'HEAD'), workspaceHead);
  assert.equal(git(workspace, 'status', '--porcelain'), '');
  assert.equal(fs.readFileSync(path.join(workspace, 'notes/example/note.md'), 'utf8'), '# Preserved workspace\n');
  const repeat = await fetch(base + '/api/core/update', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal((await repeat.json()).result.alreadyUpToDate, true);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ result: 'PASS', before, after, workspaceHead, evidence, postUpdate: await page.$eval('#settings-updates', node => node.innerText) }, null, 2));
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
  fs.rmSync(temp, { recursive: true, force: true });
}
