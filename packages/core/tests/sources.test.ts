import { stringify } from 'yaml';
import { applyStudyAction, createStudyNote, emptyStudyWorkspace, STUDY_FILE } from '../src/study.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadEnvDefaults, loadSourceConfig, parseSourceConfig } from '../src/source-config.js';
import { parseFolderConfig, scanNotebookFolders } from '../src/folders.js';
import { scanNotebookNotes, writeNoteFile } from '../src/note-service.js';
import { resolveSafePath } from '../src/path-guard.js';
import { loadWorkspaceConfig } from '../src/config.js';
import { resolveNoteStatuses } from '../src/note-status.js';
import { GitHubSource } from '../src/github-source.js';

const manifest = 'schema_version: 1\nworkspace:\n  title: Test\n  default_notebook: example\nnotebooks:\n  - id: example\n    title: Example\n    root: notes/example\n';
const fixture: Record<string, string> = { 'notes/.github-notes.yaml': manifest, 'notes/example/hello.md': '# Hello\n', 'notes/example/projects/_dir.yml': 'title: Projects\norder: -1\n', 'notes/example/projects/deep/_dir.yml': 'title: Deep work\n', 'notes/example/projects/deep/hello.md': '---\ncustom: preserved\ntags: [work]\n---\n# Nested\n', 'notes/example/z-last/_dir.yml': 'title: Last\norder: 2\n', 'notes/example/assets/image.png': 'image', 'notes/example/docs/agent/internal.md': '# Internal' };
function tree() {
  const entries: any[] = [];
  const dirs = new Set<string>();
  for (const file of Object.keys(fixture)) {
    const parts = file.split('/');
    for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join('/'));
    entries.push({ path: file, type: 'blob', mode: '100644', sha: file, size: fixture[file].length });
  }
  return [...entries, ...Array.from(dirs).map(p => ({ path: p, type: 'tree', mode: '040000', sha: p }))];
}
function githubMock(privateRepo = false, write = false) {
  return vi.fn(async (input: string, init?: RequestInit) => {
    const url = input.replace('https://api.github.com/repos/owner/repo', '');
    let result: any;
    if (!url) result = { private: privateRepo, permissions: { push: write } };
    else if (url.startsWith('/commits/')) result = { sha: 'commit1', commit: { tree: { sha: 'tree1' } } };
    else if (url === '/git/trees/tree1?recursive=1') result = { tree: tree(), truncated: false };
    else if (url.startsWith('/git/blobs/') && !init?.method) result = { encoding: 'base64', content: Buffer.from(fixture[url.slice('/git/blobs/'.length)] || '').toString('base64') };
    else return new Response('{}', { status: 404 });
    return new Response(JSON.stringify(result), { status: 200 });
  });
}
let root: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'github-notes-source-'));
  for (const [file, content] of Object.entries(fixture)) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), content);
  }
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('source configuration', () => {
  it('resolves local paths against the config file, independently of cwd', () => {
    fs.mkdirSync(path.join(root, 'runtime'));
    fs.writeFileSync(path.join(root, 'runtime', 'server.yaml'), 'source:\n  type: local\n  path: ../notes\n');
    expect(loadSourceConfig(root, { GITHUB_NOTES_SERVER_CONFIG: 'runtime/server.yaml' })).toEqual({ type: 'local', path: path.join(root, 'notes') });
    expect(loadSourceConfig(root, {})).toEqual({ type: 'local', path: root });
  });
  it('reads the application root only when it holds a workspace, and otherwise requires MYGITNOTES_LOCAL_PATH', () => {
    const core = fs.mkdtempSync(path.join(os.tmpdir(), 'github-notes-core-'));
    try {
      for (const env of [{}, { MYGITNOTES_SOURCE: 'local' }]) expect(() => loadSourceConfig(core, env)).toThrow(/pnpm bootstrap-workspace.*MYGITNOTES_LOCAL_PATH/);
      expect(loadSourceConfig(core, { MYGITNOTES_SOURCE: 'local', MYGITNOTES_LOCAL_PATH: '../notes' })).toEqual({ type: 'local', path: path.resolve(core, '../notes') });
      expect(loadSourceConfig(core, { REPO_ROOT: root })).toEqual({ type: 'local', path: root });
    } finally {
      fs.rmSync(core, { recursive: true, force: true });
    }
  });
  it('treats empty source keys as unset', () => {
    const notes = path.join(root, 'legacy');
    expect(loadSourceConfig(root, { MYGITNOTES_SOURCE: 'local', MYGITNOTES_LOCAL_PATH: '', GITHUB_NOTES_LOCAL_PATH: notes })).toEqual({ type: 'local', path: notes });
    expect(loadSourceConfig(root, { MYGITNOTES_SOURCE: '', GITHUB_NOTES_SOURCE: 'github', MYGITNOTES_REPOSITORY: '', GITHUB_NOTES_REPOSITORY: 'owner/repo', GITHUB_NOTES_BRANCH: 'main' })).toEqual({ type: 'github', repository: 'owner/repo', branch: 'main' });
    expect(loadSourceConfig(root, { MYGITNOTES_SOURCE: 'gitlab', MYGITNOTES_REPOSITORY: 'group/project', MYGITNOTES_BRANCH: 'main', MYGITNOTES_GITLAB_URL: '', GITLAB_URL: '' })).toMatchObject({ type: 'gitlab', url: 'https://gitlab.com' });
  });
  it('fills empty or missing environment keys from a .env file without overriding set ones', () => {
    const file = path.join(root, '.env');
    fs.writeFileSync(file, 'MYGITNOTES_LOCAL_PATH=../notes\nMYGITNOTES_SOURCE=local\nPORT=4000\n');
    const env: NodeJS.ProcessEnv = { MYGITNOTES_LOCAL_PATH: '', PORT: '5000' };
    loadEnvDefaults(file, env);
    expect(env).toEqual({ MYGITNOTES_LOCAL_PATH: '../notes', MYGITNOTES_SOURCE: 'local', PORT: '5000' });
    expect(() => loadEnvDefaults(path.join(root, 'missing.env'), env)).not.toThrow();
  });
  it('validates remote source settings and fails closed in an unconfigured cloud', () => {
    expect(parseSourceConfig({ source: { type: 'github', repository: 'owner/repo', branch: 'main' } }, root).type).toBe('github');
    for (const repository of ['https://evil.example/a', '../repo', 'owner/repo/extra']) expect(() => parseSourceConfig({ source: { type: 'github', repository, branch: 'main' } }, root)).toThrow();
    expect(() => loadSourceConfig(root, { VERCEL: '1' })).toThrow(/GITHUB_NOTES_REPOSITORY/);
  });
});

