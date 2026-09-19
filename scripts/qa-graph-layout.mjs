import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { resolveQaChromePath } from './qa-chrome.mjs';

const product = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(`${product}/apps/web/package.json`);
const puppeteer = require('puppeteer-core'), { stringify, parse } = require('yaml');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'notes-layout-'));
const output = path.join(product, 'artifacts/qa');
fs.mkdirSync(output, { recursive: true });
const write = (name, content) => {
  fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
  fs.writeFileSync(path.join(root, name), content);
};
const nodes = Array.from({ length: 8 }, (_, i) => ({ path: `notes/a/${i}.md`, x: (i % 2) * 800, y: Math.floor(i / 2) * 300, pinned: i === 0 }));
const edges = [0, 4].flatMap(start => Array.from({ length: 4 }, (_, i) => Array.from({ length: i }, (_, j) => [start + i, start + j])).flat());
edges.push([3, 4]);
write('.github-notes.yaml', stringify({ schema_version: 1, workspace: { title: '群聚佈局驗證', default_notebook: 'a' }, notebooks: [{ id: 'a', title: '研究', root: 'notes/a' }] }));
for (let i = 0; i < nodes.length; i++) write(nodes[i].path, `---\ntitle: ${i < 4 ? '哲學' : '劇本'} ${i}\n---\n${edges.filter(([a]) => a === i).map(([, b]) => `[筆記 ${b}](${b}.md)`).join('\n')}\n`);
write('.github-notes-screen.yaml', stringify({ version: 1, rows: [{ id: 'layout', name: '群聚佈局', kind: 'custom', view: 'graph', items: nodes.map((n, i) => ({ id: `n${i}`, kind: 'note', path: n.path, notebookId: 'a' })), graph: { nodes } }] }));
for (const args of [['init', '-b', 'main'], ['config', 'user.name', 'Graph QA'], ['config', 'user.email', 'qa@example.com'], ['add', '.'], ['commit', '-m', 'fixture']]) execFileSync('git', args, { cwd: root, stdio: 'pipe' });
process.env.MYGITNOTES_SOURCE = 'local';
process.env.MYGITNOTES_LOCAL_PATH = root;
delete process.env.VERCEL;
delete process.env.APP_URL;
const { createApp } = await import(`${product}/apps/local-server/dist/app.js`);
const server = createServer(createApp(product));
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await puppeteer.launch({ executablePath: resolveQaChromePath('GRAPH_QA_CHROME'), headless: true, pipe: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage(), errors = [];
page.on('pageerror', error => errors.push(error.message));
await page.evaluateOnNewDocument(() => localStorage.setItem('github-notes:language', 'en'));
await page.setViewport({ width: 1500, height: 1050 });
const read = () => parse(fs.readFileSync(path.join(root, '.github-notes-screen.yaml'), 'utf8')).rows[0].graph.nodes;
function metrics(layout) {
  const ordered = nodes.map(n => layout.find(item => item.path === n.path));
  const turn = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  let crossings = 0;
  for (let i = 0; i < edges.length; i++) {
    for (let j = i + 1; j < edges.length; j++) {
      const [ai, bi] = edges[i], [ci, di] = edges[j];
      if (new Set([ai, bi, ci, di]).size < 4) continue;
      const [a, b, c, d] = [ai, bi, ci, di].map(k => ordered[k]);
      if (turn(a, b, c) * turn(a, b, d) < 0 && turn(c, d, a) * turn(c, d, b) < 0) crossings++;
    }
  }
  const meanWithinGroup = edges.slice(0, -1).reduce((sum, [a, b]) => sum + Math.hypot(ordered[a].x - ordered[b].x, ordered[a].y - ordered[b].y), 0) / (edges.length - 1);
  return { crossings, meanWithinGroup };
}
try {
  await page.goto(base + '/graph?notebook=all&lanes=layout', { waitUntil: 'networkidle0' });
  await page.waitForSelector('[data-graph-nodes="8"]');
  await page.screenshot({ path: `${output}/graph-layout-before.png` });
  const start = performance.now();
  await page.click('button[aria-label="Arrange notes"]');
  const elapsedMs = performance.now() - start;
  await page.click('button[aria-label="Choose or edit a swimlane"]');
  const saved = page.waitForResponse(response => response.url().endsWith('/api/screen-page') && response.request().method() === 'PUT');
  await page.click('.graph-save-lane');
  await saved;
  const arranged = read(), before = metrics(nodes), after = metrics(arranged);
  assert(after.crossings < before.crossings, JSON.stringify({ before, after }));
  assert(after.meanWithinGroup < before.meanWithinGroup * .6);
  assert.equal(arranged.find(n => n.path === nodes[0].path).x, nodes[0].x);
  assert.equal(arranged.find(n => n.path === nodes[0].path).y, nodes[0].y);
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForSelector('[data-graph-nodes="8"]');
  assert.deepEqual(read(), arranged);
  await page.screenshot({ path: `${output}/graph-layout-after.png` });
  // Enter the full graph without saved geometry. Save twice without arranging:
  // initial positions must already form clusters and must not drift over time.
  await page.goto(base + '/graph?notebook=all', { waitUntil: 'networkidle0' });
  await page.waitForSelector('[data-graph-nodes="8"]');
  await page.click('button[aria-label="Select notes (0)"]');
  for (const checkbox of await page.$$('.graph-note-selector input')) await checkbox.click();
  await page.click('button[aria-label="Select notes (8)"]');
  const saveInitial = async name => {
    await page.click('button[aria-label="Save as lane"]');
    await page.waitForSelector('dialog[open]');
    await page.type('input[aria-label="Swimlane name"]', name);
    await page.$$eval('dialog[open] button', buttons => buttons.find(button => button.textContent.trim() === 'Save as lane').click());
    for (let attempt = 0; attempt < 80; attempt++) {
      const row = parse(fs.readFileSync(path.join(root, '.github-notes-screen.yaml'), 'utf8')).rows.find(row => row.name === name);
      if (row) return row.graph.nodes;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw Error('Initial layout was not saved');
  };
  const initial = await saveInitial('首次排列');
  assert(metrics(initial).meanWithinGroup < 200);
  await new Promise(resolve => setTimeout(resolve, 1200));
  assert.deepEqual(await saveInitial('穩定排列'), initial);
  await page.screenshot({ path: `${output}/graph-layout-initial.png` });
  assert.deepEqual(errors, []);
  const result = { before, after, initial: metrics(initial), elapsedMs, errors, root };
  fs.writeFileSync(`${output}/graph-layout-result.json`, JSON.stringify(result, null, 2));
  console.log('PASS', JSON.stringify(result));
} catch (error) {
  await page.screenshot({ path: `${output}/graph-layout-failure.png` });
  throw error;
} finally {
  await browser.close();
  server.close();
}
