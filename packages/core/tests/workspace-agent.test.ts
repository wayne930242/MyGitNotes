import { describe, expect, it, vi } from 'vitest';
import { GitHubSource } from '../src/github-source.js';
import { workspaceAgentKind } from '../src/workspace-agent.js';

const files: Record<string, string> = { '.github-notes.yaml': 'schema_version: 1\nworkspace:\n  title: Test\n  default_notebook: ex\nnotebooks:\n  - id: ex\n    title: Example\n    root: notes/ex\n', 'AGENTS.md': '# Workspace\n', '.agents/skills/custom/SKILL.md': '# Skill\n' };
function remote(token: string | undefined = 'fixture', push = true, branch = 'main', symlink = false) {
  const request = vi.fn(async (url: string, init?: RequestInit) => {
    const endpoint = url.replace('https://api.github.com/repos/agent/test', '');
    let value: unknown;
    if (!endpoint) value = { private: false, permissions: { push } };
    else if (endpoint.startsWith('/commits/')) value = { sha: 'before', commit: { tree: { sha: 'tree' } } };
    else if (endpoint === '/git/trees/tree?recursive=1') value = { truncated: false, tree: [...Object.keys(files).map(file => ({ path: file, sha: file, type: 'blob', mode: '100644' })), ...(symlink ? [{ path: '.codex/agents', sha: 'link', type: 'blob', mode: '120000' }] : [])] };
    else if (endpoint.startsWith('/git/blobs/')) value = { encoding: 'base64', content: Buffer.from(files[endpoint.slice('/git/blobs/'.length)] || '').toString('base64') };
    else if (endpoint === '/git/trees' && init?.method === 'POST') value = { sha: 'updated-tree' };
    else if (endpoint === '/git/commits' && init?.method === 'POST') value = { sha: 'after' };
    else if (endpoint === '/git/refs/heads/main' && init?.method === 'PATCH') value = {};
    else throw Error(`Unexpected endpoint ${endpoint}`);
    return new Response(JSON.stringify(value), { status: 200 });
  });
  return { source: new GitHubSource('agent/test', branch, token, request as typeof fetch), request };
}

describe('workspace Agent documents', () => {
  it('classifies Claude and Antigravity skills and instructions without exposing runtime settings', () => {
    for (const file of ['CLAUDE.md', '.claude/CLAUDE.md', 'GEMINI.md', 'notes/ex/CLAUDE.md', 'notes/ex/GEMINI.md']) {
      expect(workspaceAgentKind(file)).toBe('instructions');
    }
    for (const file of ['.claude/skills/review/SKILL.md', '.claude/skills/review/references/guide.md', '.agent/skills/review/SKILL.md', '.agents/skills/format-tests.md']) {
      expect(workspaceAgentKind(file)).toBe('skills');
    }
    for (const file of ['.claude/settings.json', '.claude/settings.local.json', '.claude/.credentials.json', '.claude/projects/log.md', '.agent/skills/run.sh', '.agent/.env', '.gemini/oauth_creds.json', 'CLAUDE.local.md']) {
      expect(workspaceAgentKind(file)).toBeUndefined();
    }
  });
  it('includes native skill interface YAML without opening arbitrary skill files', () => {
    for (const root of ['.agents', '.codex']) {
      expect(workspaceAgentKind(`${root}/skills/review/agents/openai.yaml`)).toBe('skills');
      for (const file of ['secrets.yaml', 'scripts/run.sh', 'agents/.secret.yaml', 'agents/../openai.yaml']) {
        expect(workspaceAgentKind(`${root}/skills/review/${file}`)).toBeUndefined();
      }
    }
  });
  it('allows document paths without exposing credentials, runtime files or scripts', () => {
    for (const file of ['AGENTS.md', '.agents/skills/custom/SKILL.md', '.codex/agents/reviewer.toml', '.codex/rules/local.rules', 'notes/ex/docs/agent/guide.md']) expect(workspaceAgentKind(file)).toBeTruthy();
    for (const file of ['.codex/auth.json', '.codex/config.toml', '.codex/sessions/log.md', '.agents/skills/custom/run.sh', '.agents/skills/custom/.env', 'apps/web/AGENTS.md', 'docs/agent/index.md', '../AGENTS.md', 'notes/../AGENTS.md', '.agents//skills/a.md']) expect(workspaceAgentKind(file)).toBeUndefined();
  });

  it('commits raw Agent content with expected revision and a non-forced branch update', async () => {
    const { source, request } = remote();
    const content = '---\nname: custom\n---\n# 自訂規則\n';
    expect(await source.saveAgentResource('.agents/skills/custom/SKILL.md', content, 'before')).toMatchObject({ revision: 'after', committed: true, pushed: true });
    const tree = request.mock.calls.find(([url, init]) => url.endsWith('/git/trees') && init?.method === 'POST')!;
    expect(JSON.parse(String(tree[1]?.body)).tree).toEqual([{ path: '.agents/skills/custom/SKILL.md', mode: '100644', type: 'blob', content }]);
    const update = request.mock.calls.find(([url, init]) => url.endsWith('/git/refs/heads/main') && init?.method === 'PATCH')!;
    expect(JSON.parse(String(update[1]?.body))).toEqual({ sha: 'after', force: false });
  });

  it('rejects missing permissions, stale revisions and unsafe paths before writing', async () => {
    for (const [token, push, branch] of [['', true, 'main'], ['fixture', false, 'main'], ['fixture', true, 'core']] as const) {
      const { source, request } = remote(token, push, branch);
      await expect(source.saveAgentResource('AGENTS.md', '# Bad', 'before')).rejects.toMatchObject({ status: 403 });
      expect(request.mock.calls.some(([, init]) => init?.method)).toBe(false);
    }
    const { source, request } = remote();
    await expect(source.saveAgentResource('AGENTS.md', '# Bad', 'stale')).rejects.toMatchObject({ status: 409 });
    for (const file of ['.codex/auth.json', 'README.md', '.agents/../AGENTS.md']) await expect(source.saveAgentResource(file, '# Bad', 'before')).rejects.toMatchObject({ status: 403 });
    expect(request.mock.calls.some(([, init]) => init?.method)).toBe(false);
    await expect(remote('fixture', true, 'main', true).source.saveAgentResource('.codex/agents/reviewer.toml', 'bad', 'before')).rejects.toMatchObject({ status: 403 });
  });

  it('rejects creating a skill whose slug already exists instead of overwriting it', async () => {
    const { source, request } = remote();
    await expect(source.saveAgentResource('.agents/skills/custom/SKILL.md', '---\nname: custom\n---\n# New\n', 'before', true)).rejects.toMatchObject({ status: 409 });
    expect(request.mock.calls.some(([, init]) => init?.method)).toBe(false);
  });

  it('creates a brand-new skill when its slug does not collide with an existing one', async () => {
    const { source, request } = remote();
    const content = "---\nname: fresh\ndescription: ''\n---\n\n# fresh\n";
    expect(await source.saveAgentResource('.agents/skills/fresh/SKILL.md', content, 'before', true)).toMatchObject({ revision: 'after', committed: true, pushed: true });
    const tree = request.mock.calls.find(([url, init]) => url.endsWith('/git/trees') && init?.method === 'POST')!;
    expect(JSON.parse(String(tree[1]?.body)).tree).toEqual([{ path: '.agents/skills/fresh/SKILL.md', mode: '100644', type: 'blob', content }]);
  });
});
