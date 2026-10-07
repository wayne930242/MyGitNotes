import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { agentFileAllowed, agentWorkspaceFile, agentWorkspaces, listAgentWorkspaceFiles, resolveAgentFile } from '../src/agent-workspace.js';
import type { NotebookConfig } from '../src/types.js';

const notebooks = [{ id: 'blog', title: 'Blog', root: 'blog/src/posts', assets: 'assets' }, { id: 'life', title: 'Life', root: 'notes/life' }] as NotebookConfig[];

describe('agent workspace files', () => {
  it('names core instructions in the root, notebook roots, their ancestors and folders inside notebooks', () => {
    for (const [file, folder] of [['AGENTS.md', ''], ['blog/AGENTS.md', 'blog'], ['blog/src/posts/AGENTS.md', 'blog/src/posts'], ['notes/life/trips/AGENTS.md', 'notes/life/trips']]) {
      expect(agentWorkspaceFile(file, notebooks)).toEqual({ path: file, folder, kind: 'instructions' });
    }
    for (const file of ['apps/web/AGENTS.md', 'blog/src/posts/assets/AGENTS.md', '.github/AGENTS.md', 'notes/life/.hidden/AGENTS.md', 'notes/life/docs/agent/AGENTS.md', '../AGENTS.md', 'blog//AGENTS.md']) {
      expect(agentWorkspaceFile(file, notebooks)).toBeUndefined();
    }
  });

  it('names a skill entry, its reference files and its scripts', () => {
    expect(agentWorkspaceFile('blog/.agents/skills/proofread/SKILL.md', notebooks)).toEqual({ path: 'blog/.agents/skills/proofread/SKILL.md', folder: 'blog', kind: 'skill', skill: 'proofread' });
    expect(agentWorkspaceFile('.agents/skills/proofread/references/style.md', notebooks)).toMatchObject({ folder: '', kind: 'reference', skill: 'proofread' });
    expect(agentWorkspaceFile('.agents/skills/proofread/guide.txt', notebooks)).toMatchObject({ kind: 'reference' });
    expect(agentWorkspaceFile('.agents/skills/proofread/scripts/check.sh', notebooks)).toMatchObject({ kind: 'script', skill: 'proofread' });
    expect(agentWorkspaceFile('.agents/skills/proofread/scripts/lib/util.py', notebooks)).toMatchObject({ kind: 'script' });
    for (const file of ['.agents/skills/proofread/run.sh', '.agents/skills/proofread/.env', '.agents/skills/proofread/scripts/.secret.sh', '.agents/skills/proofread/scripts/tool.exe', '.agents/skills/.hidden/SKILL.md', '.agents/skills/proofread/node_modules/x.md', '.claude/skills/proofread/SKILL.md', 'apps/.agents/skills/x/SKILL.md']) {
      expect(agentWorkspaceFile(file, notebooks)).toBeUndefined();
    }
  });

  it('still lets Git reach the files other tools keep, without opening runtime settings', () => {
    expect(agentFileAllowed('.claude/skills/review/SKILL.md', notebooks)).toBe(true);
    expect(agentFileAllowed('blog/.agents/skills/x/scripts/a.sh', notebooks)).toBe(true);
    expect(agentFileAllowed('.codex/auth.json', notebooks)).toBe(false);
  });

  it('lists the root first, every instructed folder, and the workspaces each one sits inside', () => {
    const files = ['blog/AGENTS.md', 'blog/src/posts/AGENTS.md', 'notes/life/.agents/skills/x/SKILL.md'].map(file => agentWorkspaceFile(file, notebooks)!);
    expect(agentWorkspaces(files)).toEqual([{ folder: '', hasInstructions: false, parents: [] }, { folder: 'blog', hasInstructions: true, parents: [''] }, { folder: 'blog/src/posts', hasInstructions: true, parents: ['', 'blog'] }]);
  });
});

describe('listing a worktree', () => {
  let root = '';
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));
  const write = (file: string, content = 'x') => {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), content);
  };

  it('walks only workspace folders and skill folders, skipping symlinks', () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-workspace-'));
    for (const file of ['AGENTS.md', '.agents/skills/a/SKILL.md', '.agents/skills/a/references/r.md', '.agents/skills/a/scripts/s.sh', 'blog/AGENTS.md', 'blog/.agents/skills/b/SKILL.md', 'apps/AGENTS.md', 'notes/life/trips/AGENTS.md', 'notes/life/trips/day.md', 'outside/secret.md']) write(file);
    fs.symlinkSync(path.join(root, 'outside'), path.join(root, '.agents/skills/linked'));
    expect(listAgentWorkspaceFiles(root, notebooks).map(file => file.path)).toEqual(['.agents/skills/a/references/r.md', '.agents/skills/a/scripts/s.sh', '.agents/skills/a/SKILL.md', 'AGENTS.md', 'blog/.agents/skills/b/SKILL.md', 'blog/AGENTS.md', 'notes/life/trips/AGENTS.md']);
    expect(() => resolveAgentFile(root, '.agents/skills/linked/secret.md', notebooks)).toThrow(/symlinks/);
    expect(() => resolveAgentFile(root, 'outside/secret.md', notebooks)).toThrow(/not an agent workspace file/);
  });
});
