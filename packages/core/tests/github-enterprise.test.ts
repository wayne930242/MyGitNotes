import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { validateWorkspaceConfig } from '../src/config.js';
import { GitHubApi } from '../src/github-api.js';
import { githubSite, normalizeGitHubUrl } from '../src/github-site.js';
import { openRemoteHome } from '../src/remote-factory.js';
import { loadRepositoryMappings, loadSourceConfig, mapsRepository, parseSourceConfig, type RemoteSourceConfig, sourceIdentity } from '../src/source-config.js';
import { sharesCredential } from '../src/repository.js';

const github = (url?: string, repository = 'owner/repo'): RemoteSourceConfig => ({ type: 'github', ...(url ? { url } : {}), repository, branch: 'main' });
const env = (extra: Record<string, string>) => ({ MYGITNOTES_SOURCE: 'github', MYGITNOTES_REPOSITORY: 'team/notes', MYGITNOTES_BRANCH: 'main', ...extra });

afterEach(() => vi.restoreAllMocks());

describe('naming a GitHub site', () => {
  it('reads MYGITNOTES_GITHUB_URL and GITHUB_NOTES_GITHUB_URL only for a github source', () => {
    expect(loadSourceConfig('/nowhere', env({ MYGITNOTES_GITHUB_URL: 'https://ghe.example.com' }))).toEqual({ type: 'github', url: 'https://ghe.example.com', repository: 'team/notes', branch: 'main' });
    expect(loadSourceConfig('/nowhere', env({ MYGITNOTES_GITHUB_URL: '', GITHUB_NOTES_GITHUB_URL: 'https://ghe.example.com/' }))).toMatchObject({ url: 'https://ghe.example.com' });
    expect(loadSourceConfig('/nowhere', { MYGITNOTES_SOURCE: 'gitlab', MYGITNOTES_REPOSITORY: 'group/project', MYGITNOTES_BRANCH: 'main', MYGITNOTES_GITHUB_URL: 'https://ghe.example.com' })).toMatchObject({ type: 'gitlab', url: 'https://gitlab.com' });
    expect(loadSourceConfig('/nowhere', env({ MYGITNOTES_GITLAB_URL: 'https://gitlab.example.com', GITLAB_URL: 'https://gitlab.example.com' }))).toEqual({ type: 'github', repository: 'team/notes', branch: 'main' });
  });
  it('leaves the url out for github.com, with or without a trailing slash', () => {
    expect(loadSourceConfig('/nowhere', env({}))).toEqual({ type: 'github', repository: 'team/notes', branch: 'main' });
    for (const url of ['https://github.com', 'https://github.com/']) expect(loadSourceConfig('/nowhere', env({ MYGITNOTES_GITHUB_URL: url }))).toStrictEqual({ type: 'github', repository: 'team/notes', branch: 'main' });
  });
  it('validates the url like GitLab: absolute HTTPS, no credentials, query or fragment', () => {
    expect(normalizeGitHubUrl('https://example.com/github/')).toBe('https://example.com/github');
    for (const bad of ['http://ghe.example.com', 'ghe.example.com', 'https://user:pw@ghe.example.com', 'https://ghe.example.com?x=1', 'https://ghe.example.com#x', 'https://ghe.example.com/%2e%2e', '']) expect(() => normalizeGitHubUrl(bad)).toThrow(/GitHub/);
    expect(() => parseSourceConfig({ source: { type: 'github', url: 'http://ghe.example.com', repository: 'a/b', branch: 'main' } }, '.')).toThrow(/GitHub URL/);
  });
  it('reads source.url in the server YAML and on a notebook', () => {
    expect(parseSourceConfig({ source: { type: 'github', url: 'https://ghe.example.com', repository: 'team/notes', branch: 'main' } }, '.')).toMatchObject({ url: 'https://ghe.example.com' });
    const manifest = validateWorkspaceConfig({ schema_version: 2, workspace: { title: 'T', default_notebook: 'a' }, notebooks: [{ id: 'a', title: 'A', root: 'a', source: { type: 'github', url: 'https://ghe.example.com', repository: 'team/design' } }, { id: 'b', title: 'B', root: 'b', source: { type: 'github', url: 'https://github.com/', repository: 'team/open' } }] });
    expect(manifest.notebooks[0].source).toEqual({ type: 'github', url: 'https://ghe.example.com', repository: 'team/design', branch: 'main' });
    expect(manifest.notebooks[1].source).toStrictEqual({ type: 'github', repository: 'team/open', branch: 'main' });
  });
  it('maps worktrees by site', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ghe-map-'));
    try {
      fs.writeFileSync(path.join(root, 'mygitnotes.server.yaml'), 'repositories:\n  - { type: github, url: "https://ghe.example.com", repository: team/notes, path: ./ghes }\n  - { type: github, repository: team/notes, path: ./com }\n');
      const [ghes, com] = loadRepositoryMappings(root, {});
      expect(ghes.source).toEqual({ type: 'github', url: 'https://ghe.example.com', repository: 'team/notes' });
      expect(com.source).toStrictEqual({ type: 'github', repository: 'team/notes' });
      expect(mapsRepository(ghes, github('https://ghe.example.com', 'team/notes'))).toBe(true);
      expect(mapsRepository(ghes, github(undefined, 'team/notes'))).toBe(false);
      expect(mapsRepository(com, github(undefined, 'team/notes'))).toBe(true);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('identity and shared sign-in', () => {
  it('keeps the identity of a github.com source and gives an Enterprise source its site', () => {
    expect(sourceIdentity(github())).toBe('github:owner/repo@main');
    expect(sourceIdentity(github('https://ghe.example.com'))).toBe('github:https://ghe.example.com/owner/repo@main');
    expect(sourceIdentity(github('https://ghe.example.com'))).not.toBe(sourceIdentity(github('https://other.example.com')));
  });
  it('shares a sign-in only between sources of the same platform and site', () => {
    const ghes = github('https://ghe.example.com');
    expect(sharesCredential(ghes, github('https://ghe.example.com', 'team/design'))).toBe(true);
    expect(sharesCredential(ghes, github())).toBe(false);
    expect(sharesCredential(github(), ghes)).toBe(false);
    expect(sharesCredential(github(), github(undefined, 'a/b'))).toBe(true);
    expect(sharesCredential(ghes, github('https://other.example.com'))).toBe(false);
    expect(sharesCredential(ghes, { type: 'gitlab', url: 'https://ghe.example.com', repository: 'a/b', branch: 'main' })).toBe(false);
    expect(sharesCredential({ type: 'local', path: '/a' }, { type: 'local', path: '/b' })).toBe(true);
    expect(sharesCredential({ type: 'local', path: '/a' }, ghes)).toBe(false);
  });
});

describe('API locations', () => {
  it('uses api.github.com for github.com', () => {
    for (const site of [githubSite(), githubSite('https://github.com')]) expect(site).toMatchObject({ web: 'https://github.com', api: 'https://api.github.com', graphql: 'https://api.github.com/graphql', enterprise: false });
  });
  it('uses api.<host> for a data-residency *.ghe.com site', () => {
    expect(githubSite('https://octocorp.ghe.com')).toMatchObject({ web: 'https://octocorp.ghe.com', api: 'https://api.octocorp.ghe.com', graphql: 'https://api.octocorp.ghe.com/graphql', enterprise: true });
  });
  it('uses /api/v3 and /api/graphql under any other host, path included', () => {
    expect(githubSite('https://ghe.example.com')).toMatchObject({ api: 'https://ghe.example.com/api/v3', graphql: 'https://ghe.example.com/api/graphql' });
    expect(githubSite('https://example.com/github')).toMatchObject({ api: 'https://example.com/github/api/v3', graphql: 'https://example.com/github/api/graphql' });
  });
  it('builds the GitHub App installation link per site', () => {
    expect(githubSite().installUrl('my app')).toBe('https://github.com/apps/my%20app/installations/new');
    expect(githubSite('https://ghe.example.com').installUrl('my-app')).toBe('https://ghe.example.com/github-apps/my-app/installations/new');
  });
});

describe('archive redirect hosts', () => {
  const allowed = (site: string | undefined, location: string) => githubSite(site).archiveAllowed(new URL(location));
  it('accepts only codeload.github.com for github.com', () => {
    expect(allowed(undefined, 'https://codeload.github.com/o/r/legacy.tar.gz/abc')).toBe(true);
    for (const location of ['http://codeload.github.com/x', 'https://codeload.github.com:8443/x', 'https://u:p@codeload.github.com/x', 'https://github.com/codeload/x', 'https://example.com/x', 'https://codeload.ghe.example.com/x']) expect(allowed(undefined, location)).toBe(false);
  });
  it('accepts the site codeload subdomain or its /codeload/ path for an Enterprise site', () => {
    expect(allowed('https://ghe.example.com', 'https://codeload.ghe.example.com/o/r/legacy.tar.gz/abc')).toBe(true);
    expect(allowed('https://ghe.example.com', 'https://ghe.example.com/codeload/o/r/legacy.tar.gz/abc')).toBe(true);
    expect(allowed('https://octocorp.ghe.com', 'https://codeload.octocorp.ghe.com/o/r/legacy.tar.gz/abc')).toBe(true);
  });
  it('accepts the port an Enterprise site is configured with, and no other', () => {
    expect(allowed('https://ghe.example.com:8443', 'https://ghe.example.com:8443/codeload/o/r/legacy.tar.gz/abc')).toBe(true);
    expect(allowed('https://ghe.example.com:8443', 'https://codeload.ghe.example.com:8443/o/r/legacy.tar.gz/abc')).toBe(true);
    for (const location of ['https://ghe.example.com/codeload/x', 'https://ghe.example.com:9443/codeload/x']) expect(allowed('https://ghe.example.com:8443', location)).toBe(false);
  });
  it('refuses any other destination for an Enterprise site', () => {
    for (const location of ['https://codeload.github.com/x', 'https://ghe.example.com/raw/x', 'https://ghe.example.com/other', 'http://ghe.example.com/codeload/x', 'https://ghe.example.com:8443/codeload/x', 'https://u:p@ghe.example.com/codeload/x', 'https://codeload.other.example.com/x', 'https://evilghe.example.com/codeload/x', 'https://codeload.ghe.example.com.evil.test/x']) expect(allowed('https://ghe.example.com', location)).toBe(false);
  });
});

const blobSha = (value: string) => createHash('sha1').update(`blob ${Buffer.byteLength(value)}\0${value}`).digest('hex');
const manifest = 'schema_version: 1\nworkspace:\n  title: Test\n  default_notebook: ex\nnotebooks:\n  - id: ex\n    title: Example\n    root: notes/ex\n';

/** One repository on a site whose REST root is `api`: every request is recorded, and requests off the site fail the test. */
function siteFixture(api: string, graphql: string, files: Record<string, string> = { 'notes/.github-notes.yaml': manifest, 'notes/ex/hello.md': '# Hello\n' }) {
  const entries = Object.entries(files).map(([file, content]) => ({ path: file, type: 'blob', mode: '100644', sha: blobSha(content), size: Buffer.byteLength(content) }));
  const calls: { url: string; init: RequestInit; }[] = [];
  const request = vi.fn(async (input: any, init: RequestInit = {}) => {
    const url = String(input);
    calls.push({ url, init });
    if (url === graphql) {
      const texts = new Map(Object.values(files).map(text => [blobSha(text), text]));
      const repository = Object.fromEntries([...JSON.parse(String(init.body)).query.matchAll(/(b\d+): object\(oid: "([a-f0-9]+)"\)/g)].map(([, alias, sha]: string[]) => [alias, { isBinary: false, isTruncated: false, text: texts.get(sha) }]));
      return new Response(JSON.stringify({ data: { repository } }));
    }
    if (!url.startsWith(`${api}/repos/owner/repo`)) throw new Error(`Request left the site: ${url}`);
    const endpoint = url.slice(`${api}/repos/owner/repo`.length);
    const json = (data: unknown) => new Response(JSON.stringify(data));
    if (!endpoint) return json({ private: true, permissions: { push: true } });
    if (endpoint.startsWith('/commits/')) return json({ sha: 'a'.repeat(40), commit: { tree: { sha: 'c'.repeat(40) } } });
    if (endpoint.startsWith('/git/trees/')) return json({ tree: entries, truncated: false });
    if (endpoint.startsWith('/git/blobs/')) {
      const entry = entries.find(candidate => candidate.sha === endpoint.slice('/git/blobs/'.length));
      return json({ encoding: 'base64', content: Buffer.from(files[entry!.path]).toString('base64') });
    }
    throw new Error(`Unexpected fixture endpoint: ${endpoint}`);
  }) as unknown as typeof fetch;
  return { calls, request };
}

describe('reading a repository on an Enterprise site', () => {
  it.each([['a GHES site', 'https://ghe.example.com', 'https://ghe.example.com/api/v3', 'https://ghe.example.com/api/graphql'], ['a GHES site under a path', 'https://example.com/github', 'https://example.com/github/api/v3', 'https://example.com/github/api/graphql'], ['a data-residency site', 'https://octocorp.ghe.com', 'https://api.octocorp.ghe.com', 'https://api.octocorp.ghe.com/graphql']])('sends every request to %s only', async (_name, url, api, graphql) => {
    const site = siteFixture(api, graphql);
    const notes = await openRemoteHome(github(url), 'token', site.request).reader.notes();
    expect(notes.map(note => note.path)).toEqual(['notes/ex/hello.md']);
    expect(site.calls.length).toBeGreaterThan(0);
    expect(site.calls.every(call => call.url.startsWith(api) || call.url === graphql)).toBe(true);
    expect(site.calls.every(call => new Headers(call.init.headers).get('Authorization') === 'Bearer token')).toBe(true);
  });
  it('reports the site in the repository identity', () => {
    const { reader } = openRemoteHome(github('https://ghe.example.com'), 'token', siteFixture('https://ghe.example.com/api/v3', 'https://ghe.example.com/api/graphql').request);
    expect(reader.id).toBe('github:https://ghe.example.com/owner/repo@main');
    expect(openRemoteHome(github(), 'token', siteFixture('https://api.github.com', 'https://api.github.com/graphql').request).reader.id).toBe('github:owner/repo@main');
  });
  it('batches blob reads through the site GraphQL endpoint', async () => {
    const files: Record<string, string> = { 'notes/.github-notes.yaml': manifest };
    for (let i = 0; i < 20; i++) files[`notes/ex/n${i}.md`] = `# Note ${i}\n`;
    const site = siteFixture('https://ghe.example.com/api/v3', 'https://ghe.example.com/api/graphql', files);
    expect(await openRemoteHome(github('https://ghe.example.com'), 'token', site.request).reader.notes()).toHaveLength(20);
    expect(site.calls.some(call => call.url === 'https://ghe.example.com/api/graphql')).toBe(true);
  });
  it('keeps the same repository name on two sites apart in the process caches and request lanes', async () => {
    const request = vi.fn(async (input: any) => {
      const url = String(input);
      if (url.startsWith('https://api.github.com/repos/owner/repo')) return new Response(JSON.stringify({ private: false, site: 'com' }));
      if (url.startsWith('https://ghe.example.com/api/v3/repos/owner/repo')) return new Response(JSON.stringify({ private: false, site: 'ghes' }));
      throw new Error(`Unexpected ${url}`);
    }) as unknown as typeof fetch;
    const com = new GitHubApi('owner/repo', 'token', request), ghes = new GitHubApi('owner/repo', 'token', request, 'https://ghe.example.com');
    expect(await com.json('')).toMatchObject({ site: 'com' });
    expect(await ghes.json('')).toMatchObject({ site: 'ghes' });
    expect(await ghes.json('/commits/main')).toMatchObject({ site: 'ghes' });
    expect(request).toHaveBeenCalledTimes(3);
  });
  it('shares a rate-limit cooldown only within a site', async () => {
    const request = vi.fn(async (input: any) => String(input).startsWith('https://ghe.example.com/') ? new Response('{}', { status: 429, headers: { 'retry-after': '120' } }) : new Response(JSON.stringify({ private: false }))) as unknown as typeof fetch;
    await expect(new GitHubApi('owner/repo', 'same-token', request, 'https://ghe.example.com').json('')).rejects.toMatchObject({ status: 429 });
    await expect(new GitHubApi('owner/other', 'same-token', request, 'https://ghe.example.com').json('')).rejects.toMatchObject({ status: 429 });
    expect(request).toHaveBeenCalledTimes(1);
    await expect(new GitHubApi('owner/repo', 'same-token', request).json('')).resolves.toMatchObject({ private: false });
  });
});

describe('the shared cache', () => {
  it('keys an Enterprise repository by its site and leaves github.com keys as they were', async () => {
    const keys = async (url?: string) => {
      const stored: string[] = [];
      const cache = { get: async (names: string[]) => names.map(() => null), set: async (entries: [string, string][]) => void stored.push(...entries.map(([key]) => key)) };
      const api = url ? 'https://ghe.example.com/api/v3' : 'https://api.github.com';
      const site = siteFixture(api, url ? 'https://ghe.example.com/api/graphql' : 'https://api.github.com/graphql');
      await openRemoteHome(github(url), 'token', site.request, cache).reader.notes();
      return stored;
    };
    const enterprise = await keys('https://ghe.example.com'), com = await keys();
    expect(enterprise.length).toBeGreaterThan(0);
    expect(com.length).toBeGreaterThan(0);
    expect(enterprise.every(key => /^mgn:[a-z]+:v?\d+:https:\/\/ghe\.example\.com\/owner\/repo:/.test(key))).toBe(true);
    expect(com.every(key => /^mgn:[a-z]+:v?\d+:owner\/repo:/.test(key))).toBe(true);
  });
});

describe('archive downloads on an Enterprise site', () => {
  const tarball = (location: string) => {
    const request = vi.fn(async (input: any) => String(input).includes('/tarball/') ? new Response(null, { status: 302, headers: { location } }) : new Response('archive bytes')) as unknown as typeof fetch;
    return { request, api: new GitHubApi('owner/repo', 'secret', request, 'https://ghe.example.com') };
  };
  it.each(['https://codeload.ghe.example.com/owner/repo/legacy.tar.gz/abc', 'https://ghe.example.com/codeload/owner/repo/legacy.tar.gz/abc'])('follows %s and never sends the token there', async location => {
    const { request, api } = tarball(location);
    expect(await (await api.archive('abc')).text()).toBe('archive bytes');
    const [[first, firstInit], [second, secondInit]] = (request as unknown as { mock: { calls: [string, RequestInit][]; }; }).mock.calls;
    expect(first).toBe('https://ghe.example.com/api/v3/repos/owner/repo/tarball/abc');
    expect(new Headers(firstInit.headers).get('Authorization')).toBe('Bearer secret');
    expect(second).toBe(location);
    expect(new Headers(secondInit.headers).has('Authorization')).toBe(false);
  });
  it.each(['https://codeload.github.com/owner/repo/legacy.tar.gz/abc', 'https://example.com/steal', 'https://ghe.example.com/raw/steal'])('refuses %s without requesting it', async location => {
    const { request, api } = tarball(location);
    await expect(api.archive('abc')).rejects.toMatchObject({ status: 502 });
    expect(request).toHaveBeenCalledTimes(1);
  });
});
