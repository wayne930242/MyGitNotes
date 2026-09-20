import { chooseSelect } from './browser-select.mjs';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { resolveQaChromePath } from './qa-chrome.mjs';
import { assertFreshBuild } from './lib/require-fresh-build.mjs';
const product = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
assertFreshBuild(product);
const require = createRequire(`${product}/apps/web/package.json`);
const puppeteer = require('puppeteer-core');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'github-notes-browser-'));
const write = (p, s) => {
  fs.mkdirSync(path.dirname(path.join(root, p)), { recursive: true });
  fs.writeFileSync(path.join(root, p), s);
};
const git = (...args) => execFileSync('git', args, { cwd: root, stdio: 'pipe' });
write('notes/.github-notes.yaml', 'schema_version: 1\nworkspace:\n  title: Folder QA\n  default_notebook: example\nnotebooks:\n  - id: example\n    title: Example\n    root: notes/example\n');
write('notes/example/root.md', '---\nstatus: doing\ncustom: keep\n---\n# Root Note\n');
write('notes/example/projects/_dir.yml', 'title: Projects\norder: -1\n');
write('notes/example/projects/deep/_dir.yml', 'title: Deep work\n');
write('notes/example/projects/deep/nested.md', '# Nested Note\n');
write('notes/example/assets/pixel.png', Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64'));
write('notes/AGENTS.md', '# Workspace Guidelines\n\nUse **Markdown** notes.\n');
write('notes/example/AGENTS.md', '# Notebook Guidelines\n\nPreserve frontmatter.\n');
write('notes/research/review.md', '---\nstatus: review\ncustom: preserve\n---\n# Research Note\n');
write('notes/research/other.md', '---\nstatus: Review\n---\n# Case Note\n');
write('notes/example/archived.md', '---\nstatus: archived\n---\n# Archived Note\n');
write('notes/example/hidden.md', '---\nstatus: working\nhiden: true\n---\n# Hidden Note\n');
write('notes/example/visible-archive.md', '---\nstatus: archived\nhiden: false\n---\n# Visible Archive\n');
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
const { parseNoteQuery, queryNotes, queryNotePaths, noteFacets, lookupNotes } = await import(`${product}/packages/core/dist/index.js`);
const server = createServer(createApp(product));
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await puppeteer.launch({ executablePath: resolveQaChromePath(), headless: true, pipe: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 1000 });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
const click = async text => {
  await page.waitForFunction(text => Array.from(document.querySelectorAll('button')).some(b => b.textContent.trim() === text && !b.disabled), {}, text);
  await page.evaluate(text => Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === text && !b.disabled).click(), text);
};
// Pending changes are committed from the right-panel Changes tool.
const commit = async () => {
  if (!await page.$('.changes-tool')) await page.click('button[aria-label="Changes"]');
  await click('Manage changes');
  const committed = page.waitForResponse(response => new URL(response.url()).pathname === '/api/notes/commit');
  await click('Commit to remote repository');
  await committed;
  await page.click('button[aria-label="Changes"]');
  await page.waitForFunction(() => !document.querySelector('.changes-tool'));
};
const assert = (condition, message) => {
  if (!condition) throw Error(message);
};
const selector = title => `button[role="combobox"][aria-label="Status for ${title}"]`;
const options = async selector => {
  const trigger = await page.waitForSelector(selector, { visible: true });
  await trigger.scrollIntoView();
  if (page.viewport()?.hasTouch) {
    const rect = await trigger.boundingBox();
    const hit = await page.evaluate(({ x, y, width, height }) => document.elementFromPoint(x + width / 2, y + height / 2)?.closest('button')?.getAttribute('aria-label'), rect);
    assert(hit === await trigger.evaluate(e => e.getAttribute('aria-label')), `Status tap target obstructed: ${hit}`);
    await page.touchscreen.tap(rect.x + rect.width / 2, rect.y + rect.height / 2);
  } else await trigger.click();
  await page.waitForSelector('[role="listbox"]');
  const result = await page.$$eval('[role="option"]', items => items.map(item => item.getAttribute('data-option-value')));
  await page.keyboard.press('Escape');
  return result;
};
const columns = () => page.$$eval('[data-status-column]', items => items.map(item => item.getAttribute('data-status-column')));
const equal = (actual, expected, message) => assert(JSON.stringify(actual) === JSON.stringify(expected), `${message}: ${JSON.stringify(actual)}`);
const waitDisk = async (file, text) => {
  for (let i = 0; i < 100; i++) {
    if (fs.existsSync(path.join(root, file)) && fs.readFileSync(path.join(root, file), 'utf8').includes(text)) return;
    await new Promise(r => setTimeout(r, 50));
  }
  throw Error(`Missing saved text: ${text}`);
};
const manifest = 'schema_version: 1\nworkspace:\n  title: Status QA\n  default_notebook: example\nnotebooks:\n  - id: example\n    title: Example\n    root: notes/example\n  - id: research\n    title: Research\n    root: notes/research\n    statuses: [capture, published]\n';
// Settings opens the manifest on its form; the raw YAML lives behind the advanced tab.
const editManifest = async text => {
  await page.waitForSelector('#settings-manifest [role="tab"]');
  await page.click('#settings-manifest [role="tab"]:first-child');
  await page.waitForSelector('#settings-manifest textarea');
  await replace('#settings-manifest textarea', text);
};
const replace = async (selector, text) => {
  await page.focus(selector);
  await page.$eval(selector, e => e.select());
  await page.keyboard.type(text);
};
// Document tools reopens on the last used tool, so select Frontmatter only when it is not already shown.
const showFrontmatter = async () => {
  if (!await page.$('[aria-label="Status"]')) {
    await page.click('button[aria-label="Document tools"]');
    const tab = await page.waitForSelector('.note-panel-tabs [role="tab"][aria-label="Frontmatter"]');
    if (await tab.evaluate(e => e.getAttribute('aria-selected') !== 'true')) await tab.click();
  }
  await page.waitForSelector('[aria-label="Status"]');
};
try {
  await page.goto(base + '/settings', { waitUntil: 'networkidle0' });
  // The manifest opens on its form; the raw YAML lives behind the advanced tab.
  await editManifest(manifest);
  await click('Save & Commit');
  await page.waitForFunction(() => document.body.innerText.includes('Workspace configuration saved and committed.'));
  assert(fs.readFileSync(path.join(root, 'notes/.github-notes.yaml'), 'utf8').includes('published'), 'Settings dropped statuses');
  assert(git('log', '--oneline').toString().trim().split('\n').length === 2, 'Config save did not create one commit');
  console.log('PASS notebook definitions persist through Settings validation, commit and reload');
  await page.goto(base + '/notebooks/example', { waitUntil: 'networkidle0' });
  equal(await options(selector('Root Note')), ['', 'inbox', 'working', 'done', 'archived', 'doing'], 'Fallback and legacy options');
  await page.goto(base + '/notebooks/example/folders/projects/deep', { waitUntil: 'networkidle0' });
  equal(await page.$eval(selector('Nested Note'), e => e.value), '', 'Unassigned note incorrectly shows inbox');
  await page.goto(base + '/notebooks/example', { waitUntil: 'networkidle0' });
  await chooseSelect(page, selector('Root Note'), 'working');
  await waitDisk('notes/example/root.md', 'status: working');
  assert(fs.readFileSync(path.join(root, 'notes/example/root.md'), 'utf8').includes('custom: keep'), 'Inline status dropped custom metadata');
  assert(!await page.$('[aria-label="Close note"]'), 'Status selector opened note');
  await page.click('button[title="Card View"]');
  await page.waitForFunction(() => !document.querySelector('tbody'));
  equal(await options(selector('Root Note')), ['', 'inbox', 'working', 'done', 'archived'], 'Card options');
  console.log('PASS default List/Card choices, legacy extension, unassigned display and real inline save');

  for (const view of ['list', 'card', 'kanban']) {
    await page.goto(base + '/notebooks/example?view=' + view, { waitUntil: 'networkidle0' });
    const content = await page.$eval('main', e => e.innerText);
    assert(!content.includes('Archived Note') && !content.includes('Hidden Note'), 'Hidden notes leaked into ' + view);
    assert(content.includes('Visible Archive'), 'Explicit false archive missing from ' + view);
    await page.goto(base + '/notebooks/example?showHidden=true&view=' + view, { waitUntil: 'networkidle0' });
    const expanded = await page.$eval('main', e => e.innerText);
    assert(expanded.includes('Archived Note') && expanded.includes('Hidden Note'), 'Show hidden failed for ' + view);
  }
  await page.goto(base + '/notebooks/example?q=Archived%20Note', { waitUntil: 'networkidle0' });
  assert(!await page.$(selector('Archived Note')), 'Search revealed hidden archive');
  await page.click('[aria-label="Show hidden notes"]');
  await page.waitForSelector(selector('Archived Note'));
  await page.goto(base + '/notebooks/example/notes/archived.md', { waitUntil: 'networkidle0' });
  await page.waitForSelector('[aria-label="Close note"]');
  await showFrontmatter();
  assert(await page.$eval('[aria-label="Hide note"]', e => e.checked), 'Legacy archive not marked hidden');
  await chooseSelect(page, '[aria-label="Status"]', 'working');
  await waitDisk('notes/example/archived.md', 'hiden: false');
  // Close flushes the draft before the zoomed editor unmounts; wait for it to leave the list clickable.
  await page.click('[aria-label="Close note"]');
  await page.waitForFunction(() => !document.querySelector('[aria-label="Close note"]'));
  await page.waitForSelector(selector('Archived Note'));
  await chooseSelect(page, selector('Root Note'), 'archived');
  await waitDisk('notes/example/root.md', 'hiden: true');
  await page.waitForFunction(() => !document.querySelector('button[aria-label="Status for Root Note"]'));
  await page.click('[aria-label="Show hidden notes"]');
  await page.waitForSelector(selector('Root Note'));
  assert(page.url().includes('showHidden=true'), 'Visibility missing from URL');
  await page.reload({ waitUntil: 'networkidle0' });
  assert(await page.$eval('[aria-label="Show hidden notes"]', e => e.getAttribute('aria-pressed') === 'true'), 'Visibility preference lost on reload');
  await chooseSelect(page, selector('Root Note'), 'working');
  await waitDisk('notes/example/root.md', 'hiden: false');
  await page.click('[aria-label="Show hidden notes"]');
  await page.waitForFunction(() => !document.querySelector('button[aria-label="Status for Hidden Note"]'));
  assert(await page.$(selector('Root Note')), 'Unarchived note stayed hidden');
  await page.goto(base + '/notebooks/example/notes/hidden.md', { waitUntil: 'networkidle0' });
  await showFrontmatter();
  await page.click('[aria-label="Hide note"]');
  await waitDisk('notes/example/hidden.md', 'hiden: false');
  await page.click('[aria-label="Close note"]');
  await page.waitForSelector(selector('Hidden Note'));
  console.log('PASS archived visibility in all views, explicit booleans, direct links, Sidebar/reload, archive/unarchive and manual hiding');

  await page.goto(base + '/notebooks/research?view=kanban', { waitUntil: 'networkidle0' });
  equal(await columns(), ['capture', 'published', 'Review', 'review'], 'Notebook Kanban order and exact extensions');
  await page.evaluate(() => [...document.querySelectorAll('aside button')].find(b => b.getAttribute('data-status-filter') === 'review').click());
  await page.waitForFunction(() => location.search.includes('status=review'));
  equal(await columns(), ['capture', 'published', 'Review', 'review'], 'Filtering removed configured or observed columns');
  assert(!await page.$('[data-notepath="notes/research/other.md"]'), 'Case-sensitive filter mixed statuses');
  await page.click('button[title="List View"]');
  equal(await options(selector('Research Note')), ['', 'capture', 'published', 'Review', 'review'], 'Filtered note choices');
  console.log('PASS per-notebook isolation, unknown filters, exact values and stable Kanban columns');

  await page.goto(base + '/notebooks/research', { waitUntil: 'networkidle0' });
  await click('New Note');
  equal(await page.$eval('[aria-label="Initial Status"]', e => e.value), 'capture', 'Custom initial status');
  await page.type('input[aria-describedby="create-note-error"]', 'Created Research');
  await click('Create Note');
  await page.waitForSelector('[aria-label="Close note"]');
  await waitDisk('notes/research/created-research.md', 'status: capture');
  await showFrontmatter();
  equal(await options('[aria-label="Status"]'), ['', 'capture', 'published', 'Review', 'review'], 'Editor options');
  assert(await page.$('[aria-label="Close note"]'), 'Popup Escape closed editor');
  await chooseSelect(page, '[aria-label="Status"]', 'review');
  await waitDisk('notes/research/created-research.md', 'status: review');
  await page.click('[aria-label="Close note"]');
  await page.goto(base + '/notebooks/research?view=kanban', { waitUntil: 'networkidle0' });
  await page.click('[data-status-column="published"] button[title="Add note to published"]');
  equal(await page.$eval('[aria-label="Initial Status"]', e => e.value), 'published', 'Kanban creation status');
  await click('Cancel');
  console.log('PASS custom first-status creation, column creation and metadata save');

  await page.goto(base + '/notebooks/research?view=card', { waitUntil: 'networkidle0' });
  await chooseSelect(page, selector('Case Note'), 'published');
  await waitDisk('notes/research/other.md', 'status: published');

  // A removed definition is still offered when a note uses it; config has no inferred writes.
  await page.goto(base + '/settings', { waitUntil: 'networkidle0' });
  await editManifest(manifest.replace('[capture, published]', '[capture]'));
  await click('Save & Commit');
  await page.waitForFunction(() => document.body.innerText.includes('Workspace configuration saved and committed.'));
  const configBefore = fs.readFileSync(path.join(root, 'notes/.github-notes.yaml'), 'utf8');
  await page.setViewport({ width: 320, height: 700, isMobile: true, hasTouch: true });
  await page.goto(base + '/notebooks/research?view=card', { waitUntil: 'networkidle0' });
  equal(await options(selector('Research Note')), ['', 'capture', 'published', 'review'], 'Mobile extension choices');
  await chooseSelect(page, selector('Research Note'), 'published');
  await waitDisk('notes/research/review.md', 'status: published');
  equal(fs.readFileSync(path.join(root, 'notes/.github-notes.yaml'), 'utf8'), configBefore, 'Note status rewrote manifest');
  assert(fs.readFileSync(path.join(root, 'notes/research/review.md'), 'utf8').includes('custom: preserve'), 'Unknown status save dropped metadata');
  await chooseSelect(page, selector('Research Note'), '');
  await page.waitForFunction(() => document.querySelector('button[aria-label="Status for Research Note"]').value === '');
  await page.reload({ waitUntil: 'networkidle0' });
  equal(await page.$eval(selector('Research Note'), e => e.value), '', 'No-status clear did not persist');
  assert(!fs.readFileSync(path.join(root, 'notes/research/review.md'), 'utf8').includes('status:'), 'Clear retained status metadata');
  console.log('PASS mobile custom status save and clear, metadata preservation and unchanged manifest');

  // The same UI consumes a hosted workspace's manifest and revision-aware save.
  let remoteNote = { id: 'remote', path: 'notes/research/remote.md', notebookId: 'research', title: 'Remote Note', content: '# Remote Note\n', metadata: { status: 'external', custom: 'remote' }, status: 'external', tags: [], revision: 'one' };
  let saved;
  await page.setRequestInterception(true);
  const hostedConfig = { schema_version: 1, workspace: { title: 'Hosted', default_notebook: 'research' }, notebooks: [{ id: 'research', title: 'Research', root: 'notes/research', statuses: ['capture', 'published', 'archived'] }] };
  const hostedCatalog = { revision: async () => remoteNote.revision, config: async () => hostedConfig, index: async notebook => [remoteNote].filter(note => note.notebookId === notebook.id), contents: async notes => new Map(notes.map(note => [note.path, note.content])), memo: (kind, notebooks, compute) => compute() };
  page.on('request', async request => {
    const url = new URL(request.url());
    let body;
    if (url.pathname === '/api/workspace') body = { config: hostedConfig, branch: 'main', repoRoot: '', gitStatus: { branch: 'main', isClean: true, staged: [], modified: [], untracked: [] }, source: { type: 'github', identity: 'github:fixture/repo@main' }, capabilities: { write: true, local: false }, revision: remoteNote.revision };
    if (url.pathname === '/api/notes/commit') {
      const payload = JSON.parse(request.postData());
      saved = { ...payload.notes[0], revision: payload.revision };
      remoteNote = { ...remoteNote, ...saved, status: saved.metadata.status, revision: 'two' };
      body = { revision: 'two', commit: { commitHash: 'two' } };
    }
    if (url.pathname === '/api/notes') {
      if (request.method() === 'POST') {
        saved = JSON.parse(request.postData());
        remoteNote = { ...remoteNote, ...saved, status: saved.metadata.status, revision: 'two' };
        body = { note: remoteNote, commit: { commitHash: 'two' } };
      } else body = { notes: [remoteNote] };
    }
    // Lists and counts come from server queries; answer them with the core catalog rules.
    if (url.pathname === '/api/notes/query') {
      const { query, options } = parseNoteQuery(Object.fromEntries(url.searchParams));
      body = options.select ? await queryNotePaths(hostedCatalog, query) : await queryNotes(hostedCatalog, query, options);
    }
    if (url.pathname === '/api/notes/lookup') {
      const lookup = JSON.parse(request.postData());
      body = await lookupNotes(hostedCatalog, lookup.paths, lookup.content === true);
    }
    if (url.pathname === '/api/notes/facets') body = await noteFacets(hostedCatalog, url.searchParams.get('showHidden') === '1');
    if (url.pathname === '/api/notes/read') body = { note: remoteNote };
    if (url.pathname === '/api/notes/read-batch') body = { notes: [remoteNote] };
    if (url.pathname === '/api/auth/session') body = { authenticated: true, user: { login: 'fixture' } };
    if (url.pathname === '/api/folders') body = { folders: [] };
    if (url.pathname === '/api/assets') body = { assets: [] };
    if (url.pathname === '/api/git/status') body = { status: { branch: 'main', isClean: true, staged: [], modified: [], untracked: [] }, commits: [] };
    if (body) void request.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    else void request.continue();
  });
  await page.goto(base + '/notebooks/research', { waitUntil: 'networkidle0' });
  equal(await options(selector('Remote Note')), ['', 'capture', 'published', 'archived', 'external'], 'Hosted status options');
  await chooseSelect(page, selector('Remote Note'), 'published');
  await page.waitForFunction(() => document.querySelector('button[aria-label="Status for Remote Note"]').value === 'published');
  assert(!saved, 'Inline status committed immediately');
  await commit();
  assert(saved.revision === 'one' && saved.metadata.custom === 'remote' && saved.metadata.status === 'published', 'Hosted save lost revision or metadata');
  fs.mkdirSync(`${product}/artifacts/qa`, { recursive: true });
  await page.screenshot({ path: `${product}/artifacts/qa/mobile-note-statuses.png`, fullPage: true });
  await chooseSelect(page, selector('Remote Note'), 'archived');
  await page.waitForFunction(() => !document.querySelector('button[aria-label="Status for Remote Note"]'));
  assert(saved.metadata.status === 'published', 'Archive committed immediately');
  // The hidden-notes toggle lives in the note toolbar, not the Sidebar drawer.
  await page.click('[aria-label="Show hidden notes"]');
  await page.waitForSelector(selector('Remote Note'));
  await chooseSelect(page, selector('Remote Note'), 'capture');
  await page.waitForFunction(() => document.querySelector('button[aria-label="Status for Remote Note"]').value === 'capture');
  await commit();
  assert(saved.metadata.hiden === false && saved.revision === 'two', 'Hosted unarchive did not persist visibility on Commit');
  console.log('PASS hosted mobile choices, toolbar visibility, archive/unarchive and revision-aware status save');
  assert(!errors.length, errors.join('; '));
  console.log('PASS no browser runtime errors');
} catch (error) {
  await page.screenshot({ path: '/tmp/status-qa-failure.png', fullPage: true });
  console.log(await page.evaluate(() => ({ url: location.href, text: document.body.innerText.slice(-1500) })));
  throw error;
} finally {
  await browser.close();
  await new Promise(r => server.close(r));
  fs.rmSync(root, { recursive: true, force: true });
}
