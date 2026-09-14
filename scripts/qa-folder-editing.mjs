import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';

const product = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(`${product}/apps/web/package.json`);
const puppeteer = require('puppeteer-core');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'github-notes-index-'));
const write = (file, content) => {
  fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  fs.writeFileSync(path.join(root, file), content);
};
const git = (...args) => execFileSync('git', args, { cwd: root, stdio: 'pipe' });
write('notes/.github-notes.yaml', 'schema_version: 1\nworkspace:\n  title: Folder Index QA\n  default_notebook: example\nnotebooks:\n  - id: example\n    title: Example\n    root: notes/example\n  - id: other\n    title: Other\n    root: notes/other\n');
write('notes/example/index.md', '---\ntitle: Notebook introduction\ncustom: preserve\n---\n# 根目錄介紹\n\n這是 **索引內容**。\n\n[進入資料夾](projects/)\n\n[開啟筆記](regular.md)\n\n<img src="bad" onerror="window.indexUnsafe=true">\n<script>window.indexUnsafe=true</script>\n');
write('notes/example/regular.md', '# Regular Note\n');
write('notes/example/README.md', '# Secondary README\n');
write('notes/example/readme/deep/README.md', '# README guide\n');
write('notes/example/projects/index.md', '# 專案介紹\n\n[深入閱讀](deep/index.md)\n\n[同頁段落](#細節)\n\n## 細節\n\n專案內容。\n');
write('notes/example/projects/deep/index.md', '# 深層介紹\n');
write('notes/example/empty/note.md', '# No Index\n');
write('notes/example/hidden/index.md', '---\nhiden: true\n---\n# 隱藏介紹\n');
write('notes/example/hidden/README.md', '# Visible fallback\n');
write('notes/example/blank/index.md', '');
write('notes/other/README.md', '# 其他筆記本\n');
git('init', '-b', 'main'); git('config', 'user.name', 'Browser QA'); git('config', 'user.email', 'qa@example.com');
git('add', '.'); git('commit', '-m', 'fixture');
process.env.MYGITNOTES_SOURCE = 'local'; process.env.MYGITNOTES_LOCAL_PATH = root;
delete process.env.VERCEL; delete process.env.APP_URL;
const { createApp } = await import(`${product}/apps/local-server/dist/app.js`);
const server = createServer(createApp(product));
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await puppeteer.launch({ executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || path.join(os.homedir(), '.cache/puppeteer/chrome/linux-131.0.6778.204/chrome-linux64/chrome'), headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage();
const errors = []; page.on('pageerror', error => errors.push(error.message));


const visit = route => page.goto(base + route, { waitUntil: 'networkidle0' });
const click = async text => {
  await page.waitForFunction(text => [...document.querySelectorAll('button')].some(button => button.textContent.trim() === text && !button.disabled), {}, text);
  await page.evaluate(text => [...document.querySelectorAll('button')].find(button => button.textContent.trim() === text && !button.disabled).click(), text);
};
const closeIndex = async () => {
  await page.click('[aria-label="Close note"]');
  await page.waitForFunction(() => !document.querySelector('[aria-label="Close note"]'));
};
const createFolder = async (name, index) => {
  await page.click('[aria-label="New folder"]');
  await page.type('dialog input[required]', name);
  assert.equal(await page.$eval('input[name="createIndex"]', input => input.checked), false, 'Index creation must be optional');
  if (index) await page.click('input[name="createIndex"]');
  await page.click('dialog button[type="submit"]');
};
const manage = async name => {
  await page.waitForFunction(name => { const button = document.querySelector(`[aria-label="Manage folder: ${name}"]`); return button && !button.disabled; }, {}, name);
  await page.click(`[aria-label="Manage folder: ${name}"]`);
};
const editContent = async content => {
  await click('Source');
  await page.focus('textarea[aria-label="Note content"]');
  await page.keyboard.down('Control'); await page.keyboard.press('KeyA'); await page.keyboard.up('Control');
  await page.keyboard.type(content);
};
try {
  await page.setViewport({ width: 1440, height: 1000 });
  await visit('/settings');
  for (const theme of ['clean-indigo', 'warm-sepia', 'forest-emerald', 'github-dark', 'nord-arctic', 'midnight-violet']) {
    await page.evaluate(theme => localStorage.setItem('github_notes_theme', theme), theme);
    await visit('/settings');
    await page.focus('#settings-manifest textarea');
    const colors = await page.$eval('#settings-manifest textarea', element => {
      const style = getComputedStyle(element);
      return { caret: style.caretColor, text: style.color, background: style.backgroundColor, readonly: element.readOnly, focused: element === document.activeElement };
    });
    assert(colors.focused && !colors.readonly);
    assert.equal(colors.caret, colors.text, `Manifest caret must match its text: ${theme}`);
    assert.notEqual(colors.caret, colors.background);
    const original = await page.$eval('#settings-manifest textarea', input => input.value);
    await page.keyboard.press('End'); await page.keyboard.type(' # caret QA');
    assert(await page.$eval('#settings-manifest textarea', input => input.value.includes('# caret QA')), 'Focused textarea must accept keyboard input');
    await page.keyboard.down('Control'); await page.keyboard.press('KeyA'); await page.keyboard.up('Control');
    await page.keyboard.type(original);
  }
  console.log('PASS focused editable manifest caret in all six themes');
  await page.evaluate(() => localStorage.setItem('github_notes_theme', 'clean-indigo'));
  await visit('/notebooks/example');
  await createFolder('Plain folder', false);
  await page.waitForFunction(() => location.pathname.endsWith('/folders/Plain%20folder'));
  assert(!fs.existsSync(path.join(root, 'notes/example/Plain folder/index.md')));
  await manage('Plain folder'); await click('Create index.md');
  await page.waitForSelector('[aria-label="Close note"]');
  assert(new URL(page.url()).pathname.endsWith('/notes/Plain%20folder/index.md'));
  await closeIndex();
  assert(new URL(page.url()).pathname.endsWith('/folders/Plain%20folder'), 'Closing index must return to its own folder');
  const existing = fs.readFileSync(path.join(root, 'notes/example/Plain folder/index.md'), 'utf8');
  await manage('Plain folder'); await click('Edit index.md');
  await page.waitForSelector('[aria-label="Close note"]');
  assert.equal(fs.readFileSync(path.join(root, 'notes/example/Plain folder/index.md'), 'utf8'), existing);
  await editContent('# Local index\n\nSaved folder introduction\n');
  await page.waitForFunction(() => document.body.innerText.includes('Uncommitted Changes'));
  await closeIndex();
  assert(fs.readFileSync(path.join(root, 'notes/example/Plain folder/index.md'), 'utf8').includes('Saved folder introduction'));
  console.log('PASS optional creation, manage create/edit, saving and return navigation');
  await visit('/notebooks/example/folders/projects');
  await createFolder('Nested folder', true);
  await page.waitForSelector('[aria-label="Close note"]');
  assert(new URL(page.url()).pathname.endsWith('/notes/projects/Nested%20folder/index.md'));
  assert(fs.existsSync(path.join(root, 'notes/example/projects/Nested folder/index.md')));
  assert(!fs.existsSync(path.join(root, 'notes/example/Nested folder/index.md')));
  await closeIndex();
  assert(new URL(page.url()).pathname.endsWith('/folders/projects/Nested%20folder'));
  await visit('/notebooks/example');
  for (const folder of ['hidden', 'blank', 'projects']) {
    const file = path.join(root, `notes/example/${folder}/index.md`);
    const before = fs.readFileSync(file);
    await manage(folder); await click('Edit index.md');
    await page.waitForSelector('[aria-label="Close note"]');
    await closeIndex(); assert.deepEqual(fs.readFileSync(file), before, 'Existing index must not be overwritten, even hidden or blank');
  }
  await visit('/notebooks/example/folders/readme/deep');
  await page.click('[data-folder-drop="inside:readme/deep"] .folder-manage'); await click('Create index.md');
  await page.waitForSelector('[aria-label="Close note"]');
  assert(new URL(page.url()).pathname.endsWith('/notes/readme/deep/index.md'));
  assert.equal(fs.readFileSync(path.join(root, 'notes/example/readme/deep/README.md'), 'utf8'), '# README guide\n');
  await closeIndex();
  assert.equal(git('log', '--oneline').toString().trim().split('\n').length, 1, 'Local index creation must not implicitly commit');
  console.log('PASS nested creation, hidden/blank preservation, README preservation and explicit commits');

  // Simulate an index save failure after the folder has already been created.
  let failIndex = true;
  await page.setRequestInterception(true);
  const interceptFailure = request => {
    if (failIndex && new URL(request.url()).pathname === '/api/notes' && request.method() === 'POST') void request.respond({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Index save unavailable' }) });
    else void request.continue();
  };
  page.on('request', interceptFailure);
  await visit('/notebooks/example'); await createFolder('Retry folder', true);
  await page.waitForFunction(() => document.querySelector('dialog [role="alert"]')?.textContent.includes('The folder was created'));
  assert(fs.existsSync(path.join(root, 'notes/example/Retry folder/_dir.yml')));
  assert(!fs.existsSync(path.join(root, 'notes/example/Retry folder/index.md')));
  failIndex = false;
  await click('Create index.md'); await page.waitForSelector('[aria-label="Close note"]');
  await closeIndex();
  assert(fs.existsSync(path.join(root, 'notes/example/Retry folder/index.md')));
  page.off('request', interceptFailure); await page.setRequestInterception(false);
  console.log('PASS partial failure stays actionable and retries index creation without recreating the folder');
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await page.evaluate(() => localStorage.setItem('github-notes:language', 'zh-TW'));
  await visit('/notebooks/example');
  // Open the notebook drawer through its accessible toggle.
  const toggles = await page.$$eval('button', buttons => buttons.filter(button => button.getAttribute('aria-controls') === 'notebook-panel').map(button => button.getAttribute('aria-label')));
  assert.equal(toggles.length, 1);
  await page.click('[aria-controls="notebook-panel"]');
  await page.click('[aria-label="新增資料夾"]');
  assert(await page.$eval('dialog', element => element.innerText.includes('建立資料夾後，建立並編輯 index.md')));
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  fs.mkdirSync(`${product}/artifacts/qa`, { recursive: true });
  await page.screenshot({ path: `${product}/artifacts/qa/folder-editing-mobile.png`, fullPage: true });
  await page.keyboard.press('Escape');
  await page.evaluate(() => localStorage.setItem('github-notes:language', 'en'));
  assert.deepEqual(errors, []);

  console.log('PASS mobile dialog and Traditional Chinese labels');
  await page.setViewport({ width: 1440, height: 1000, isMobile: false, hasTouch: false });
  let writable = true;
  let hostedFolders = [{ notebookId: 'example', path: 'hosted', title: 'Hosted folder' }, { notebookId: 'example', path: 'existing', title: 'Existing folder' }];
  const hostedNote = { id: 'index', path: 'notes/example/existing/index.md', notebookId: 'example', title: 'Existing index', content: '# Existing index\n\nOriginal hosted content\n', tags: [], metadata: { title: 'Existing index', custom: 'preserve' }, revision: 'one' };
  let noteWrites = 0, folderWrites = 0;
  await page.setRequestInterception(true);
  page.on('request', request => {
    const url = new URL(request.url()); let body;
    if (url.pathname === '/api/workspace') body = { config: { schema_version: 1, workspace: { title: 'Hosted editing QA', default_notebook: 'example' }, notebooks: [{ id: 'example', title: 'Example', root: 'notes/example' }] }, branch: 'main', repoRoot: '', gitStatus: { branch: 'main', isClean: true, staged: [], modified: [], untracked: [] }, source: { type: 'github', identity: 'github:folder/editing@main' }, capabilities: { write: writable, local: false }, revision: folderWrites ? 'two' : 'one' };
    if (url.pathname === '/api/notes') body = { notes: [hostedNote] };
    if (url.pathname === '/api/notes/read') body = { note: hostedNote };
    if (url.pathname === '/api/auth/session') body = { authenticated: writable, configured: true, login: 'fixture' };
    if (url.pathname === '/api/folders') body = { folders: hostedFolders };
    if (url.pathname === '/api/assets') body = { assets: [] };
    if (url.pathname === '/api/folder-manager') {
      body = { revision: folderWrites ? 'two' : 'one', writable };
      if (request.method() === 'POST') {
        folderWrites++;
        const { command } = JSON.parse(request.postData());
        const folder = [command.parent, command.name].filter(Boolean).join('/');
        hostedFolders = [...hostedFolders, { notebookId: 'example', path: folder, title: command.title }];
        body = { revision: 'two', selectedPath: folder };
      }
    }
    if (url.pathname.startsWith('/api/notes') && request.method() !== 'GET') noteWrites++;
    if (body) void request.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    else void request.continue();
  });
  await visit('/notebooks/example');
  await manage('Existing folder'); await click('Edit index.md');
  await page.waitForSelector('[aria-label="Close note"]');
  await editContent('# Existing index\n\nHosted working draft\n');
  await closeIndex();
  await page.reload({ waitUntil: 'networkidle0' });
  await manage('Existing folder'); await click('Edit index.md');
  await click('Source');
  assert(await page.$eval('textarea[aria-label="Note content"]', input => input.value.includes('Hosted working draft')));
  await closeIndex();
  assert.equal(noteWrites, 0, 'Editing existing hosted indexes must remain a working draft');
  // Clear this fixture draft to exercise the existing pre-folder-change guard independently.
  await page.evaluate(() => { for (const key of Object.keys(localStorage)) if (key.startsWith('gh_notes_working:') || key.startsWith('gh_notes_draft:')) localStorage.removeItem(key); });
  await visit('/notebooks/example');
  await createFolder('Hosted new', true);
  await page.waitForSelector('[aria-label="Close note"]');
  assert(new URL(page.url()).pathname.endsWith('/notes/Hosted%20new/index.md'));
  await editContent('# New hosted index\n\nKeep this draft\n');
  await closeIndex();
  await page.reload({ waitUntil: 'networkidle0' });
  await manage('Hosted new'); await click('Edit index.md');
  await click('Source');
  assert(await page.$eval('textarea[aria-label="Note content"]', input => input.value.includes('Keep this draft')));
  await closeIndex();
  assert.equal(folderWrites, 1);
  assert.equal(noteWrites, 0, 'Creating a hosted index must wait for the regular explicit commit');
  await manage('Hosted folder'); await click('Create index.md');
  await page.waitForSelector('[aria-label="Close note"]'); await closeIndex();
  assert.equal(noteWrites, 0);
  writable = false;
  await visit('/notebooks/example');
  assert(!await page.$('[aria-label="New folder"], .folder-manage'), 'Read-only users must not be offered folder/index mutations');
  assert.equal(noteWrites, 0);
  console.log('PASS hosted existing/new drafts survive reload, post-create editor, explicit commit boundary and read-only controls');
  assert.deepEqual(errors, []);
} catch (error) {
  console.error('QA location:', page.url());
  console.error(await page.evaluate(() => document.body.innerText.slice(-5000)));
  throw error;
} finally {
  await browser.close(); await new Promise(resolve => server.close(resolve));
  fs.rmSync(root, { recursive: true, force: true });
}
