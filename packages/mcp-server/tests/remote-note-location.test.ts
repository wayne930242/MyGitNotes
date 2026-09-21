import { expect, it } from 'vitest';
import { GitLabSource } from '@mygitnotes/core';
import { callRemoteTool } from '../src/remote-tools.js';
import { gitlabFixture } from '../../core/tests/fixtures/gitlab.js';

const reader = (f: ReturnType<typeof gitlabFixture>) => new GitLabSource('https://gitlab.example.test/gitlab', 'group/subgroup/project', 'main', 'fixture-token', f.request);

it('reports the path and web page of every note it creates or updates', async () => {
  const f = gitlabFixture();
  const app = 'https://notes.example.test/';
  const written = await callRemoteTool(reader(f), 'write', { path: 'notes/ex/研究 100%.md', content: '# New\n', revision: f.head }, true, app);
  expect(written).toMatchObject({ path: 'notes/ex/研究 100%.md', url: 'https://notes.example.test/notebooks/ex/notes/%E7%A0%94%E7%A9%B6%20100%25.md' });
  expect(await callRemoteTool(reader(f), 'append', { path: 'notes/ex/a.md', content: 'more\n', revision: f.head }, true, app)).toMatchObject({ path: 'notes/ex/a.md', url: 'https://notes.example.test/notebooks/ex/notes/a.md' });
  expect(await callRemoteTool(reader(f), 'edit', { path: 'notes/ex/a.md', startLine: 1, endLine: 0, content: 'top\n', revision: f.head }, true, app)).toMatchObject({ path: 'notes/ex/a.md', url: 'https://notes.example.test/notebooks/ex/notes/a.md' });
  expect(await callRemoteTool(reader(f), 'save_note', { path: 'notes/ex/folder/c.md', content: '# C', revision: f.head }, true, app)).toMatchObject({ path: 'notes/ex/folder/c.md', url: 'https://notes.example.test/notebooks/ex/notes/folder/c.md' });
  expect(await callRemoteTool(reader(f), 'update_note_metadata', { path: 'notes/ex/folder/b.md', status: 'done' }, true, app)).toMatchObject({ path: 'notes/ex/folder/b.md', url: 'https://notes.example.test/notebooks/ex/notes/folder/b.md' });
});

it('reports only the path without a known app origin or for folder metadata', async () => {
  const f = gitlabFixture();
  const saved = await callRemoteTool(reader(f), 'save_note', { path: 'notes/ex/d.md', content: '# D', revision: f.head }, true);
  expect(saved.path).toBe('notes/ex/d.md');
  expect(saved).not.toHaveProperty('url');
  const folder = await callRemoteTool(reader(f), 'write', { path: 'notes/ex/folder/_dir.yml', content: 'title: Renamed\n', revision: f.head }, true, 'https://notes.example.test');
  expect(folder.path).toBe('notes/ex/folder/_dir.yml');
  expect(folder).not.toHaveProperty('url');
});

it('points a note read to its agent system and reports a skill write without a web page', async () => {
  const f = gitlabFixture();
  const app = 'https://notes.example.test';
  expect(await callRemoteTool(reader(f), 'read', { path: 'notes/ex/a.md' }, false, app)).toMatchObject({ hint: 'Before creating or editing notes here, read the agent system: call get_system_prompt and list_skills with path "notes/ex/a.md".' });
  expect(await callRemoteTool(reader(f), 'read_note', { path: 'notes/ex/a.md' }, false, app)).toMatchObject({ note: { path: 'notes/ex/a.md' }, hint: expect.stringContaining('notes/ex/a.md') });
  const skill = await callRemoteTool(reader(f), 'write', { path: 'notes/ex/.agents/skills/demo/SKILL.md', content: '---\ndescription: Demo\n---\nDemo body\n', revision: f.head }, true, app);
  expect(skill).toMatchObject({ path: 'notes/ex/.agents/skills/demo/SKILL.md', commit: { message: 'docs(skills): write SKILL.md' } });
  expect(skill).not.toHaveProperty('url');
  expect(await callRemoteTool(reader(f), 'read', { path: 'notes/ex/.agents/skills/demo/SKILL.md' }, false, app)).not.toHaveProperty('hint');
  expect(await callRemoteTool(reader(f), 'list_skills', { path: 'notes/ex/a.md' }, false, app)).toMatchObject({ target: 'notes/ex', skills: [{ name: 'demo', description: 'Demo', path: 'notes/ex/.agents/skills/demo/SKILL.md' }] });
  expect(await callRemoteTool(reader(f), 'get_system_prompt', { notebookId: 'ex' }, false, app)).toMatchObject({ files: [{ path: 'AGENTS.md', content: '# Workspace\n' }] });
  await expect(callRemoteTool(reader(f), 'write', { path: '.agents/skills/demo/SKILL.md', content: 'x', revision: f.head }, false, app)).rejects.toThrow(/read-only/);
});
