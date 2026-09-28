import fs from 'node:fs';
import path from 'node:path';
import { clickButton, collectPageErrors, createQaWorkspace, launchQaBrowser, product, qaRequire, startQaServer } from './lib/qa-harness.mjs';
const require = qaRequire();
const { root, write, commitFixture } = createQaWorkspace('github-notes-browser-');
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
commitFixture();
const { server, base } = await startQaServer(root);
const { parseNoteQuery, queryNotes, queryNotePaths, noteFacets, lookupNotes, workspaceCatalog } = await import(`${product}/packages/core/dist/index.js`);
const browser = await launchQaBrowser(require);
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 1000 });
const errors = collectPageErrors(page);
const click = text => clickButton(page, text);
const assert = (condition, message) => {
  if (!condition) throw Error(message);
};
const _selector = title => `button[role="combobox"][aria-label="Status for ${title}"]`;
const _options = async selector => {
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
const _columns = () => page.$$eval('[data-status-column]', items => items.map(item => item.getAttribute('data-status-column')));
const _equal = (actual, expected, message) => assert(JSON.stringify(actual) === JSON.stringify(expected), `${message}: ${JSON.stringify(actual)}`);
const _waitDisk = async (file, text) => {
  for (let i = 0; i < 100; i++) {
    if (fs.existsSync(path.join(root, file)) && fs.readFileSync(path.join(root, file), 'utf8').includes(text)) return;
    await new Promise(r => setTimeout(r, 50));
  }
  throw Error(`Missing saved text: ${text}`);
};
const _manifest = 'schema_version: 1\nworkspace:\n  title: Status QA\n  default_notebook: example\nnotebooks:\n  - id: example\n    title: Example\n    root: notes/example\n  - id: research\n    title: Research\n    root: notes/research\n    statuses: [capture, published]\n';
const replace = async (selector, text) => {
  await page.focus(selector);
  await page.$eval(selector, e => e.select());
  await page.keyboard.type(text);
};
let rev = 1, commits = [], failCommit = false, reads = [], lookups = [];
const makeNote = (name) => ({ id: name, path: `notes/example/${name}.md`, notebookId: 'example', title: name, content: `# ${name}\n\nFirst line\n\nLast line\n`, metadata: { status: 'inbox', custom: 'keep' }, status: 'inbox', tags: [], revision: String(rev) });
let remoteNotes = [makeNote('welcome'), makeNote('second')];
const bump = () => {
  rev++;
  remoteNotes = remoteNotes.map(note => ({ ...note, revision: String(rev) }));
};
await page.setRequestInterception(true);
const hostedConfig = { schema_version: 1, workspace: { title: 'Working notes QA', default_notebook: 'example' }, notebooks: [{ id: 'example', title: 'Example', root: 'notes/example' }] };
const hostedRepository = { revision: async () => String(rev), index: async notebook => remoteNotes.filter(note => note.notebookId === notebook.id), contents: async notes => new Map(notes.map(note => [note.path, note.content])), memo: (kind, notebooks, compute) => compute() };
const hostedCatalog = () => workspaceCatalog(hostedConfig, [{ id: 'github:working/fixture@main', notebooks: hostedConfig.notebooks, catalog: hostedRepository }]);
page.on('request', async request => {
  const url = new URL(request.url());
  let body, status = 200;
  if (url.pathname === '/api/workspace') body = { config: hostedConfig, configRevision: String(rev), local: false, home: 'github:working/fixture@main', repositories: [{ id: 'github:working/fixture@main', type: 'github', repository: 'working/fixture', branch: 'main', revision: String(rev), write: true, notebooks: ['example'] }] };
  if (url.pathname === '/api/notes') {
    assert(request.method() === 'GET', 'Edit used immediate remote save');
    body = { notes: remoteNotes };
  }
  // Lists, lookups and counts come from server queries; answer them with the core catalog rules.
  if (url.pathname === '/api/notes/query') {
    const { query, options } = parseNoteQuery(Object.fromEntries(url.searchParams));
    body = options.select ? await queryNotePaths(await hostedCatalog(), query) : await queryNotes(await hostedCatalog(), query, options);
  }
  if (url.pathname === '/api/notes/lookup') {
    const lookup = JSON.parse(request.postData());
    lookups.push(...lookup.notes.map(note => note.path));
    body = await lookupNotes(await hostedCatalog(), lookup.notes, lookup.content === true);
  }
  if (url.pathname === '/api/notes/facets') body = await noteFacets(await hostedCatalog(), url.searchParams.get('showHidden') === '1');
  if (url.pathname === '/api/notes/read') {
    const file = url.searchParams.get('path');
    reads.push(file);
    const note = remoteNotes.find(n => n.path === file);
    body = note ? { note } : { error: 'Missing' };
    status = note ? 200 : 404;
  }
  if (url.pathname === '/api/notes/read-batch') {
    const payload = JSON.parse(request.postData());
    reads.push(...payload.paths);
    body = { notes: payload.paths.map(file => remoteNotes.find(n => n.path === file)).filter(Boolean) };
  }
  if (url.pathname === '/api/notes/commit') {
    const payload = JSON.parse(request.postData());
    if (failCommit || payload.revision !== String(rev)) {
      status = 409;
      body = { error: 'Remote revision changed. Retry Commit.' };
    } else {
      commits.push(payload);
      for (const note of payload.notes) {
        const previous = remoteNotes.find(n => n.path === note.path) || makeNote(note.path.split('/').pop().slice(0, -3));
        remoteNotes = remoteNotes.filter(n => n.path !== note.path);
        remoteNotes.push({ ...previous, ...note, status: note.metadata.status });
      }
      bump();
      body = { revision: String(rev), commit: { commitHash: String(rev) } };
    }
  }
  if (url.pathname === '/api/auth/session') body = { authenticated: true, login: 'fixture', configured: true };
  if (url.pathname === '/api/folders') body = { folders: [] };
  if (url.pathname === '/api/assets') body = { assets: [] };
  if (url.pathname === '/api/git/status') body = { status: { branch: 'main', isClean: true, staged: [], modified: [], untracked: [] }, commits: [] };
  if (body) void request.respond({ status, contentType: 'application/json', body: JSON.stringify(body) });
  else void request.continue();
});
const pending = () => page.evaluate(() => JSON.parse(localStorage.getItem('gh_notes_working:github:working/fixture@main:main') || '{}'));
const open = async (name) => {
  await page.goto(base + `/notebooks/example/notes/${name}.md`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('[aria-label="Close note"]');
  await click('Source');
};
const edit = async (text) => {
  await replace('textarea[aria-label="Note content"]', text);
  await page.waitForFunction(() => document.body.innerText.includes('Saved locally'));
};
const close = () => page.click('[aria-label="Close note"]');
// Pending changes are committed from the right-panel Changes tool.
const changes = async () => {
  const tab = await page.waitForSelector('.right-panel-rail button[aria-label="Changes"]');
  if (await tab.evaluate(e => e.getAttribute('aria-selected') !== 'true')) await tab.click();
  await page.waitForSelector('.changes-tool');
};
const openCommit = async () => {
  await changes();
  await click('Manage changes');
  await page.waitForSelector('.changes-dialog');
};
const submit = () => click('Commit to remote repository');
const closed = () => page.waitForFunction(() => !document.querySelector('.changes-dialog'));
const _commit = async () => {
  await openCommit();
  await submit();
  await closed();
};
try {
  await open('welcome');
  assert(lookups.includes('notes/example/welcome.md'), 'Read lost configured path');
  await edit('# welcome\n\nLocal first\n\nLast line\n');
  await close();
  assert(commits.length === 0, 'Editing committed');
  await open('welcome');
  assert((await page.$eval('textarea[aria-label="Note content"]', e => e.value)).includes('Local first'), 'Reload lost local save');
  await close();
  await open('second');
  await edit('# second\n\nOther local\n\nLast line\n');
  await close();
  await changes();
  await page.click('[aria-label="Commit notes/example/second.md"]');
  await click('Commit selected (1)');
  await closed();
  assert(commits.length === 1 && commits[0].notes.map(note => note.path).join() === 'notes/example/second.md', 'Selection did not isolate one commit');
  assert(Object.keys(await pending()).join() === 'notes/example/welcome.md', 'Unselected draft lost');
  failCommit = true;
  await openCommit();
  await submit();
  await page.waitForSelector('[role="alert"]');
  assert(Object.keys(await pending()).length === 1, 'Failed commit cleared drafts');
  failCommit = false;
  await submit();
  await closed();
  assert(commits.length === 2 && Object.keys(await pending()).length === 0, 'Retry did not clear committed drafts');
  console.log('PASS exact read path, local save/reload, explicit partial commit and failed commit retention');

  await open('welcome');
  await edit('# welcome\n\nLocal second\n\nLast line\n');
  await close();
  remoteNotes = remoteNotes.map(n => n.path.endsWith('/welcome.md') ? { ...n, content: n.content.replace('Last line', 'Remote last') } : n);
  bump();
  await openCommit();
  await submit();
  await page.waitForFunction(() => document.body.innerText.includes('Review the updated diff'));
  assert(commits.length === 2, 'Merge review committed immediately');
  const merged = (await pending())['notes/example/welcome.md'];
  assert(merged.note.content.includes('Local second') && merged.note.content.includes('Remote last'), 'Nonoverlap merge dropped text');
  await submit();
  await closed();
  await open('welcome');
  await edit('# welcome\n\nConflict local\n\nRemote last\n');
  await close();
  remoteNotes = remoteNotes.map(n => n.path.endsWith('/welcome.md') ? { ...n, content: n.content.replace('Local second', 'Conflict remote') } : n);
  bump();
  await openCommit();
  await submit();
  await page.waitForFunction(() => document.body.innerText.includes('Remote changes conflict'));
  assert(commits.length === 3 && (await pending())['notes/example/welcome.md'].blocked, 'Conflict failed to block commit');
  await page.evaluate(() => document.querySelector('.changes-file')?.click());
  fs.mkdirSync(path.join(product, 'artifacts/qa'), { recursive: true });
  await page.screenshot({ path: product + '/artifacts/qa/changes-dialog.png' });
  await page.click('.changes-dialog .workspace-dialog-heading [aria-label="Close"]');
  await closed();
  await open('welcome');
  assert(await page.$eval('textarea[aria-label="Note content"]', e => e.readOnly), 'Conflict editor remained writable');
  await click('Refresh remote version');
  await page.waitForFunction(() => !document.querySelector('textarea[aria-label="Note content"]').readOnly);
  assert((await page.$eval('textarea[aria-label="Note content"]', e => e.value)).includes('Conflict remote'), 'Refresh did not restore remote');
  assert(await page.evaluate(() => Object.keys(localStorage).some(key => key.includes(':conflict:') && localStorage.getItem(key).includes('Conflict local'))), 'Refresh lost conflict backup');
  await close();
  console.log('PASS nonoverlap merge review, conflict commit lock and explicit refresh');

  // Close flushes the draft before the zoomed editor unmounts; the new note must not reuse that editor.
  await page.waitForFunction(() => !document.querySelector('[aria-label="Close note"]'));
  await click('New Note');
  await page.type('input[aria-describedby="create-note-error"]', 'New local');
  await click('Create Note');
  await page.waitForSelector('[aria-label="Close note"]');
  await click('Source');
  await edit('# New local\n\nCreated offline draft\n');
  await close();
  assert(commits.length === 3 && !reads.includes('notes/example/new-local.md'), 'New local note required remote persistence');
  await page.setViewport({ width: 320, height: 700, isMobile: true, hasTouch: true });
  await page.goto(base + '/notebooks/example', { waitUntil: 'networkidle0' });
  await openCommit();
  const rect = await page.$eval('.changes-dialog', e => {
    const r = e.getBoundingClientRect();
    return { x: r.x, right: r.right, bottom: r.bottom };
  });
  assert(rect.x >= 0 && rect.right <= 320 && rect.bottom <= 700, 'Mobile commit dialog overflow');
  await submit();
  await closed();
  assert(commits.length === 4 && commits[3].notes[0].createOnly, 'New note did not commit explicitly');
  console.log('PASS new-note local draft and mobile explicit Commit');
  await page.setViewport({ width: 1440, height: 1000 });
  await open('welcome');
  await page.evaluate(() => {
    window.originalStorageSet = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key, value) {
      if (key.startsWith('gh_notes_working:')) throw Error('Storage full');
      return window.originalStorageSet.call(this, key, value);
    };
  });
  await replace('textarea[aria-label="Note content"]', '# Quota draft');
  await page.waitForFunction(() => document.body.innerText.includes('Local save failed: Storage full'));
  await close();
  assert(await page.$('[aria-label="Close note"]'), 'Failed local save silently closed editor');
  await page.evaluate(() => {
    Storage.prototype.setItem = window.originalStorageSet;
  });
  await close();
  assert((await pending())['notes/example/welcome.md'].note.content === '# Quota draft', 'Retry lost unsaved content');
  console.log('PASS storage failure remains visible and close retries local save');

  // A draft is often blocked because the note vanished from the remote, which is exactly when reading
  // that note fails. Discarding it must stay a local delete, or the draft can never be dismissed.
  await page.evaluate(() => localStorage.removeItem('gh_notes_working:github:working/fixture@main:main'));
  await page.goto(base + '/notebooks/example', { waitUntil: 'networkidle0' });
  await open('welcome');
  await edit('# welcome\n\nDraft about to be orphaned\n\nLast line\n');
  await close();
  remoteNotes = remoteNotes.filter(note => !note.path.endsWith('/welcome.md'));
  bump();
  await openCommit();
  await submit();
  await page.waitForFunction(() => document.querySelector('.changes-error'));
  await page.click('.changes-dialog .workspace-dialog-heading [aria-label="Close"]');
  await closed();
  assert((await pending())['notes/example/welcome.md']?.blocked, 'Vanished remote note did not block its draft');
  await changes();
  await page.click('[aria-label="Restore notes/example/welcome.md"]');
  await page.waitForSelector('.changes-dialog');
  assert(
    await page.$$eval('.changes-group', groups => {
      const included = groups.find(group => group.querySelector('h4')?.textContent.includes('Included in commit'));
      return !included?.querySelector('[data-change-path]');
    }),
    'Discarding a draft staged it for commit instead',
  );
  await click('Confirm discard');
  await page.waitForFunction(() => !JSON.parse(localStorage.getItem('gh_notes_working:github:working/fixture@main:main') || '{}')['notes/example/welcome.md']);
  assert(!await page.$('.changes-error'), 'Discard reported an error');
  await page.click('.changes-dialog .workspace-dialog-heading [aria-label="Close"]');
  await closed();
  console.log('PASS a draft blocked by a vanished remote note is discardable without a commit');
  assert(!errors.length, errors.join('; '));
} catch (error) {
  console.log(await page.evaluate(() => ({ url: location.href, text: document.body.innerText.slice(-3000) })));
  throw error;
} finally {
  await browser.close();
  await new Promise(r => server.close(r));
  fs.rmSync(root, { recursive: true, force: true });
}