describe('folder and provider parity', () => {
  const nb = { id: 'example', title: 'Example', root: 'notes/example' };
  it('reads nested titles, ordering and empty local folders while excluding assets and agent docs', async () => {
    fs.mkdirSync(path.join(root, nb.root, 'empty'));
    const folders = scanNotebookFolders(root, nb);
    expect(folders.map(f => f.path)).toEqual(['projects', 'projects/deep', 'docs', 'empty', 'z-last']);
    expect(folders.find(f => f.path === 'projects/deep')?.title).toBe('Deep work');
    expect(scanNotebookNotes(root, nb).map(n => n.title).sort()).toEqual(['Hello', 'Nested']);
    expect(() => parseFolderConfig('title: []', 'fallback', 'projects/_dir.yml')).toThrow(/projects\/_dir.yml/);
  });
  it('gives the same note bodies and folder metadata through local and GitHub providers', async () => {
    const request = githubMock();
    const remote = new GitHubSource('owner/repo', 'main', undefined, request as typeof fetch);
    const notes = await remote.notes();
    expect(notes.map(n => [n.path, n.content]).sort()).toEqual(scanNotebookNotes(root, nb).map(n => [n.path, n.content]).sort());
    expect(await remote.folders()).toEqual(scanNotebookFolders(root, nb));
    expect(notes.find(n => n.title === 'Nested')?.metadata.custom).toBe('preserved');
    expect(request.mock.calls.filter(([url]) => url.endsWith('/commits/main'))).toHaveLength(1);
    expect(request.mock.calls.every(([, init]) => !(init?.headers as Record<string, string>)?.Authorization)).toBe(true);
    await expect(remote.note('notes/.github-notes.yaml')).rejects.toThrow(/configured note/);
    await expect(remote.readFile('../outside')).rejects.toThrow(/Invalid/);
  });
  it('retains notebook statuses through both source adapters', async () => {
    const original = fixture['notes/.github-notes.yaml'];
    try {
      fixture['notes/.github-notes.yaml'] = original + '    statuses: [capture, review, published]\n';
      fs.writeFileSync(path.join(root, 'notes/.github-notes.yaml'), fixture['notes/.github-notes.yaml']);
      const remote = new GitHubSource('owner/repo', 'main', undefined, githubMock() as typeof fetch);
      const localConfig = loadWorkspaceConfig(root)!;
      const remoteConfig = await remote.config();
      expect(remoteConfig.notebooks).toEqual(localConfig.notebooks);
      expect(resolveNoteStatuses(remoteConfig.notebooks[0])).toEqual(['capture', 'review', 'published']);
    } finally {
      fixture['notes/.github-notes.yaml'] = original;
    }
  });
  it('accepts the standard workspace manifest filename when the legacy name is absent', async () => {
    const original = fixture['notes/.github-notes.yaml'];
    delete fixture['notes/.github-notes.yaml'];
    fixture['notes/.mygitnotes.yaml'] = original;
    fs.rmSync(path.join(root, 'notes/.github-notes.yaml'));
    fs.writeFileSync(path.join(root, 'notes/.mygitnotes.yaml'), original);
    try {
      const remote = new GitHubSource('owner/repo', 'main', undefined, githubMock() as typeof fetch);
      expect((await remote.config()).notebooks[0].id).toBe('example');
      expect(loadWorkspaceConfig(root)?.notebooks[0].id).toBe('example');
    } finally {
      delete fixture['notes/.mygitnotes.yaml'];
      fixture['notes/.github-notes.yaml'] = original;
      fs.rmSync(path.join(root, 'notes/.mygitnotes.yaml'));
      fs.writeFileSync(path.join(root, 'notes/.github-notes.yaml'), original);
    }
  });
  it('prefers the standard workspace manifest filename over the legacy name when both exist remotely', async () => {
    fixture['notes/.mygitnotes.yaml'] = manifest.replace('title: Test', 'title: Preferred');
    fs.writeFileSync(path.join(root, 'notes/.mygitnotes.yaml'), fixture['notes/.mygitnotes.yaml']);
    try {
      const remote = new GitHubSource('owner/repo', 'main', undefined, githubMock() as typeof fetch);
      expect((await remote.config()).workspace.title).toBe('Preferred');
    } finally {
      delete fixture['notes/.mygitnotes.yaml'];
      fs.rmSync(path.join(root, 'notes/.mygitnotes.yaml'));
    }
  });
  it('renders a configured notebook template and excludes it from notes through both source adapters', async () => {
    const original = fixture['notes/.github-notes.yaml'];
    try {
      fixture['notes/.github-notes.yaml'] = original + '    templates:\n      - id: reading\n        title: Reading\n        file: .templates/reading.md\n';
      fixture['notes/example/.templates/reading.md'] = '---\ntitle: "{{title}}"\nstatus: unread\n---\n\n# {{title}}\n';
      fs.writeFileSync(path.join(root, 'notes/.github-notes.yaml'), fixture['notes/.github-notes.yaml']);
      fs.mkdirSync(path.join(root, 'notes/example/.templates'), { recursive: true });
      fs.writeFileSync(path.join(root, 'notes/example/.templates/reading.md'), fixture['notes/example/.templates/reading.md']);
      const remote = new GitHubSource('owner/repo', 'main', undefined, githubMock() as typeof fetch);
      const rendered = await remote.renderTemplate('example', 'reading', 'Grounding');
      expect(rendered.metadata.title).toBe('Grounding');
      expect(rendered.metadata.status).toBe('unread');
      expect(rendered.content).toContain('# Grounding');
      const notes = await remote.notes();
      expect(notes.some(n => n.path.includes('.templates'))).toBe(false);
      expect(scanNotebookNotes(root, loadWorkspaceConfig(root)!.notebooks[0]).some(n => n.path.includes('.templates'))).toBe(false);
    } finally {
      delete fixture['notes/example/.templates/reading.md'];
      fixture['notes/.github-notes.yaml'] = original;
    }
  });
  it('denies unauthenticated private reads and anonymous writes', async () => {
    const privateReader = new GitHubSource('owner/repo', 'main', undefined, githubMock(true) as typeof fetch);
    await expect(privateReader.notes()).rejects.toThrow(/Sign in/);
    const remote = new GitHubSource('owner/repo', 'main', undefined, githubMock() as typeof fetch);
    await expect(remote.save('notes/example/hello.md', '# Changed', undefined, 'commit1')).rejects.toMatchObject({ status: 403 });
  });
  it('rejects stale revisions and duplicate creates before any GitHub write', async () => {
    const request = githubMock(false, true);
    const remote = new GitHubSource('owner/repo', 'main', 'secret', request as typeof fetch);
    await expect(remote.save('notes/example/hello.md', '# Changed', undefined, 'old')).rejects.toMatchObject({ status: 409 });
    await expect(remote.save('notes/example/hello.md', '# Changed', undefined, 'commit1', true)).rejects.toMatchObject({ status: 409 });
    expect(request.mock.calls.some(([, init]) => init?.method)).toBe(false);
  });
  it('reports upstream rate limits and incomplete nonrecursive trees', async () => {
    const denied = new GitHubSource('owner/repo', 'main', undefined, vi.fn(async () => new Response('{}', { status: 429 })) as typeof fetch);
    await expect(denied.notes()).rejects.toThrow(/rate limit/);
    const base = githubMock();
    const request = vi.fn(async (input: any, init: any) => String(input).includes('/git/trees/') ? new Response(JSON.stringify({ tree: [], truncated: true })) : base(input, init));
    await expect(new GitHubSource('owner/repo', 'main', undefined, request as typeof fetch).notes()).rejects.toThrow(/too large/);
  });
  it('writes nested notes while preserving unknown metadata', () => {
    const note = writeNoteFile(root, 'notes/example/projects/deep/new.md', '# New', { custom: { a: 1 } }, 'example');
    expect(note.metadata.custom).toEqual({ a: 1 });
  });
  it('rejects new-file writes through an escaping parent symlink', () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'github-notes-outside-'));
    try {
      fs.symlinkSync(outside, path.join(root, 'escape'));
      expect(() => resolveSafePath(root, 'escape/new/file.md')).toThrow(/Symlink/);
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });
});

