import { afterEach, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { repositoryRef, type WorkspaceConfigSource } from '@mygitnotes/core';
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

it('stdio resolves identical note paths, merges listings, reports both statuses, and commits only the selected notebook', async () => {
  const home = worktree({ '.mygitnotes.yaml': 'schema_version: 3\nworkspace:\n  title: Test\n  default_notebook: home\nnotebooks:\n  - id: home\n    title: Home\n    root: notes/shared\n  - id: other\n    title: Other\n    root: notes/shared\n    source: { type: github, repository: owner/other }\n', 'notes/shared/note.md': '# Home\n', 'AGENTS.md': '# Home rules\n' });
  const other = worktree({ 'notes/shared/note.md': '# Other\n' });
  const source: WorkspaceConfigSource = { mode: 'local', settings: async () => ({ home: repositoryRef({ type: 'local', path: home }), localPath: ref => ref.id === 'github:owner/other@main' ? other : undefined, manifest: inHome => inHome() }) };
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
