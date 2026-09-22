import { describe, expect, it } from 'vitest';
import { agentSkillLocation, renamedAgentSkillPath, rewriteAgentSkillReferences, validateAgentSkillSlug } from '../src/agent-skill-metadata.js';

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

  it('builds the renamed entry path and rewrites exact references', () => {
    expect(renamedAgentSkillPath('.agents/skills/old-name/SKILL.md', 'new-name')).toBe('.agents/skills/new-name/SKILL.md');
    expect(rewriteAgentSkillReferences('Use $old-name at `.agents/skills/old-name/SKILL.md`; keep old-name-extra.', '.agents/skills/old-name', '.agents/skills/new-name', 'old-name', 'new-name')).toBe('Use $new-name at `.agents/skills/new-name/SKILL.md`; keep old-name-extra.');
  });
});
