import { describe, expect, it } from 'vitest';
import { agentSkillLocation, renamedAgentSkillPath, renameAgentSkillEntryContent, rewriteAgentSkillReferences, validateAgentSkillSlug } from '../src/agent-skill-metadata.js';

describe('agent skill metadata', () => {
  it('recognizes native directory-backed SKILL.md files', () => {
    expect(agentSkillLocation('.agents/skills/daily-writing/SKILL.md')).toEqual({ directory: '.agents/skills/daily-writing', parent: '.agents/skills', slug: 'daily-writing' });
    expect(agentSkillLocation('.claude/skills/review/SKILL.md')?.slug).toBe('review');
    expect(agentSkillLocation('AGENTS.md')).toBeUndefined();
    expect(agentSkillLocation('.agents/skills/flat.md')).toBeUndefined();
  });

  it('accepts canonical slugs and rejects unsafe or ambiguous names', () => {
    expect(validateAgentSkillSlug('daily-writing')).toBe('daily-writing');
    for (const value of ['Daily-writing', 'daily_writing', '../daily', 'daily--writing', '']) expect(() => validateAgentSkillSlug(value)).toThrow();
  });

  it('builds the renamed entry path and rewrites only path-shaped references', () => {
    expect(renamedAgentSkillPath('.agents/skills/old-name/SKILL.md', 'new-name')).toBe('.agents/skills/new-name/SKILL.md');
    const oldDirectory = '.agents/skills/run';
    const newDirectory = '.agents/skills/execute';
    const legitimateReferences = [
      `${oldDirectory}\n`,
      `${oldDirectory}"`,
      `${oldDirectory}\``,
      `${oldDirectory},`,
      `${oldDirectory})`,
      `${oldDirectory}/SKILL.md`,
    ].join(' ');
    expect(rewriteAgentSkillReferences(legitimateReferences, oldDirectory, newDirectory)).toBe(legitimateReferences.replaceAll(oldDirectory, newDirectory));

    const adjacentDirectories = ['runner', 'run-extra', 'run_legacy', 'run.old'].map(slug => `.agents/skills/${slug}/SKILL.md`).join(' ');
    expect(rewriteAgentSkillReferences(adjacentDirectories, oldDirectory, newDirectory)).toBe(adjacentDirectories);
  });

  it('updates only the renamed skill entry frontmatter name and path references', () => {
    const content = '---\nname: run\ndescription: Run the tests, then run lint.\ncustom: keep\n---\nUse $run at `.agents/skills/run/SKILL.md`.\n';
    expect(renameAgentSkillEntryContent(content, '.agents/skills/run', '.agents/skills/execute', 'execute')).toBe('---\nname: execute\ndescription: Run the tests, then run lint.\ncustom: keep\n---\nUse $run at `.agents/skills/execute/SKILL.md`.\n');
  });
});
