import { afterEach, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { deploymentConfigSource, deriveAlias, repositoryRef, type WorkspaceConfigSource } from '@mygitnotes/core';
import { createMCPServer } from '../src/server.js';

const roots: string[] = [];
function worktree(files: Record<string, string>) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-repositories-'));
  roots.push(root);
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root });
  git('init', '-b', 'main');
  git('config', 'user.name', 'Fixture');
  git('config', 'user.email', 'fixture@example.test');
  for (const [file, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), content);
  }
  git('add', '.');
  git('commit', '-m', 'fixture');
  return root;
}
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});
/** A repository's own manifest serving the one notebook `id` at `root`. */
const manifest = (id: string, root: string) => `schema_version: 4\nworkspace:\n  title: ${id}\n  default_notebook: ${id}\nnotebooks:\n  - id: ${id}\n    title: ${id.toUpperCase()}\n    root: ${root}\n`;
/** A local workspace of the worktree `home`, the default member, and of a worktree mapped to the platform repository `repository`. */
function localSource(home: string, repository: string, other: string): WorkspaceConfigSource {
  const members = [{ ref: repositoryRef({ type: 'local', path: home }), alias: deriveAlias(path.basename(home), new Set()), default: true, hidden: false, localPath: home }, { ref: repositoryRef({ type: 'github', repository, branch: 'main' }), alias: deriveAlias(repository, new Set()), default: false, hidden: false, localPath: other }];
  return { mode: 'local', settings: async () => ({ site: { type: 'local' }, members, manifest: (_member, inRepository) => inRepository() }) };
}