describe('GitHub commit concurrency', () => {
  it('sends a non-force reference update and reports a concurrent commit conflict', async () => {
    const base = githubMock(false, true);
    const request = vi.fn(async (input: string, init?: RequestInit) => {
      if (init?.method === 'POST') return new Response(JSON.stringify({ sha: input.endsWith('/blobs') ? 'newblob' : input.endsWith('/trees') ? 'newtree' : 'newcommit' }));
      if (init?.method === 'PATCH') {
        expect(JSON.parse(String(init.body))).toEqual({ sha: 'newcommit', force: false });
        return new Response('{}', { status: 422 });
      }
      return base(input, init);
    });
    const reader = new GitHubSource('owner/repo', 'main', 'token', request as typeof fetch);
    await expect(reader.save('notes/example/hello.md', '# Changed', undefined, 'commit1')).rejects.toMatchObject({ status: 409 });
    expect(request.mock.calls.some(([url]) => url.endsWith('/git/refs/heads/main'))).toBe(true);
  });
  it('recovers a truncated recursive tree by traversing complete subtrees', async () => {
    const base = githubMock();
    const all = tree();
    const request = vi.fn(async (input: string, init?: RequestInit) => {
      const endpoint = input.replace('https://api.github.com/repos/owner/repo', '');
      if (endpoint === '/git/trees/tree1?recursive=1') return new Response(JSON.stringify({ tree: [], truncated: true }));
      if (endpoint.startsWith('/git/trees/')) {
        const prefix = endpoint === '/git/trees/tree1' ? '' : endpoint.slice('/git/trees/'.length) + '/';
        const direct = all.filter(e => e.path.startsWith(prefix) && !e.path.slice(prefix.length).includes('/')).map(e => ({ ...e, path: e.path.slice(prefix.length) }));
        return new Response(JSON.stringify({ tree: direct, truncated: false }));
      }
      return base(input, init);
    });
    const reader = new GitHubSource('owner/repo', 'main', undefined, request as typeof fetch);
    expect((await reader.notes()).map(n => n.title).sort()).toEqual(['Hello', 'Nested']);
  });
});

