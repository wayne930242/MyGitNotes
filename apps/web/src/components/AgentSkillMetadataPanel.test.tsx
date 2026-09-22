import { describe, expect, it } from 'vitest';
import { readSkillMetadata, updateSkillMetadata } from './AgentSkillMetadataPanel.js';

describe('AgentSkillMetadataPanel metadata helpers', () => {
  it('reads skill name and description', () => {
    expect(readSkillMetadata('---\nname: review\ndescription: Review prose\ncustom: keep\n---\n# Review\n')).toEqual({ title: 'review', description: 'Review prose' });
  });

  it('updates a dedicated field without dropping custom metadata or body content', () => {
    const original = '---\nname: review\ndescription: Review prose\ncustom: keep\n---\n# Review\n';
    const updated = updateSkillMetadata(original, 'description', 'Review clear prose');
    expect(updated).toContain('name: review');
    expect(updated).toContain('description: Review clear prose');
    expect(updated).toContain('custom: keep');
    expect(updated).toContain('# Review\n');
  });

  it('creates frontmatter for a skill that has none', () => {
    expect(updateSkillMetadata('# Skill\n', 'name', 'skill')).toBe('---\nname: skill\n---\n\n# Skill\n');
  });

  it('keeps malformed frontmatter available in the source editor without crashing or overwriting it', () => {
    const malformed = '---\nname: [broken\n---\n# Skill\n';
    expect(readSkillMetadata(malformed)).toEqual({ title: '', description: '' });
    expect(updateSkillMetadata(malformed, 'name', 'skill')).toBe(malformed);
  });
});
