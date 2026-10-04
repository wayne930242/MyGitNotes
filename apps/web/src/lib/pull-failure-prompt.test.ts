import { describe, expect, it } from 'vitest';
import { pullFailurePrompt } from './pull-failure-prompt.js';

describe('pullFailurePrompt', () => {
  it('asks the agent to pop and resolve a conflicting stash without committing', () => {
    const prompt = pullFailurePrompt({ code: 'STASH_CONFLICT', message: 'conflict', files: ['notes/a.md'] }, '/work/notes');
    expect(prompt).toContain('/work/notes');
    expect(prompt).toContain('stash@{0}');
    expect(prompt).toContain('git stash pop');
    expect(prompt).toContain('- notes/a.md');
    expect(prompt).toContain('Do not push');
  });

  it('asks the agent to rebase through a conflict with local commits', () => {
    const prompt = pullFailurePrompt({ code: 'CONFLICT', message: 'conflict', files: ['notes/a.md'] }, '/work/notes');
    expect(prompt).toContain('git pull --rebase');
    expect(prompt).toContain('git rebase --continue');
  });

  it('passes any other error message through for diagnosis', () => {
    const prompt = pullFailurePrompt({ code: 'FAILED', message: 'Could not resolve host: github.com', files: [] }, '');
    expect(prompt).toContain('my MyGitNotes workspace repository');
    expect(prompt).toContain('Could not resolve host: github.com');
    expect(prompt).not.toContain('Conflicting files');
  });
});