describe('successful remote save', () => {
  it('commits the requested note and reads the result at the new commit', async () => {
    const base = githubMock(false, true);
    let written = false;
    let content = '';
    const request = vi.fn(async (input: string, init?: RequestInit) => {
      if (init?.method === 'POST' && input.endsWith('/git/blobs')) {
        content = JSON.parse(String(init.body)).content;
        return new Response(JSON.stringify({ sha: 'blob2' }));
      }
      if (init?.method === 'POST' && input.endsWith('/git/trees')) {
        content = JSON.parse(String(init.body)).tree[0].content;
        return new Response(JSON.stringify({ sha: 'tree2' }));
      }
      if (init?.method === 'POST' && input.endsWith('/git/commits')) {
        expect(JSON.parse(String(init.body)).parents).toEqual(['commit1']);
        return new Response(JSON.stringify({ sha: 'commit2' }));
      }
      if (init?.method === 'PATCH') {
        written = true;
        return new Response(JSON.stringify({ object: { sha: 'commit2' } }));
      }
      if (input.endsWith('/commits/commit2')) return new Response(JSON.stringify({ sha: 'commit2', commit: { tree: { sha: 'tree1' } } }));
      if (written && input.endsWith('/git/blobs/notes/example/hello.md')) return new Response(JSON.stringify({ encoding: 'base64', content: Buffer.from(content).toString('base64') }));
      return base(input, init);
    });
    const reader = new GitHubSource('owner/repo', 'main', 'token', request as typeof fetch);
    const result = await reader.save('notes/example/hello.md', '# Updated', { custom: 'kept' }, 'commit1');
    expect(result.commit.commitHash).toBe('commit2');
    expect(result.note.revision).toBe('commit2');
    expect(result.note.title).toBe('Updated');
    expect(result.note.metadata.custom).toBe('kept');
  });
});

