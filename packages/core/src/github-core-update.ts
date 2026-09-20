import { CORE_SYNC_WORKFLOW, coreSyncWorkflow, provisionCoreSyncSecret } from './core-sync-workflow.js';
import { randomUUID } from 'node:crypto';
import { GitHubApi, SourceError } from './github-api.js';
import { type CoreComparison, coreComparisonState, type CoreStatus, type CoreUpdateReceipt, type CoreUpdateRun } from './core-status.js';

export { CORE_SYNC_WORKFLOW } from './core-sync-workflow.js';
export const CORE_UPSTREAM_REPOSITORY = 'wayne930242/MyGitNotes';
export class RemoteCoreError extends SourceError {
  constructor(message: string, public code: string, status: number) {
    super(message, status);
  }
}
const commitSha = (value: unknown): string => {
  if (typeof value !== 'string' || !/^[a-f0-9]{40}$/i.test(value)) throw new RemoteCoreError('GitHub returned an invalid commit identity.', 'INVALID_RESPONSE', 502);
  return value;
};
export function githubCoreComparison(sha: string, comparison: { ahead_by: number; behind_by: number; }): CoreComparison {
  if (![comparison.ahead_by, comparison.behind_by].every(value => Number.isSafeInteger(value) && value >= 0)) throw new RemoteCoreError('GitHub returned invalid comparison counts.', 'INVALID_RESPONSE', 502);
  return { sha, ahead: comparison.behind_by, behind: comparison.ahead_by };
}
export function githubCoreState(current: CoreComparison, canWrite: boolean): CoreStatus['state'] {
  const relation = coreComparisonState(current);
  return relation === 'update_available' && !canWrite ? 'permission_required' : relation;
}

