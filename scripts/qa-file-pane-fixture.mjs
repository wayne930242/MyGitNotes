import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createQaWorkspace, product, startQaServer } from './lib/qa-harness.mjs';
import { assertFreshBuild } from './lib/require-fresh-build.mjs';

// Browser-neutral bootstrap: run under MonitorCreate, then use the printed loopback URL.
// Never accepts a workspace path; all writes and destructive QA stay in this disposable repo.
assertFreshBuild(product);
const { SUPPORTED_SCHEMA_VERSION, WORKSPACE_CONFIG_FILENAME, loadWorkspaceConfig } = await import(`${product}/packages/core/dist/index.js`);
const { root, write, commitFixture } = createQaWorkspace('mygitnotes-file-pane-');
let server;
try {
  write(WORKSPACE_CONFIG_FILENAME, `schema_version: ${SUPPORTED_SCHEMA_VERSION}\nworkspace:\n  title: File Pane QA\n  default_notebook: a\nnotebooks:\n  - id: a\n    title: Notebook A\n    root: notes/a\n  - id: b\n    title: Notebook B\n    root: notes/b\n`);
  write('notes/a/one/_dir.yml', 'title: One\n');
  write('notes/a/one/nested/_dir.yml', 'title: Nested\n');
  write('notes/a/one/nested/note.md', '---\ntitle: Nested note\n---\n# Nested note\n\nEdit this disposable note.\n');
  write('notes/a/one/nested/.hidden.txt', 'Hidden fixture content\n');
  write('notes/a/one/nested/config.json', '{"original":true}\n');
  write('notes/a/one/nested/image.png', Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6nS8AAAAASUVORK5CYII=', 'base64'));
  write('notes/a/two/_dir.yml', 'title: Destination\ncustom: preserve\n');
  write('notes/a/two/other.md', '# Destination note\n');
  write('notes/a/doomed/_dir.yml', 'title: Doomed\n');
  write('notes/a/doomed/child/note.md', '# Delete only this fixture\n');
  write('notes/a/doomed/child/.hidden', 'Delete only this fixture\n');
  write('notes/b/other.md', '# Other notebook, untouched\n');
  commitFixture();
  assert.equal(loadWorkspaceConfig(root).schema_version, SUPPORTED_SCHEMA_VERSION);
  const running = await startQaServer(root);
  server = running.server;
  const { base } = running;
  const workspaceResponse = await fetch(`${base}/api/workspace`);
  assert.equal(workspaceResponse.status, 200);
  const workspace = await workspaceResponse.json();
  assert.equal(workspace.config.schema_version, SUPPORTED_SCHEMA_VERSION);
  assert.equal(workspace.local, true);
  assert(workspace.repositories.every(repository => repository.write && repository.branch === 'main'));
  const filesResponse = await fetch(`${base}/api/files?notebookId=a`);
  assert.equal(filesResponse.status, 200);
  const files = await filesResponse.json();
  assert.equal(files.writable, true);
  assert(files.entries.some(entry => entry.path === 'notes/a/one/nested/note.md'));
  const page = await fetch(`${base}/notebooks/a`);
  assert.equal(page.status, 200);
  assert((await page.text()).includes('<div id="root">'));
  console.log(JSON.stringify({ ready: true, pid: process.pid, port: server.address().port, root, base, schema: SUPPORTED_SCHEMA_VERSION, route: `${base}/notebooks/a?folders=notes%2Fa%2Fone%2Fnested`, preflight: 'workspace main/write, files catalog and built UI HTTP passed' }));
  if (!process.argv.includes('--smoke')) {
    await new Promise(resolve => {
      process.once('SIGTERM', resolve);
      process.once('SIGINT', resolve);
    });
  }
} finally {
  if (server) {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
  fs.rmSync(root, { recursive: true, force: true });
  console.log(JSON.stringify({ stopped: true, pid: process.pid, removed: root }));
}
