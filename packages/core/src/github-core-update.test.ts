import { describe, expect, it } from 'vitest';
import sodium from 'libsodium-wrappers';
import { CORE_SYNC_WORKFLOW, GitHubCoreUpdate } from './github-core-update.js';
await sodium.ready;
const old = 'a'.repeat(40), latest = 'b'.repeat(40);
const requestId = `00000000-0000-4000-8000-000000000000-${latest}`;
const pair = sodium.crypto_box_keypair();
function fixture(options: { ahead?: number; behind?: number; push?: boolean; scopes?: string | null; workflow?: boolean; comparisonStatus?: number; runningStatus?: number; dispatchStatus?: number; secretStatus?: number; runStatus?: string; conclusion?: string; failedStep?: string; currentSha?: string; localComparisonStatus?: number; } = {}) {
  const calls: { url: string; init?: RequestInit; }[] = [];
  const request = async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    let body: unknown, status = 200;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (url.endsWith('/repos/user/notes')) {
      body = { fork: false, default_branch: 'main', permissions: { push: options.push ?? true } };
      if (options.scopes !== null) headers['X-OAuth-Scopes'] = options.scopes ?? 'repo, workflow';
    } else if (url.endsWith('/repos/wayne930242/MyGitNotes/git/ref/heads/core')) body = { object: { sha: latest } };
    else if (url.endsWith('/repos/user/notes/git/ref/heads/core')) body = { object: { sha: options.currentSha ?? old } };
    else if (url.includes('/commits/')) {
      body = { sha: old };
      status = options.runningStatus ?? 200;
    } else if (url.includes('/repos/user/notes/compare/')) {
      body = { ahead_by: 1, behind_by: 0 };
      status = options.localComparisonStatus ?? 404;
    } else if (url.includes('/compare/')) {
      expect(url).toContain('/repos/wayne930242/MyGitNotes/');
      body = { ahead_by: options.ahead ?? 2, behind_by: options.behind ?? 0 };
      status = options.comparisonStatus ?? 200;
    } else if (url.includes('/contents/')) {
      status = init?.method === 'PUT' ? 201 : options.workflow === false ? 404 : 200;
      body = {};
    } else if (url.endsWith(`/actions/workflows/${CORE_SYNC_WORKFLOW}`)) body = { state: 'active' };
    else if (url.endsWith('/actions/secrets/public-key')) body = { key_id: 'key-1', key: sodium.to_base64(pair.publicKey, sodium.base64_variants.ORIGINAL) };
    else if (url.endsWith('/actions/secrets/MYGITNOTES_CORE_SYNC_TOKEN')) status = options.secretStatus ?? 204;
    else if (url.endsWith('/dispatches')) status = options.dispatchStatus ?? 204;
    else if (url.includes('/runs?')) body = { workflow_runs: options.runStatus === 'missing' ? [] : [{ id: 42, display_title: `MyGitNotes Core sync ${requestId}`, status: options.runStatus ?? 'in_progress', conclusion: options.conclusion }] };
    else if (url.endsWith('/actions/runs/42/jobs?per_page=100')) body = { jobs: [{ steps: [{ name: options.failedStep ?? 'Push Core', conclusion: 'failure' }] }] };
    else throw new Error(`Unexpected request: ${url}`);
    return new Response(status === 204 ? null : JSON.stringify(body || {}), { status, headers });
  };
  return { updater: new GitHubCoreUpdate('user/notes', old.slice(0, 7), 'test-user-grant', request as typeof fetch), calls, request: request as typeof fetch };
}

