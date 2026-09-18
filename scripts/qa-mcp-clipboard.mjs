import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolveQaChromePath } from './qa-chrome.mjs';
import { startViteDevServer } from './qa-vite-dev.mjs';

const require = createRequire(new URL('../apps/web/package.json', import.meta.url));
const puppeteer = require('puppeteer-core');
const externalBase = process.env.CLIPBOARD_QA_URL;
const vite = externalBase ? null : await startViteDevServer();
const base = externalBase || vite.base;
const url = `${base}/mcp/clipboard-test-token`;
const browser = await puppeteer.launch({
  executablePath: resolveQaChromePath(),
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});

try {
  for (const mode of ['normal', 'denied', 'unavailable', 'pending', 'blocked']) {
    const page = await browser.newPage();
    await page.setRequestInterception(true);
    page.on('request', request => {
      const pathname = new URL(request.url()).pathname;
      if (request.isNavigationRequest()) {
        void request.respond({ contentType: 'text/html', body: '<div id="root"></div><textarea id="paste" aria-label="Paste verification"></textarea>' });
      } else if (pathname.startsWith('/api/')) {
        const body = pathname === '/api/auth/session' ? { authenticated: true }
          : pathname === '/api/auth/agent-token' ? { url } : { grants: [] };
        void request.respond({ contentType: 'application/json', body: JSON.stringify(body) });
      } else void request.continue();
    });
    await page.goto(base);
    await page.evaluate(async mode => {
      if (mode === 'unavailable') Object.defineProperty(navigator, 'clipboard', { value: undefined });
      if (mode === 'denied') navigator.clipboard.writeText = () => Promise.reject(new DOMException('Denied', 'NotAllowedError'));
      if (mode === 'pending') navigator.clipboard.writeText = () => new Promise(() => {});
      if (mode === 'blocked') {
        navigator.clipboard.writeText = () => Promise.reject(new DOMException('Denied', 'NotAllowedError'));
        document.execCommand = () => false;
      }
      const refresh = await import('/@react-refresh');
      refresh.default.injectIntoGlobalHook(window);
      window.$RefreshReg$ = () => {};
      window.$RefreshSig$ = () => type => type;
      window.__vite_plugin_react_preamble_installed__ = true;
      const { default: React } = await import('/node_modules/.vite/deps/react.js');
      const { default: { createRoot } } = await import('/node_modules/.vite/deps/react-dom_client.js');
      const { AgentAccessSettings } = await import('/src/components/AuthControls.tsx');
      createRoot(document.getElementById('root')).render(React.createElement(AgentAccessSettings));
    }, mode);
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some(b => b.textContent === 'Create grant' && !b.disabled));
    const create = await page.$('::-p-text(Create grant)');
    await create.click();
    await page.waitForSelector('#agent-token');
    await page.click('button[title="Copy"]');
    if (mode === 'blocked') {
      await page.waitForSelector('[role="alert"]');
      assert.equal(await page.$('button[title="Copied"]'), null);
      assert.equal(await page.$eval('#agent-token', el => el.value.slice(el.selectionStart, el.selectionEnd)), url);
      console.log('PASS blocked: manual copy selection and error without success indicator');
      await page.close();
      continue;
    }
    await page.waitForSelector('button[title="Copied"]', { timeout: 3000 });
    await page.click('#paste');
    await page.keyboard.down('Control');
    await page.keyboard.press('KeyV', { commands: ['paste'] });
    await page.keyboard.up('Control');
    assert.equal(await page.$eval('#paste', el => el.value), url, `${mode}: pasted URL`);
    console.log(`PASS ${mode}: copied indicator and pasted MCP URL`);
    await page.close();
  }
} finally {
  await browser.close();
  if (vite) await vite.close();
}
