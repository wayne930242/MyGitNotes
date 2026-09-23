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

  it('preserves a hidden flow-mapping key byte-for-byte when editing an exposed field', () => {
    const original = '---\nname: review\ndescription: Review prose\ncustom: {x: 1,y: 2}\n---\n# Review\n';
    const updated = updateSkillMetadata(original, 'description', 'Review clear prose');
    expect(updated).toBe('---\nname: review\ndescription: Review clear prose\ncustom: {x: 1,y: 2}\n---\n# Review\n');
  });

  it('preserves CRLF line endings on every untouched line when editing an exposed field', () => {
    const original = '---\r\nname: review\r\ndescription: Review prose\r\ncustom: keep\r\n---\r\n# Review\r\nBody.\r\n';
    const updated = updateSkillMetadata(original, 'description', 'Review clear prose');
    expect(updated).toBe('---\r\nname: review\r\ndescription: Review clear prose\r\ncustom: keep\r\n---\r\n# Review\r\nBody.\r\n');
  });

  it('emits valid, indented YAML when a textarea edit turns the description multiline', () => {
    const original = '---\nname: review\ndescription: Review prose\ncustom: keep\n---\n# Review\n';
    const updated = updateSkillMetadata(original, 'description', 'Line one\nLine two');
    expect(updated).toBe('---\nname: review\ndescription: |-\n  Line one\n  Line two\ncustom: keep\n---\n# Review\n');
    expect(readSkillMetadata(updated)).toEqual({ title: 'review', description: 'Line one\nLine two' });
  });

  it('keeps a trailing comment attached to its own header line, not folded into the new multiline content', () => {
    const original = '---\nname: review\ndescription: Review prose # keep\ncustom: keep\n---\n# Review\n';
    const updated = updateSkillMetadata(original, 'description', 'Line one\nLine two');
    expect(updated).toBe('---\nname: review\ndescription: |- # keep\n  Line one\n  Line two\ncustom: keep\n---\n# Review\n');
    expect(readSkillMetadata(updated)).toEqual({ title: 'review', description: 'Line one\nLine two' });
  });
});
