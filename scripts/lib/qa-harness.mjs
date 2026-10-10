import assert from 'node:assert/strict';
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
  const status = { keyedConfig, local: false, defaultRepository: id, coreUpdate: false, repositories: [{ id, type: 'github', repository, branch, revision, write, alias, notebooks: keyedConfig.notebooks.map(notebook => notebook.id), title: config.workspace.title, defaultNotebook: keyedConfig.workspace.default_notebook, preferences: { ...DEFAULT_WORKSPACE_PREFERENCES, ...config.preferences }, config, configRevision: revision }] };
  return { id, alias, key, keyedConfig, status };
}

/**
 * Where the first paragraph of the note slot `scope` (a card or a Book section) reads, and in what type, before it edits.
 * A thumbnail card reads as a short clamped summary rather than the note's body, so it has a left edge and measure but no type to match.
 */
export async function slotReading(page, scope) {
  await page.waitForSelector(`${scope} .compilation-inline-reading :is(.screen-markdown p, .screen-summary)`, { timeout: 20000 });
  return page.$eval(scope, slot => {
    const body = slot.querySelector('.compilation-inline-reading .screen-markdown p');
    const paragraph = body ?? slot.querySelector('.compilation-inline-reading .screen-summary');
    const style = getComputedStyle(paragraph), box = paragraph.getBoundingClientRect();
    return { typed: Boolean(body), fontSize: style.fontSize, lineHeight: parseFloat(style.lineHeight), left: box.left, width: box.width };
  });
}

/**
 * The note slot `scope` edits in the reading layout (E15): no page, no paper behind the text, no toolbar, mode switch or
 * path bar, one quiet save-state line, and the same type and left edge as `reading`, which `slotReading` measured before.
 * With `fills`, the editor also takes the card's whole content height and the text starts at its top (E16).
 */
export async function assertReadingLayout(page, scope, reading, label, { fills = false } = {}) {
  const found = await page.$eval(scope, slot => {
    const text = slot.querySelector('.compilation-inline-editor').innerText;
    const line = [...slot.querySelectorAll('.cm-line')].find(candidate => candidate.textContent.trim() && !candidate.classList.contains('live-md-heading'));
    const style = getComputedStyle(line), box = line.getBoundingClientRect();
    const rect = selector => slot.querySelector(selector)?.getBoundingClientRect();
    const content = slot.querySelector('.screen-card-content')?.getBoundingClientRect();
    const editor = rect('.compilation-inline-editor'), body = rect('.note-editor-body'), markdown = rect('[data-markdown-editor]');
    return { pageLabels: slot.querySelectorAll('.live-md-page-footer, .live-md-page-break, .live-md-page-divider').length, pageText: /\bPage \d+\b/.test(text), paper: slot.querySelectorAll('.cm-card-background').length, chrome: slot.querySelectorAll('[data-mode-toggle], .note-compact-bar, .note-compact-path, .markdown-insert-toolbar, .note-format-toolbar, .note-toolbar, .note-footer, [data-source-line-numbers], .cm-lineNumbers').length, status: slot.querySelector('.note-inline-status')?.textContent.trim() ?? '', fontSize: style.fontSize, lineHeight: parseFloat(style.lineHeight), left: box.left, width: box.width, top: box.top, contentTop: content?.top, contentHeight: content?.height, editorHeight: editor?.height, bodyBottom: body?.bottom, markdownBottom: markdown?.bottom, bodyHeight: body?.height, markdownHeight: markdown?.height };
  });
  assert.equal(found.pageLabels + found.paper, 0, `${label}: the editing slot shows a page or its paper`);
  assert.equal(found.pageText, false, `${label}: the editing slot names a page`);
  assert.equal(found.chrome, 0, `${label}: the editing slot shows editor chrome`);
  assert.ok(found.status.length > 0, `${label}: the editing slot has no save-state line`);
  if (reading.typed) {
    assert.equal(found.fontSize, reading.fontSize, `${label}: type size differs from reading`);
    assert.ok(Math.abs(found.lineHeight - reading.lineHeight) <= 0.5, `${label}: line height ${found.lineHeight} differs from reading ${reading.lineHeight}`);
  }
  assert.ok(Math.abs(found.left - reading.left) <= 2, `${label}: text starts at ${found.left}, reading at ${reading.left}`);
  assert.ok(found.width >= reading.width - 20 && found.width <= reading.width + 2, `${label}: text measure ${found.width} differs from reading ${reading.width}`);
  if (fills) {
    assert.ok(Math.abs(found.editorHeight - found.contentHeight) <= 2, `${label}: the editor is ${found.editorHeight}px in a ${found.contentHeight}px card body`);
    assert.ok(Math.abs(found.markdownBottom - found.bodyBottom) <= 1 && found.markdownHeight >= found.bodyHeight - 1, `${label}: the text area leaves a band in the editor body`);
    assert.ok(found.top - found.contentTop <= 16, `${label}: the text starts ${found.top - found.contentTop}px below the top of the card body`);
  }
  return found;
}
