import { deploymentConfigSource, deriveAlias, GITHUB_COM, githubSite, parseSourceConfig, repositoryName, repositoryRef, SourceError, type WorkspaceConfigSource, type WorkspaceSite } from '@mygitnotes/core';
import { type Request, type Response, Router } from 'express';
import { authToken, type SessionServices } from './auth.js';
import { choosesRepository, cookieWorkspaceChoices, deploymentGitHubUrl, type WorkspaceChoice, type WorkspaceChoices } from './repository-choice.js';

export { choosesRepository, cookieWorkspaceChoices, readWorkspaceChoice, type WorkspaceChoice, type WorkspaceChoices } from './repository-choice.js';

/**
 * The deployment's configuration source; when it chooses no repository, each request's workspace has one member, the
 * repository its visitor chose, and none before they choose. The workspace's site is the deployment's GitHub site.
 */
export function chosenRepositorySource(base: string, env: NodeJS.ProcessEnv = process.env, choices: WorkspaceChoices = cookieWorkspaceChoices()): WorkspaceConfigSource {
  const deployment = deploymentConfigSource(base, env);
  if (!choosesRepository(env)) return deployment;
  // Visitors' repositories are on the deployment's GitHub site: github.com unless MYGITNOTES_GITHUB_URL names one.
  const url = deploymentGitHubUrl(env);
  const site: WorkspaceSite = { type: 'github', ...(url ? { url } : {}) };
  return {
    mode: 'remote',
    async settings(request) {
      const choice = await choices.read(request);
      const ref = choice && repositoryRef({ type: 'github', ...(url ? { url } : {}), ...choice });
      const members = ref ? [{ ref, alias: deriveAlias(repositoryName(ref.source), new Set()), default: true, hidden: false, editable: 'none' as const }] : [];
      return { site, members, manifest: (_member, inRepository) => inRepository() };
    },
  };
}

/** One repository a visitor may open. */
export interface AvailableRepository {
  fullName: string;
  defaultBranch: string;
  private: boolean;
  updatedAt: string;
}
interface GitHubRepository {
  full_name: string;
  default_branch: string;
  private: boolean;
  updated_at: string;
  permissions?: { push?: boolean; };
}

/** One GitHub API request with the person's token; a body only for a successful answer, and 401 thrown as an expired sign-in. */
export async function github<T>(api: string, token: string, path: string): Promise<{ status: number; body: T | null; }> {
  const response = await fetch(`${api}${path}`, { redirect: 'error', signal: AbortSignal.timeout(15000), headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'MyGitNotes', 'X-GitHub-Api-Version': '2022-11-28' } });
  if (response.status === 401) throw new SourceError('GitHub authorization expired. Sign in again.', 401);
  if (!response.ok) return { status: response.status, body: null };
  return { status: response.status, body: await response.json() as T };
}
/** Follows pages of a list endpoint up to `maxPages` pages of 100. */
async function pages<T>(api: string, token: string, path: string, pick: (body: unknown) => T[], maxPages = 10): Promise<T[]> {
  const items: T[] = [];
  for (let page = 1; page <= maxPages; page++) {
    const { status, body } = await github<unknown>(api, token, `${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`);
    if (!body) throw new SourceError(`GitHub answered ${status} while listing repositories.`, 502);
    const batch = pick(body);
    items.push(...batch);
    if (batch.length < 100) break;
  }
  return items;
}

