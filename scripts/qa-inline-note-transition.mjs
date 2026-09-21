import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { resolveQaChromePath } from './qa-chrome.mjs';
import { assertFreshBuild } from './lib/require-fresh-build.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
assertFreshBuild(root);
const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-inline-note-'));
fs.mkdirSync(path.join(workspace, 'notes'), { recursive: true });
fs.writeFileSync(path.join(workspace, '.github-notes.yaml'), 'schema_version: 1\nworkspace:\n  title: Navigation QA\n  default_notebook: qa\nnotebooks:\n  - id: qa\n    title: QA\n    root: notes\n');
const source = '# Source note\n\n[Target](target.md)\n\n[Route target](/notebooks/qa/notes/target.md)\n';
fs.writeFileSync(path.join(workspace, 'notes/source.md'), source);
fs.writeFileSync(path.join(workspace, 'notes/target.md'), '# Target note\n\nTarget body is ready.\n');
for (const args of [['init', '-b', 'main'], ['config', 'user.name', 'Browser QA'], ['config', 'user.email', 'qa@example.com'], ['add', '.'], ['commit', '-m', 'fixture']]) execFileSync('git', args, { cwd: workspace, stdio: 'pipe' });
process.env.MYGITNOTES_SOURCE = 'local';
process.env.MYGITNOTES_LOCAL_PATH = workspace;
delete process.env.VERCEL;
delete process.env.APP_URL;
const { createApp } = await import(`${root}/apps/local-server/dist/app.js`);
const server = createServer(createApp(root));
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const require = createRequire(`${root}/apps/web/package.json`);
const browser = await require('puppeteer-core').launch({ executablePath: resolveQaChromePath(), headless: true, args: ['--no-sandbox'] });
const results = [];
try {
  for (const mode of ['cold', 'warm', 'route-cold', 'mobile']) {
    const page = await browser.newPage();
    const requests = [], errors = [];
    await page.setViewport(mode === 'mobile' ? { width: 390, height: 844, isMobile: true, hasTouch: true } : { width: 1440, height: 1000 });
    await page.evaluateOnNewDocument(cold => {
      localStorage.setItem('github-notes:language', 'en');
      if (cold) {
        window.requestIdleCallback = () => 0;
        window.cancelIdleCallback = () => {};
      }
    }, mode.includes('cold'));
    page.on('pageerror', error => errors.push(error.message));
    await page.setRequestInterception(true);
    page.on('request', async request => {
      if (request.url().endsWith('/api/notes/lookup')) {
        const body = JSON.parse(request.postData());
        if (body.paths.includes('notes/target.md')) {
          requests.push({ at: Date.now(), ...body });
          await new Promise(resolve => setTimeout(resolve, 350));
        }
      }
      await request.continue();
    });
    await page.goto(`${base}/notebooks/qa/notes/source.md`, { waitUntil: 'networkidle0' });
    const selector = `[data-workspace-link="${mode === 'route-cold' ? '/notebooks/qa/notes/target.md' : 'target.md'}"]`;
    await page.waitForSelector(selector);
    if (!mode.includes('cold')) {
      await page.waitForNetworkIdle({ idleTime: 600 });
      assert.equal(requests.length, 1, 'Idle preloading reads the linked body before the click');
    } else assert.equal(requests.length, 0);
    await page.evaluate(() => {
      window.transitionProbe = { start: performance.now(), missing: 0, done: false, contentAt: null };
      const frame = () => {
        const probe = window.transitionProbe;
        if (!document.querySelector('.note-dialog')) probe.missing++;
        if (document.querySelector('.cm-content')?.textContent.includes('Target body is ready.')) probe.contentAt ??= performance.now() - probe.start;
        if (!probe.done) requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    });
    const clickedAt = Date.now();
    await page.click(selector);
    if (mode.includes('cold')) {
      await new Promise(resolve => setTimeout(resolve, 100));
      assert.ok(await page.$eval('.cm-content', element => element.textContent.includes('Source note')), 'The source remains readable during a cold body request');
    }
    await page.waitForFunction(() => document.querySelector('.cm-content')?.textContent.includes('Target body is ready.'));
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const probe = await page.evaluate(() => {
      window.transitionProbe.done = true;
      return window.transitionProbe;
    });
    assert.equal(probe.missing, 0, 'The note dialog stays present throughout navigation');
    assert.equal(requests.length, 1, 'Opening uses one shared body request');
    assert.equal(requests[0].content, true);
    if (!mode.includes('cold')) assert.ok(requests[0].at < clickedAt, 'The click reuses the idle fetch');
    if (mode !== 'route-cold') {
      await page.click('button.note-close');
      await page.waitForFunction(() => location.pathname.endsWith('/source.md'));
      await page.waitForFunction(() => document.querySelector('.cm-content')?.textContent.includes('Source note'));
    }
    assert.deepEqual(errors, []);
    results.push({ mode, missingDialogFrames: probe.missing, timeToContentMs: probe.contentAt, requests: requests.map(request => ({ ...request, relativeToClickMs: request.at - clickedAt })) });
    await page.close();
  }
  assert.equal(fs.readFileSync(path.join(workspace, 'notes/source.md'), 'utf8'), source);
  console.log(JSON.stringify({ result: 'passed', results }, null, 2));
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
  fs.rmSync(workspace, { recursive: true, force: true });
}