/** The hosting API dispatches a runner that transfers Git objects and enforces fast-forward-only. */
export class GitHubCoreUpdate {
  private api: GitHubApi;
  private upstream: GitHubApi;
  constructor(private repository: string, private runningBuild: string, private token?: string, request: typeof fetch = fetch) {
    this.api = new GitHubApi(repository, token, request);
    this.upstream = new GitHubApi(CORE_UPSTREAM_REPOSITORY, token, request);
  }
  private async compare(sha: string, upstreamSha: string): Promise<CoreComparison> {
    return githubCoreComparison(sha, await this.upstream.json(`/compare/${sha}...${upstreamSha}?per_page=1`, {}, true));
  }
  async status(): Promise<CoreStatus> {
    const info = await this.api.json('', {}, true);
    const scopes = this.api.oauthScopes;
    const upstreamSha = commitSha((await this.upstream.json('/git/ref/heads/core', {}, true)).object?.sha);
    const currentSha = commitSha((await this.api.json('/git/ref/heads/core', {}, true)).object?.sha);
    let current: CoreComparison | null = null;
    try {
      current = await this.compare(currentSha, upstreamSha);
    } catch (error) {
      if (!(error instanceof SourceError && [404, 409].includes(error.status))) throw error;
    }
    let running: CoreComparison | null = null;
    if (/^[a-f0-9]{7,40}$/i.test(this.runningBuild)) {
      try {
        const sha = commitSha((await this.upstream.json(`/commits/${this.runningBuild}`, {}, true)).sha);
        running = await this.compare(sha, upstreamSha);
      } catch (error) {
        if (!(error instanceof SourceError && [404, 409].includes(error.status))) throw error;
      }
    }
    let state: CoreStatus['state'] = current ? githubCoreState(current, Boolean(this.token && info.permissions?.push)) : 'ancestry_unknown';
    if (['update_available', 'ancestry_unknown'].includes(state)) {
      if (!this.token || !info.permissions?.push) state = 'permission_required';
      else if (scopes && !scopes.includes('workflow')) state = 'reauthorization_required';
      else {
        try {
          await this.api.json(`/contents/.github/workflows/${CORE_SYNC_WORKFLOW}?ref=${encodeURIComponent(info.default_branch)}`, {}, true);
          const workflow = await this.api.json(`/actions/workflows/${CORE_SYNC_WORKFLOW}`, {}, true);
          if (workflow.state !== 'active') state = 'workflow_missing';
        } catch (error) {
          if (error instanceof SourceError && error.status === 404) state = 'workflow_missing';
          else if (error instanceof SourceError && error.status === 403) state = 'workflow_permission_required';
          else throw error;
        }
      }
    }
    return { state, canUpdate: ['update_available', 'ancestry_unknown'].includes(state), current, upstreamSha, upstream: `${CORE_UPSTREAM_REPOSITORY}/core`, running, runningBuild: this.runningBuild, defaultBranch: info.default_branch };
  }
  async install(): Promise<{ installed: boolean; }> {
    const info = await this.api.json('', {}, true);
    if (!this.token || !info.permissions?.push) throw new RemoteCoreError('Repository write access is required.', 'PERMISSION_REQUIRED', 403);
    if (this.api.oauthScopes && !this.api.oauthScopes.includes('workflow')) throw new RemoteCoreError('Re-authorize GitHub to add workflow access.', 'REAUTHORIZATION_REQUIRED', 403);
    const endpoint = `/contents/.github/workflows/${CORE_SYNC_WORKFLOW}`;
    try {
      await this.api.json(`${endpoint}?ref=${encodeURIComponent(info.default_branch)}`, {}, true);
      return { installed: false };
    } catch (error) {
      if (!(error instanceof SourceError && error.status === 404)) throw error;
    }
    try {
      await this.api.json(endpoint, { method: 'PUT', body: JSON.stringify({ branch: info.default_branch, message: 'chore: install MyGitNotes Core sync workflow', content: Buffer.from(coreSyncWorkflow()).toString('base64') }) }, true);
    } catch (error) {
      if (error instanceof SourceError && error.status === 403) throw new RemoteCoreError('Authorize Workflows: write access to install Core sync.', 'WORKFLOW_PERMISSION_REQUIRED', 403);
      throw error;
    }
    return { installed: true };
  }
  async update(): Promise<{ alreadyUpToDate?: boolean; accepted?: boolean; receipt?: CoreUpdateReceipt; }> {
    const status = await this.status();
    if (status.state === 'permission_required') throw new RemoteCoreError('Authorize repository write access and sign in again.', 'PERMISSION_REQUIRED', 403);
    if (status.state === 'reauthorization_required') throw new RemoteCoreError('This grant predates Core updates. Re-authorize GitHub to add workflow access.', 'REAUTHORIZATION_REQUIRED', 403);
    if (status.state === 'workflow_permission_required') throw new RemoteCoreError('Authorize Actions: write access (classic token: repo and workflow), then sign in again.', 'WORKFLOW_PERMISSION_REQUIRED', 403);
    if (status.state === 'workflow_missing') throw new RemoteCoreError(`Install ${CORE_SYNC_WORKFLOW} on the repository default branch.`, 'WORKFLOW_MISSING', 422);
    if (status.state === 'diverged') throw new RemoteCoreError('Core and upstream have diverged. Move product changes to another branch before updating.', 'CORE_DIVERGED', 409);
    if (!status.canUpdate) return { alreadyUpToDate: true };
    try {
      await provisionCoreSyncSecret(this.api, this.token!);
    } catch (error) {
      if (error instanceof SourceError && [403, 404].includes(error.status)) throw new RemoteCoreError('Allow repository Actions secrets write access to provision the sync credential.', 'SECRET_PERMISSION_REQUIRED', 403);
      throw error;
    }
    const receipt = { requestId: `${randomUUID()}-${status.upstreamSha}`, targetSha: status.upstreamSha! };
    try {
      await this.api.json(`/actions/workflows/${CORE_SYNC_WORKFLOW}/dispatches`, { method: 'POST', body: JSON.stringify({ ref: status.defaultBranch, inputs: { request_id: receipt.requestId, target_sha: receipt.targetSha } }) }, true);
    } catch (error) {
      if (error instanceof SourceError && error.status === 403) throw new RemoteCoreError('Authorize Actions: write access (classic token: repo and workflow), then sign in again.', 'WORKFLOW_PERMISSION_REQUIRED', 403);
      throw error;
    }
    return { accepted: true, receipt };
  }
  async follow(requestId: string): Promise<CoreUpdateRun> {
    if (!/^[a-f0-9-]{36}-[a-f0-9]{40}$/.test(requestId)) throw new RemoteCoreError('Invalid Core update request.', 'INVALID_REQUEST', 400);
    const targetSha = requestId.slice(-40);
    const runs = await this.api.json(`/actions/workflows/${CORE_SYNC_WORKFLOW}/runs?event=workflow_dispatch&per_page=100`, {}, true);
    const run = runs.workflow_runs?.find((run: { display_title: string; }) => run.display_title === `MyGitNotes Core sync ${requestId}`);
    if (!run) return { state: 'pending', targetSha };
    const url = `https://github.com/${this.repository}/actions/runs/${run.id}`;
    if (run.status !== 'completed') return { state: 'running', targetSha, url };
    if (run.conclusion !== 'success') {
      const jobs = await this.api.json(`/actions/runs/${run.id}/jobs?per_page=100`, {}, true);
      const failed = jobs.jobs.flatMap((job: { steps: { name: string; conclusion: string; }[]; }) => job.steps || []).filter((step: { conclusion: string; }) => step.conclusion === 'failure');
      if (failed.some((step: { name: string; }) => step.name === 'Check Core ancestry')) {
        const currentSha = commitSha((await this.api.json('/git/ref/heads/core', {}, true)).object?.sha);
        try {
          const relation = await this.api.json(`/compare/${targetSha}...${currentSha}?per_page=1`, {}, true);
          if (githubCoreComparison(targetSha, relation).ahead === 0) return { state: 'already_current', targetSha, currentSha, url };
        } catch (error) {
          if (!(error instanceof SourceError && [404, 409].includes(error.status))) throw error;
        }
      }
      const state = failed.some((step: { name: string; }) => step.name === 'Check Core ancestry') ? 'diverged' : failed.some((step: { name: string; }) => step.name === 'Check workflow permission') ? 'workflow_permission_required' : 'run_failed';
      return { state, targetSha, url };
    }
    const currentSha = commitSha((await this.api.json('/git/ref/heads/core', {}, true)).object?.sha);
    return { state: currentSha === targetSha ? 'succeeded' : 'update_unconfirmed', targetSha, currentSha, url };
  }
}