/** Repositories the signed-in token can write on the GitHub site `url` names (github.com when absent): those granted to the GitHub App, or every repository of an OAuth App token. */
export async function availableRepositories(token: string, githubApp: boolean, url?: string): Promise<AvailableRepository[]> {
  const api = githubSite(url).api;
  let repositories: GitHubRepository[];
  if (githubApp) {
    const installations = await pages(api, token, '/user/installations', body => (body as { installations: { id: number; }[]; }).installations);
    repositories = (await Promise.all(installations.map(installation => pages(api, token, `/user/installations/${installation.id}/repositories`, body => (body as { repositories: GitHubRepository[]; }).repositories)))).flat();
  } else repositories = await pages(api, token, '/user/repos?affiliation=owner,collaborator,organization_member&sort=updated', body => body as GitHubRepository[]);
  const unique = new Map(repositories.filter(repository => repository.permissions?.push !== false).map(repository => [repository.full_name, repository]));
  return [...unique.values()].map(repository => ({ fullName: repository.full_name, defaultBranch: repository.default_branch, private: repository.private, updatedAt: repository.updated_at })).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

const githubApp = () => process.env.GITHUB_APP_TYPE === 'github-app';
const defaultStarter = 'wayne930242/mygitnotes-starter';
/**
 * GitHub's own page for a new private repository from the starter template, prefilled through its documented
 * query parameters; creating it there needs no extra permission for the app. The default starter lives on
 * github.com, so an Enterprise site offers the page only when the deployment names a template on that site.
 */
export function newRepositoryUrl(env: NodeJS.ProcessEnv = process.env): string | null {
  const url = deploymentGitHubUrl(env);
  if (url && !env.MYGITNOTES_STARTER_TEMPLATE) return null;
  const [owner, name] = (env.MYGITNOTES_STARTER_TEMPLATE || defaultStarter).split('/');
  return `${url ?? GITHUB_COM}/new?${new URLSearchParams({ template_owner: owner, template_name: name, name: 'my-notes', visibility: 'private', description: 'My MyGitNotes notes' })}`;
}
const pageSize = 50;

/**
 * Listing repositories, and choosing or forgetting the visitor's repository; mounted ahead of the workspace routes.
 * Without `choices` (an edition that keeps each person's repositories in its membership store) the listing stays for
 * Settings' add flow and choosing answers 404.
 */
export function workspaceChoiceRouter(services: SessionServices & { choices?: WorkspaceChoices; }): Router {
  const router = Router();
  const token = async (req: Request, res: Response) => {
    const url = deploymentGitHubUrl();
    const value = await authToken(req, res, services, { type: 'github', ...(url ? { url } : {}) });
    if (!value) throw new SourceError('Sign in with GitHub first.', 401);
    return value;
  };
  const fail = (res: Response, error: unknown) => res.status(error instanceof SourceError ? error.status : 502).json({ error: error instanceof Error ? error.message : 'Request failed.' });
  router.use('/workspace/choice', (_req, res, next) => !choosesRepository() ? res.status(404).json({ error: 'This deployment serves one configured repository.' }) : !services.choices ? res.status(404).json({ error: 'Add repositories in Settings → Repositories.' }) : next());
  router.use('/repositories/available', (_req, res, next) => choosesRepository() ? next() : res.status(404).json({ error: 'This deployment serves one configured repository.' }));

  router.get('/repositories/available', async (req, res) => {
    try {
      const query = typeof req.query.query === 'string' ? req.query.query.trim().toLowerCase() : '';
      const url = deploymentGitHubUrl();
      const all = await availableRepositories(await token(req, res), githubApp(), url);
      const matching = query ? all.filter(repository => repository.fullName.toLowerCase().includes(query)) : all;
      res.json({ repositories: matching.slice(0, pageSize), total: matching.length, githubApp: githubApp(), installUrl: process.env.GITHUB_APP_SLUG ? githubSite(url).installUrl(process.env.GITHUB_APP_SLUG) : null, newRepositoryUrl: newRepositoryUrl(), current: services.choices ? await services.choices.read(req) : null });
    } catch (error) {
      fail(res, error);
    }
  });
  router.post('/workspace/choice', async (req, res) => {
    try {
      const value = await token(req, res);
      const url = deploymentGitHubUrl(), api = githubSite(url).api;
      const repository = typeof req.body?.repository === 'string' ? req.body.repository.trim() : '';
      const requested = typeof req.body?.branch === 'string' && req.body.branch.trim() ? req.body.branch.trim() : undefined;
      if (!/^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9_.-]+$/.test(repository)) throw new SourceError('Name a repository as owner/name.', 400);
      const { body: found } = await github<GitHubRepository>(api, value, `/repos/${repository}`);
      if (!found) throw new SourceError('That repository does not exist or this sign-in cannot reach it.', 404);
      const branch = requested ?? found.default_branch;
      // Validates the branch name the same way a configured source is validated.
      parseSourceConfig({ source: { type: 'github', url, repository: found.full_name, branch } }, '.');
      if (requested && !(await github(api, value, `/repos/${found.full_name}/branches/${encodeURIComponent(branch)}`)).body) throw new SourceError(`Branch ${branch} does not exist in ${found.full_name}.`, 404);
      const choice: WorkspaceChoice = { repository: found.full_name, branch };
      await services.choices!.write(req, res, choice);
      res.json({ choice });
    } catch (error) {
      fail(res, error instanceof Error && !(error instanceof SourceError) && /Configure source/.test(error.message) ? new SourceError('That branch name is not valid.', 400) : error);
    }
  });
  router.delete('/workspace/choice', async (req, res) => {
    try {
      await services.choices!.clear(req, res);
      res.json({ success: true });
    } catch (error) {
      fail(res, error);
    }
  });
  return router;
}