it('stdio resolves identical note paths, merges listings, reports both statuses, and commits only the selected notebook', async () => {
  const home = worktree({ '.mygitnotes.yaml': manifest('home', 'notes/shared'), 'notes/shared/note.md': '# Home\n', 'AGENTS.md': '# Home rules\n' });
  const other = worktree({ '.mygitnotes.yaml': manifest('other', 'notes/shared'), 'notes/shared/note.md': '# Other\n' });
  const source = localSource(home, 'owner/other', other);
  const server = createMCPServer(home, source);
  const client = new Client({ name: 'fixture', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  const call = async (name: string, args: Record<string, unknown>) => {
    const result = await client.callTool({ name, arguments: args });
    return { ...result, data: JSON.parse((result.content as { text: string; }[])[0].text) };
  };
  try {
    const { tools } = await client.listTools();
    expect(tools.find(tool => tool.name === 'git_commit')?.inputSchema.properties).toHaveProperty('notebookId');
    expect(tools.find(tool => tool.name === 'list_assets')?.inputSchema.required ?? []).not.toContain('notebookId');
    expect((await call('read_agent_resource', { path: 'AGENTS.md' })).data.content).toContain('Home rules');
    expect((await call('read_note', { path: 'notes/shared/note.md', notebookId: 'home' })).data.note.content).toContain('Home');
    expect((await call('read_note', { path: 'notes/shared/note.md', notebookId: 'other' })).data.note.content).toContain('Other');
    expect((await call('list_notes', {})).data.notes).toHaveLength(2);
    fs.writeFileSync(path.join(home, 'notes/shared/note.md'), '# Home changed\n');
    fs.writeFileSync(path.join(other, 'notes/shared/note.md'), '# Other changed\n');
    const statuses = (await call('get_git_status', {})).data.repositories;
    expect(statuses).toHaveLength(2);
    expect(statuses.every((entry: { status: { isClean: boolean; }; }) => !entry.status.isClean)).toBe(true);
    const committed = await call('git_commit', { notebookId: 'other', files: ['notes/shared/note.md'], message: 'docs: other notebook' });
    expect(committed.isError).not.toBe(true);
    expect(execFileSync('git', ['log', '-1', '--format=%s'], { cwd: other, encoding: 'utf8' }).trim()).toBe('docs: other notebook');
    expect(execFileSync('git', ['status', '--short'], { cwd: home, encoding: 'utf8' })).toContain('note.md');
  } finally {
    await client.close();
    await server.close();
  }
});

it('names notebooks by key, accepts a bare id by the rule old URLs follow, and never falls back from an unknown key', async () => {
  const home = worktree({ '.mygitnotes.yaml': manifest('life', 'notes/life'), 'notes/life/note.md': '# Home\n' });
  const campaign = worktree({ '.mygitnotes.yaml': manifest('trpg', 'notes/life'), 'notes/life/note.md': '# Campaign\n' });
  const source = localSource(home, 'owner/campaign', campaign);
  const server = createMCPServer(home, source);
  const client = new Client({ name: 'fixture', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  const call = async (name: string, args: Record<string, unknown>) => {
    const result = await client.callTool({ name, arguments: args });
    return { ...result, data: JSON.parse((result.content as { text: string; }[])[0].text) };
  };
  // The default worktree's alias is its directory's name; the other repository's alias is its name.
  const life = `${path.basename(home).toLowerCase()}~life`;
  try {
    const notebooks = (await call('list_notebooks', {})).data.notebooks;
    expect(notebooks.map((notebook: { key: string; id: string; repository: string; }) => [notebook.key, notebook.id])).toEqual([[life, 'life'], ['campaign~trpg', 'trpg']]);
    expect((await call('get_workspace_config', {})).data.config.workspace.default_notebook).toBe(life);
    expect((await call('read_note', { path: 'notes/life/note.md', notebookId: 'campaign~trpg' })).data.note).toMatchObject({ notebookId: 'campaign~trpg', content: expect.stringContaining('Campaign') });
    expect((await call('read_note', { path: 'notes/life/note.md', notebookId: 'trpg' })).data.note).toMatchObject({ notebookId: 'campaign~trpg', content: expect.stringContaining('Campaign') });
    expect((await call('read_note', { path: 'notes/life/note.md', notebookId: 'life' })).data.note).toMatchObject({ notebookId: life, content: expect.stringContaining('Home') });
    expect((await call('list_notes', {})).data.notes.map((note: { notebookId: string; }) => note.notebookId).sort()).toEqual(['campaign~trpg', life].sort());
    expect((await call('read_note', { path: 'notes/life/note.md', notebookId: 'missing~trpg' })).isError).toBe(true);
    expect((await call('read_note', { path: 'notes/life/note.md', notebookId: 'missing' })).isError).toBe(true);
  } finally {
    await client.close();
    await server.close();
  }
});

/** A client connected to a stdio server whose workspace comes from the deployment environment `env`. */
async function deploymentClient(productRoot: string, env: NodeJS.ProcessEnv) {
  const server = createMCPServer(productRoot, deploymentConfigSource(productRoot, env));
  const client = new Client({ name: 'fixture', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  const call = async (name: string, args: Record<string, unknown>) => {
    const result = await client.callTool({ name, arguments: args }) as { isError?: boolean; content: { text: string; }[]; };
    return { isError: result.isError, data: JSON.parse(result.content[0].text) };
  };
  return {
    call,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}

it('serves a local source that is a folder inside a Git worktree, as the examples workspace is', async () => {
  const root = worktree({ 'sub/.mygitnotes.yaml': manifest('life', 'notes/life'), 'sub/notes/life/note.md': '# Life\n' });
  const { call, close } = await deploymentClient(root, { MYGITNOTES_SOURCE: 'local', MYGITNOTES_LOCAL_PATH: path.join(root, 'sub') });
  try {
    expect((await call('list_notebooks', {})).data.notebooks.map((notebook: { id: string; }) => notebook.id)).toEqual(['life']);
    expect((await call('get_workspace_config', {})).data.config.workspace.default_notebook).toBe('sub~life');
    expect((await call('read_note', { path: 'notes/life/note.md', notebookId: 'life' })).data.note.content).toContain('Life');
  } finally {
    await close();
  }
});

it('fails every tool with the reason when the local source does not exist, instead of listing no notebooks', async () => {
  const root = worktree({ 'README.md': '# Product\n' });
  const { call, close } = await deploymentClient(root, { MYGITNOTES_SOURCE: 'local', MYGITNOTES_LOCAL_PATH: path.join(root, 'missing') });
  try {
    const listed = await call('list_notebooks', {});
    expect(listed.isError).toBe(true);
    expect(listed.data.error).toContain('missing');
  } finally {
    await close();
  }
});
