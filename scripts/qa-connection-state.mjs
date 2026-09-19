import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolveQaChromePath } from './qa-chrome.mjs';
import { startViteDevServer } from './qa-vite-dev.mjs';

const require = createRequire(new URL('../apps/web/package.json', import.meta.url));
const puppeteer = require('puppeteer-core');
const externalBase = process.env.CONNECTION_QA_URL;
const vite = externalBase ? null : await startViteDevServer();
const base = externalBase || vite.base;
const browser = await puppeteer.launch({ executablePath: resolveQaChromePath(), headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
try {
  const page = await browser.newPage();
  await page.setRequestInterception(true);
  page.on('request', request => {
    const pathname = new URL(request.url()).pathname;
    if (pathname === '/api/workspace') void request.respond({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'Repository unavailable.' }) });
    else if (pathname === '/api/auth/session') void request.respond({ contentType: 'application/json', body: '{"authenticated":false,"configured":true,"provider":"github"}' });
    else void request.continue();
  });
  for (const width of [1440, 390]) {
    await page.setViewport({ width, height: 900 });
    await page.goto(base, { waitUntil: 'networkidle0' });
    await page.waitForSelector('main a[href="/api/auth/github"]');
    const buttons = await page.evaluate(() =>
      [...document.querySelectorAll('main button, main a')].map(el => {
        const style = getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return { height: rect.height, font: style.fontSize, padding: style.padding, right: rect.right };
      })
    );
    assert.equal(buttons.length, 2);
    assert.equal(buttons[0].height, buttons[1].height, `Button heights at ${width}px: ${JSON.stringify(buttons)}`);
    assert.equal(buttons[0].font, buttons[1].font);
    assert.equal(buttons[0].padding, buttons[1].padding);
    assert.ok(buttons.every(button => button.height >= 44 && button.right <= width));
    console.log(`PASS connection actions: matching size and no overflow at ${width}px`);
  }
  if (process.env.EXPECTED_LOCAL_REPO) {
    const localPage = await browser.newPage();
    const githubRequests = [];
    localPage.on('request', request => {
      if (new URL(request.url()).hostname.endsWith('github.com')) githubRequests.push(request.url());
    });
    await localPage.goto(base, { waitUntil: 'networkidle0' });
    const workspace = await localPage.evaluate(() => fetch('/api/workspace').then(response => response.json()));
    assert.equal(workspace.source.type, 'local');
    assert.equal(workspace.repoRoot, process.env.EXPECTED_LOCAL_REPO);
    assert.equal(workspace.capabilities.write, true);
    const noteCount = await localPage.evaluate(() => fetch('/api/notes').then(response => response.json()).then(body => body.notes.length));
    assert.ok(noteCount > 0, 'Expected local notes');
    await localPage.waitForSelector('header');
    assert.equal(await localPage.$('a[href="/api/auth/github"]'), null);
    assert.equal(githubRequests.length, 0);
    console.log(`PASS local workspace: ${noteCount} notes, writable main branch, no sign-in or GitHub browser requests`);
  }
} finally {
  await browser.close();
  if (vite) await vite.close();
}
