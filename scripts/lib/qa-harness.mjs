import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { resolveQaChromePath } from '../qa-chrome.mjs';
import { assertFreshBuild } from './require-fresh-build.mjs';
import { DEFAULT_WORKSPACE_PREFERENCES } from '../../packages/core/dist/workspace-preferences.js';

/** The product checkout the qa-*.mjs scripts serve. */
export const product = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** Resolves web-app dependencies such as puppeteer-core and yaml, after confirming the built bundles cover the current sources. */
export function qaRequire() {
  assertFreshBuild(product);
  return createRequire(`${product}/apps/web/package.json`);
}

/** A temporary workspace directory with a file writer, a git runner and a fixture commit. */
export function createQaWorkspace(prefix) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const write = (file, content) => {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), content);
  };
  const git = (...args) => execFileSync('git', args, { cwd: root, stdio: 'pipe' });
  /** Commits every written file as the fixture on a new main branch. */
  const commitFixture = (author = 'Browser QA') => {
    for (const args of [['init', '-b', 'main'], ['config', 'user.name', author], ['config', 'user.email', 'qa@example.com'], ['add', '.'], ['commit', '-m', 'fixture']]) git(...args);
  };
  return { root, write, git, commitFixture };
}

/** Serves `root` as a local-source workspace through the built local server on a free loopback port. */
export async function startQaServer(root) {
  process.env.MYGITNOTES_SOURCE = 'local';
  process.env.MYGITNOTES_LOCAL_PATH = root;
  delete process.env.VERCEL;
  delete process.env.APP_URL;
  const { createApp } = await import(`${product}/apps/local-server/dist/app.js`);
  const server = createServer(createApp(product));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}

/** Launches headless Chrome; `chromeEnv` names the environment variable that overrides the binary. */
export function launchQaBrowser(require, { chromeEnv, args = ['--no-sandbox', '--disable-dev-shm-usage'] } = {}) {
  return require('puppeteer-core').launch({ executablePath: resolveQaChromePath(chromeEnv), headless: true, pipe: true, args });
}

/** Records uncaught page errors into `errors` for the end-of-run assertion. */
export function collectPageErrors(page, errors = []) {
  page.on('pageerror', error => errors.push(error.message));
  return errors;
}

/** Waits for an enabled button whose text is exactly `text`, then clicks it. */
export async function clickButton(page, text) {
  await page.waitForFunction(text => Array.from(document.querySelectorAll('button')).some(b => b.textContent.trim() === text && !b.disabled), {}, text);
  await page.evaluate(text => Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === text && !b.disabled).click(), text);
}

/**
 * A hosted `GET /api/workspace` answer for one GitHub repository serving `config`'s notebooks, as the server reports it:
 * notebooks named by key (`<alias>~<id>`, the alias being the repository's name), and the repository's own title,
 * default notebook, preferences and manifest revision. `key` names a notebook of it for mocked notes and routes; a mocked
 * catalog takes `alias` and the local manifest, as the server's does.
 */
export function hostedWorkspace({ repository, branch = 'main', config, revision, write }) {
  const id = `github:${repository}@${branch}`;
  const alias = repository.split('/').pop();
  const key = localId => `${alias}~${localId}`;
  const keyedConfig = { ...config, workspace: { ...config.workspace, default_notebook: key(config.workspace.default_notebook) }, notebooks: config.notebooks.map(notebook => ({ ...notebook, id: key(notebook.id) })) };
  const status = { config, keyedConfig, local: false, home: id, repositories: [{ id, type: 'github', repository, branch, revision, write, alias, notebooks: keyedConfig.notebooks.map(notebook => notebook.id), title: config.workspace.title, defaultNotebook: keyedConfig.workspace.default_notebook, preferences: { ...DEFAULT_WORKSPACE_PREFERENCES, ...config.preferences }, config, configRevision: revision }] };
  return { id, alias, key, keyedConfig, status };
}
