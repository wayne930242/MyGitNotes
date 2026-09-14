import { it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

it('rejects tracked Agent settings on Core while allowing main to track them normally', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'github-notes-ownership-'));
  const git = (...args: string[]) => execFileSync('git', args, {cwd:root,stdio:'pipe'});
  const check = () => execFileSync(process.execPath, [path.resolve('scripts/check-core-ownership.mjs')], {cwd:root,stdio:'pipe'});
  try {
    git('init','-b','core'); git('config','user.name','Test'); git('config','user.email','test@example.com');
    fs.writeFileSync(path.join(root,'README.md'),'Product'); git('add','.'); git('commit','-m','fixture');
    expect(() => check()).not.toThrow();
    fs.writeFileSync(path.join(root,'.github-notes-screen.yaml'),'version: 1\nrows: []\n'); git('add','.');
    expect(() => check()).toThrow();
    git('rm','-f','--','.github-notes-screen.yaml');
    fs.writeFileSync(path.join(root,'.github-notes-study.yaml'),'version: 1\nnotes: []\nevents: []\n'); git('add','.');
    expect(() => check()).toThrow();
    git('rm','-f','--','.github-notes-study.yaml');
    fs.mkdirSync(path.join(root,'.agents/skills/custom'),{recursive:true});
    fs.writeFileSync(path.join(root,'.agents/skills/custom/SKILL.md'),'# Skill');
    fs.writeFileSync(path.join(root,'AGENTS.md'),'# Workspace rules'); git('add','.');
    expect(() => check()).toThrow();
    git('checkout','-b','main'); git('commit','-m','workspace settings');
    expect(() => check()).not.toThrow();
    expect(git('ls-files','--','AGENTS.md').toString().trim()).toBe('AGENTS.md');
  } finally { fs.rmSync(root,{recursive:true,force:true}); }
});
