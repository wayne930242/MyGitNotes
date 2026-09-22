import { afterEach, expect, it, vi } from 'vitest';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { createMCPServer } from '../src/server.js';
import { gitlabFixture } from '../../core/tests/fixtures/gitlab.js';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
it('routes a GitLab stdio source to public read tools and never exposes local write tools', async () => {
  vi.stubEnv('GITHUB_NOTES_SOURCE', 'gitlab');
  vi.stubEnv('GITHUB_NOTES_REPOSITORY', 'group/subgroup/project');
  vi.stubEnv('GITHUB_NOTES_BRANCH', 'main');
  vi.stubEnv('GITLAB_URL', 'https://gitlab.example.test/gitlab');
  const fixture = gitlabFixture();
  fixture.public();
  vi.spyOn(globalThis, 'fetch').mockImplementation(fixture.request);
  const server = createMCPServer('/tmp');
  const client = new Client({ name: 'test', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    const { tools } = await client.listTools();
    expect(tools.some(t => t.name === 'read')).toBe(true);
    expect(tools.some(t => t.name === 'save_note' || t.name === 'git_commit' || t.name === 'update_core')).toBe(false);
    const result = await client.callTool({ name: 'read', arguments: { path: 'notes/ex/a.md' } });
    expect(result.isError).not.toBe(true);
    expect(JSON.stringify(result)).toContain('Alpha');
    const denied = await client.callTool({ name: 'write', arguments: { path: 'notes/ex/a.md', content: 'bad', revision: fixture.head } });
    expect(denied.isError).toBe(true);
    expect(fixture.writes).toBe(0);
  } finally {
    await client.close();
    await server.close();
  }
});
it('renders a configured notebook template through the read-only MCP tool without writing anything', async () => {
  vi.stubEnv('GITHUB_NOTES_SOURCE', 'gitlab');
  vi.stubEnv('GITHUB_NOTES_REPOSITORY', 'group/subgroup/project');
  vi.stubEnv('GITHUB_NOTES_BRANCH', 'main');
  vi.stubEnv('GITLAB_URL', 'https://gitlab.example.test/gitlab');
  const fixture = gitlabFixture();
  fixture.public();
  fixture.files.set('notes/.github-notes.yaml', fixture.files.get('notes/.github-notes.yaml') + '    templates:\n      - id: reading\n        title: Reading\n        file: .templates/reading.md\n');
  fixture.files.set('notes/ex/.templates/reading.md', '---\ntitle: "{{title}}"\nstatus: unread\n---\n\n# {{title}}\n');
  vi.spyOn(globalThis, 'fetch').mockImplementation(fixture.request);
  const server = createMCPServer('/tmp');
  const client = new Client({ name: 'test', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    const { tools } = await client.listTools();
    const tool = tools.find(t => t.name === 'render_template');
    expect(tool?.annotations?.readOnlyHint).toBe(true);
    const result = await client.callTool({ name: 'render_template', arguments: { notebookId: 'ex', templateId: 'reading', title: 'Via MCP' } });
    expect(result.isError).not.toBe(true);
    expect(fixture.writes).toBe(0);
    const payload = JSON.parse((result.content as { type: string; text: string; }[])[0].text);
    expect(payload.metadata.title).toBe('Via MCP');
    expect(payload.metadata.status).toBe('unread');
    expect(payload.content).toContain('# Via MCP');
    const notes = await client.callTool({ name: 'list_notes', arguments: { notebookId: 'ex' } });
    expect(JSON.stringify(notes)).not.toContain('.templates');
  } finally {
    await client.close();
    await server.close();
  }
});
it('pages list_notes over bounded summaries that carry a description instead of the note body', async () => {
  vi.stubEnv('GITHUB_NOTES_SOURCE', 'gitlab');
  vi.stubEnv('GITHUB_NOTES_REPOSITORY', 'group/subgroup/project');
  vi.stubEnv('GITHUB_NOTES_BRANCH', 'main');
  vi.stubEnv('GITLAB_URL', 'https://gitlab.example.test/gitlab');
  const fixture = gitlabFixture();
  fixture.public();
  fixture.files.set('notes/ex/described.md', '---\ndescription: A stated summary\n---\n# Described\n\nBody text that must never be listed.\n');
  fixture.files.set('notes/ex/long.md', `---\ntags: [x]\n---\n# Long\n\n${'x'.repeat(400)}\n`);
  vi.spyOn(globalThis, 'fetch').mockImplementation(fixture.request);
  const server = createMCPServer('/tmp');
  const client = new Client({ name: 'test', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    const blobReads = () => fixture.calls.filter(call => call.url.includes('/repository/blobs/')).length;
    const before = blobReads();
    const first = await client.callTool({ name: 'list_notes', arguments: { notebookId: 'ex', limit: 2 } });
    // A page of 2 reads the manifest and those 2 notes; the other notebook files are never fetched.
    expect(blobReads() - before).toBeLessThanOrEqual(3);
    expect(first.isError).not.toBe(true);
    const head = JSON.parse((first.content as { type: string; text: string; }[])[0].text);
    expect(head.total).toBe(4);
    expect(head.count).toBe(2);
    expect(head.nextOffset).toBe(2);
    expect(head.notes.map((note: { path: string; }) => note.path)).toEqual(['notes/ex/a.md', 'notes/ex/described.md']);
    expect(head.notes.every((note: Record<string, unknown>) => !('content' in note))).toBe(true);
    expect(JSON.stringify(head)).not.toContain('Body text that must never be listed');
    expect(head.notes[1].description).toBe('A stated summary');

    const rest = await client.callTool({ name: 'list_notes', arguments: { notebookId: 'ex', offset: 2, limit: 2 } });
    const tail = JSON.parse((rest.content as { type: string; text: string; }[])[0].text);
    expect(tail.nextOffset).toBe(null);
    expect(tail.notes.map((note: { path: string; }) => note.path)).toEqual(['notes/ex/folder/b.md', 'notes/ex/long.md']);
    expect(tail.notes[1].description).toBe('x'.repeat(240));
  } finally {
    await client.close();
    await server.close();
  }
});
