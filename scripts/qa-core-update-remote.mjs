import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import { assertFreshBuild } from './lib/require-fresh-build.mjs';
import { CORE_SYNC_WORKFLOW, githubCoreComparison, githubCoreState, GitHubCoreUpdate } from '../packages/core/dist/index.js';

assertFreshBuild(fileURLToPath(new URL('..', import.meta.url)));
const repository = 'wayne930242/knowledge-base', upstream = 'wayne930242/MyGitNotes';
const apply = process.argv.includes('--apply-authorized-sync');
const allowedSha = '1a5a6b9ab9893d161919f0a057c5340b49361ead';
let dispatches = 0, installs = 0, secrets = 0;
/** gh supplies keyring authentication; request bodies are never logged. */
async function request(input, init = {}) {
  const url = new URL(String(input));
  assert.equal(url.origin, 'https://api.github.com');
  const method = init.method || 'GET';
  const args = ['api', '--include', '--method', method, url.pathname + url.search];
  if (method !== 'GET') {
    assert(apply, 'Mutation requires --apply-authorized-sync');
    const body = JSON.parse(init.body);
    if (url.pathname === `/repos/${repository}/contents/.github/workflows/${CORE_SYNC_WORKFLOW}`) {
      assert.equal(method, 'PUT');
      assert.equal(installs++, 0);
      assert.equal(body.branch, 'main');
      assert.equal(body.sha, undefined);
      assert.equal(Buffer.from(body.content, 'base64').toString(), fs.readFileSync(new URL('../packages/core/assets/mygitnotes-core-sync.yml', import.meta.url), 'utf8'));
    } else if (url.pathname === `/repos/${repository}/actions/secrets/MYGITNOTES_CORE_SYNC_TOKEN`) {
      assert.equal(method, 'PUT');
      assert.equal(secrets++, 0);
      assert.deepEqual(Object.keys(body).sort(), ['encrypted_value', 'key_id']);
    } else {
      assert.equal(url.pathname, `/repos/${repository}/actions/workflows/${CORE_SYNC_WORKFLOW}/dispatches`);
      assert.equal(method, 'POST');
      assert.equal(dispatches++, 0, 'The authorized sync is dispatched once');
      assert.equal(body.ref, 'main');
      assert.equal(body.inputs.target_sha, allowedSha);
    }
    args.push('--input', '-');
  }
  const result = spawnSync('gh', args, { input: init.body, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024, timeout: 30000 });
  if (result.error) throw result.error;
  const boundary = result.stdout.search(/\r?\n\r?\n/);
  assert(boundary >= 0, 'gh must return HTTP headers');
  const header = result.stdout.slice(0, boundary);
  const body = result.stdout.slice(boundary).replace(/^\r?\n\r?\n/, '');
  const status = Number(header.match(/^HTTP\/\S+ (\d+)/)?.[1]);
  const headers = Object.fromEntries(
    header.split(/\r?\n/).slice(1).map(line => {
      const at = line.indexOf(':');
      return [line.slice(0, at), line.slice(at + 1).trim()];
    }),
  );
  return new Response(status === 204 ? null : body, { status, headers });
}
const json = async endpoint => {
  const response = await request(`https://api.github.com${endpoint}`);
  assert(response.ok, `Read-only API request failed: ${endpoint} (${response.status})`);
  return response.json();
};
// The explicit verification authorization permits this credential in memory only.
let credential = 'gh-keyring-transport';
if (apply) {
  const auth = spawnSync('gh', ['auth', 'token'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  assert.equal(auth.status, 0, 'gh authentication unavailable');
  credential = auth.stdout.trim();
}
const updater = new GitHubCoreUpdate(repository, allowedSha.slice(0, 7), credential, request);
const before = await updater.status();
console.log(JSON.stringify({ event: 'before', repository, status: before }));
let result = null, run = null, after = null;
if (apply) {
  const current = await json(`/repos/${repository}/git/ref/heads/core`);
  assert(current.object.sha.startsWith('dadd573e'), 'Authorized starting revision changed; stop before mutation');
  assert.equal(before.upstreamSha, allowedSha);
  assert.equal(before.current.ahead, 0);
  assert.equal(before.current.behind, 2);
  console.log(JSON.stringify({ event: 'installation', result: await updater.install() }));
  for (let attempt = 0; attempt < 15; attempt++) {
    if ((await updater.status()).state !== 'workflow_missing') break;
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  result = await updater.update();
  assert.equal(result.accepted, true);
  console.log(JSON.stringify({ event: 'dispatched', receipt: result.receipt }));
  for (let attempt = 0; attempt < 200; attempt++) {
    run = await updater.follow(result.receipt.requestId);
    if (!['pending', 'running'].includes(run.state)) break;
    if (attempt % 10 === 0) console.log(JSON.stringify({ event: 'following', run }));
    await new Promise(resolve => setTimeout(resolve, 3000));
  }
  console.log(JSON.stringify({ event: 'conclusion', run }));
  assert.equal(run.state, 'succeeded');
  assert.equal(run.currentSha, allowedSha);
  assert.equal(dispatches, 1);
  after = await updater.status();
}
const divergent = await json('/repos/microsoft/vscode/compare/main...release%2F1.100?per_page=1');
assert.equal(divergent.status, 'diverged');
const divergentState = githubCoreState(githubCoreComparison(divergent.base_commit.sha, divergent), true);
assert.equal(divergentState, 'diverged');
const permissions = await json('/repos/microsoft/vscode');
assert.equal(permissions.permissions.push, false);
const head = await json('/repos/microsoft/vscode/commits/main');
const lag = await json(`/repos/microsoft/vscode/compare/${head.parents[0].sha}...${head.sha}?per_page=1`);
const deniedState = githubCoreState(githubCoreComparison(head.parents[0].sha, lag), permissions.permissions.push);
assert.equal(deniedState, 'permission_required');
console.log(JSON.stringify({ event: 'evidence', repository, upstream, mutations: { installs, secrets, dispatches }, before, after, result, run, divergence: { evidence: 'real read-only API response mapped through production comparison/state functions', repository: 'microsoft/vscode', refs: 'main...release/1.100', status: divergent.status, ahead_by: divergent.ahead_by, behind_by: divergent.behind_by, mappedState: divergentState }, missingPermission: { evidence: 'real read-only repository permissions and ancestor comparison; no denied write attempted', repository: permissions.full_name, permissions: permissions.permissions, base: head.parents[0].sha, head: head.sha, ahead_by: lag.ahead_by, behind_by: lag.behind_by, mappedState: deniedState } }));