describe('GitHub Actions Core update', () => {
  it('detects non-fork lag inside upstream and resolves the short running identity without writes', async () => {
    const { updater, calls } = fixture();
    expect(await updater.status()).toMatchObject({ state: 'update_available', current: { sha: old, behind: 2 }, running: { sha: old, behind: 2 }, defaultBranch: 'main' });
    expect(calls.every(call => !call.init?.method)).toBe(true);
  });
  it('retains granted scope metadata when concurrent status checks share a request', async () => {
    const { updater, request } = fixture({ scopes: 'repo' });
    const other = new GitHubCoreUpdate('user/notes', old.slice(0, 7), 'test-user-grant', request);
    const statuses = await Promise.all([updater.status(), other.status()]);
    expect(statuses.map(status => status.state)).toEqual(['reauthorization_required', 'reauthorization_required']);
  });
  it('encrypts the user grant and dispatches once on the default branch without claiming completion', async () => {
    const { updater, calls } = fixture();
    const result = await updater.update();
    expect(result).toMatchObject({ accepted: true, receipt: { targetSha: latest } });
    expect(result).not.toHaveProperty('success');
    const writes = calls.filter(call => call.init?.method);
    expect(writes).toHaveLength(2);
    const secret = JSON.parse(String(writes[0].init!.body));
    expect(secret).not.toHaveProperty('token');
    expect(sodium.to_string(sodium.crypto_box_seal_open(sodium.from_base64(secret.encrypted_value, sodium.base64_variants.ORIGINAL), pair.publicKey, pair.privateKey))).toBe('test-user-grant');
    expect(writes[1].url).toContain(`/actions/workflows/${CORE_SYNC_WORKFLOW}/dispatches`);
    expect(JSON.parse(String(writes[1].init!.body))).toEqual({ ref: 'main', inputs: { request_id: result.receipt!.requestId, target_sha: latest } });
  });
  it('installs one missing workflow without overwriting existing files', async () => {
    const missing = fixture({ workflow: false });
    expect(await missing.updater.install()).toEqual({ installed: true });
    const write = missing.calls.find(call => call.init?.method === 'PUT')!;
    const body = JSON.parse(String(write.init!.body));
    expect(body.branch).toBe('main');
    expect(body).not.toHaveProperty('sha');
    expect(Buffer.from(body.content, 'base64').toString()).toContain('MYGITNOTES_CORE_SYNC_TOKEN');
    const existing = fixture();
    expect(await existing.updater.install()).toEqual({ installed: false });
    expect(existing.calls.every(call => !call.init?.method)).toBe(true);
  });
  it.each([[{ push: false }, 'permission_required', 'PERMISSION_REQUIRED'], [{ scopes: 'repo' }, 'reauthorization_required', 'REAUTHORIZATION_REQUIRED'], [{ workflow: false }, 'workflow_missing', 'WORKFLOW_MISSING'], [{ behind: 1 }, 'diverged', 'CORE_DIVERGED']] as const)('reports %s before any write', async (options, state, code) => {
    const { updater, calls } = fixture(options);
    expect((await updater.status()).state).toBe(state);
    await expect(updater.update()).rejects.toMatchObject({ code });
    expect(calls.every(call => !call.init?.method)).toBe(true);
  });
  it('leaves unresolved user ancestry for definitive runner verification', async () => {
    expect(await fixture({ comparisonStatus: 404 }).updater.status()).toMatchObject({ state: 'ancestry_unknown', canUpdate: true, current: null });
  });
  it('keeps unknown build identity separate from repository lag', async () => {
    expect(await fixture({ runningStatus: 404 }).updater.status()).toMatchObject({ state: 'update_available', running: null });
  });
  it('does not turn comparison service errors into unknown ancestry', async () => {
    await expect(fixture({ comparisonStatus: 500 }).updater.status()).rejects.toMatchObject({ status: 500 });
  });
  it('distinguishes secret write denial from workflow dispatch denial', async () => {
    await expect(fixture({ secretStatus: 403 }).updater.update()).rejects.toMatchObject({ code: 'SECRET_PERMISSION_REQUIRED' });
    await expect(fixture({ dispatchStatus: 403 }).updater.update()).rejects.toMatchObject({ code: 'WORKFLOW_PERMISSION_REQUIRED' });
  });
  it('does not hide rate limits as permissions', async () => {
    await expect(fixture({ secretStatus: 429 }).updater.update()).rejects.toMatchObject({ status: 429 });
  });
  it.each([['missing', 'pending'], ['in_progress', 'running']])('follows %s without success', async (runStatus, state) => {
    expect(await fixture({ runStatus }).updater.follow(requestId)).toMatchObject({ state, targetSha: latest });
  });
  it('verifies the target branch after a successful workflow run', async () => {
    expect(await fixture({ runStatus: 'completed', conclusion: 'success', currentSha: latest }).updater.follow(requestId)).toMatchObject({ state: 'succeeded', currentSha: latest, url: 'https://github.com/user/notes/actions/runs/42' });
    expect(await fixture({ runStatus: 'completed', conclusion: 'success' }).updater.follow(requestId)).toMatchObject({ state: 'update_unconfirmed' });
  });
  it.each([['Check Core ancestry', 'diverged'], ['Check workflow permission', 'workflow_permission_required'], ['Push Core', 'run_failed']])('maps failed %s distinctly', async (failedStep, state) => {
    expect(await fixture({ runStatus: 'completed', conclusion: 'failure', failedStep }).updater.follow(requestId)).toMatchObject({ state });
  });
  it('does not mislabel an already-ahead Core as divergent after runner ancestry rejection', async () => {
    expect(await fixture({ runStatus: 'completed', conclusion: 'failure', failedStep: 'Check Core ancestry', localComparisonStatus: 200 }).updater.follow(requestId)).toMatchObject({ state: 'already_current' });
  });
  it('rejects invalid polling identifiers', async () => {
    await expect(fixture().updater.follow('../other')).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  });
  it('does not dispatch an already-current repository', async () => {
    const { updater, calls } = fixture({ ahead: 0 });
    expect(await updater.update()).toEqual({ alreadyUpToDate: true });
    expect(calls.every(call => !call.init?.method)).toBe(true);
  });
});