describe('GitHub study workspace writes', () => {
  const source = { notebookId: 'example', path: 'notes/example/hello.md', title: 'Hello', content: 'Question\n\n---\n\nAnswer', metadata: {} };
  const note = createStudyNote(source);
  const yaml = stringify(applyStudyAction(emptyStudyWorkspace(), note, note.cards[0].id, { kind: 'review', rating: 3 }));
  it('commits only the study sidecar through a non-force branch update', async () => {
    const base = githubMock(false, true);
    const request = vi.fn(async (input: string, init?: RequestInit) => {
      if (init?.method === 'POST' && input.endsWith('/git/trees')) {
        expect(JSON.parse(String(init.body)).tree).toEqual([{ path: STUDY_FILE, mode: '100644', type: 'blob', content: yaml }]);
        return new Response(JSON.stringify({ sha: 'study-tree' }));
      }
      if (init?.method === 'POST' && input.endsWith('/git/commits')) return new Response(JSON.stringify({ sha: 'study-commit' }));
      if (init?.method === 'PATCH') {
        expect(JSON.parse(String(init.body))).toEqual({ sha: 'study-commit', force: false });
        return new Response(JSON.stringify({ object: { sha: 'study-commit' } }));
      }
      return base(input, init);
    });
    const reader = new GitHubSource('owner/repo', 'main', 'test-token', request as typeof fetch);
    expect(await reader.saveStudyWorkspace(yaml, 'commit1')).toMatchObject({ revision: 'study-commit', commit: { commitHash: 'study-commit' } });
    expect(request.mock.calls.filter(([, init]) => init?.method === 'PATCH')).toHaveLength(1);
  });
  it('commits the note and stage history through one non-force update', async () => {
    const base = githubMock(false, true), content = '---\nstatus: review\n---\n\nQuestion\n';
    const request = vi.fn(async (input: string, init?: RequestInit) => {
      if (init?.method === 'POST' && input.endsWith('/git/trees')) {
        expect(JSON.parse(String(init.body)).tree.map((entry: { path: string; }) => entry.path)).toEqual([STUDY_FILE, 'notes/example/hello.md']);
        return new Response(JSON.stringify({ sha: 'study-tree' }));
      }
      if (init?.method === 'POST' && input.endsWith('/git/commits')) return new Response(JSON.stringify({ sha: 'study-commit' }));
      if (init?.method === 'PATCH') {
        expect(JSON.parse(String(init.body)).force).toBe(false);
        return new Response(JSON.stringify({ object: { sha: 'study-commit' } }));
      }
      return base(input, init);
    });
    const reader = new GitHubSource('owner/repo', 'main', 'test-token', request as typeof fetch);
    expect(await reader.saveStudyTransition(yaml, { path: 'notes/example/hello.md', content }, 'commit1')).toMatchObject({ revision: 'study-commit' });
    expect(request.mock.calls.filter(([, init]) => init?.method === 'PATCH')).toHaveLength(1);
    await expect(reader.saveStudyTransition(yaml, { path: 'apps/escape.md', content }, 'commit1')).rejects.toMatchObject({ status: 403 });
  });
  it('rejects stale revisions, Core writes, invalid schemas and paths outside the study sidecar', async () => {
    const request = githubMock(false, true);
    const reader = new GitHubSource('owner/repo', 'main', 'test-token', request as typeof fetch);
    await expect(reader.saveStudyWorkspace(yaml, 'stale')).rejects.toMatchObject({ status: 409 });
    await expect(reader.saveStudyWorkspace('version: invalid', 'commit1')).rejects.toThrow('Invalid study YAML');
    await expect(reader.commitChanges([{ path: 'notes/example/hello.md', content: yaml }], 'commit1', 'save', 'study')).rejects.toMatchObject({ status: 403 });
    await expect(new GitHubSource('owner/repo', 'core', 'test-token', request as typeof fetch).saveStudyWorkspace(yaml, 'commit1')).rejects.toMatchObject({ status: 403 });
    expect(request.mock.calls.some(([, init]) => init?.method)).toBe(false);
  });
  it('rejects a sidecar symlink before writing', async () => {
    const base = githubMock(false, true);
    const request = vi.fn(async (input: string, init?: RequestInit) => {
      if (input.endsWith('/git/trees/tree1?recursive=1')) return new Response(JSON.stringify({ tree: [...tree(), { path: STUDY_FILE, type: 'blob', mode: '120000', sha: 'symlink' }], truncated: false }));
      return base(input, init);
    });
    await expect(new GitHubSource('owner/repo', 'main', 'test-token', request as typeof fetch).saveStudyWorkspace(yaml, 'commit1')).rejects.toMatchObject({ status: 403 });
    expect(request.mock.calls.some(([, init]) => init?.method)).toBe(false);
  });
  it('invalidates cached snapshot on subsequent fresh snapshot requests', async () => {
    let currentCommit = 'commit1';
    const request = vi.fn(async (input: string) => {
      const url = input.replace('https://api.github.com/repos/owner/repo', '');
      if (!url) return new Response(JSON.stringify({ private: false, permissions: { push: true } }), { status: 200 });
      if (url.startsWith('/commits/')) return new Response(JSON.stringify({ sha: currentCommit, commit: { tree: { sha: 'tree1' } } }), { status: 200 });
      if (url === '/git/trees/tree1?recursive=1') return new Response(JSON.stringify({ tree: tree(), truncated: false }), { status: 200 });
      return new Response('{}', { status: 404 });
    });
    const reader = new GitHubSource('owner/repo', 'main', 'test-token', request as typeof fetch);
    const first = await reader.getSnapshot(true);
    expect(first.sha).toBe('commit1');
    currentCommit = 'commit2';
    // Without fresh=true, returns cached snapshot
    const cached = await reader.getSnapshot(false);
    expect(cached.sha).toBe('commit1');
    // With fresh=true, must return the newly fetched snapshot with commit2
    const fresh = await reader.getSnapshot(true);
    expect(fresh.sha).toBe('commit2');
  });
});
