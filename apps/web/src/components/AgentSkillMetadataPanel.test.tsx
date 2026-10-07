// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { I18nProvider } from '../lib/i18n/index.js';
import { AgentSkillMetadataPanel, readSkillFrontmatter, withSkillFrontmatterSource, withSkillMetadata } from './AgentSkillMetadataPanel.js';

afterEach(cleanup);

describe('skill metadata helpers', () => {
  it('reads the frontmatter as an object with its source text', () => {
    expect(readSkillFrontmatter('---\nname: review\ndescription: Review prose\ncustom: keep\n---\n# Review\n')).toEqual({ metadata: { name: 'review', description: 'Review prose', custom: 'keep' }, source: 'name: review\ndescription: Review prose\ncustom: keep' });
    expect(readSkillFrontmatter('# Skill\n')).toEqual({ metadata: {}, source: '' });
  });

  it('changes one field without dropping other metadata or the body', () => {
    const original = '---\nname: review\ndescription: Review prose\ncustom: keep\n---\n# Review\n';
    expect(withSkillMetadata(original, { name: 'review', description: 'Review clear prose', custom: 'keep' })).toBe('---\nname: review\ndescription: Review clear prose\ncustom: keep\n---\n# Review\n');
  });

  it('adds and removes fields, as the form does', () => {
    const original = '---\nname: review\ndescription: x\n---\n# Review\n';
    const added = withSkillMetadata(original, { name: 'review', description: 'x', license: 'MIT' });
    expect(readSkillFrontmatter(added).metadata).toEqual({ name: 'review', description: 'x', license: 'MIT' });
    expect(withSkillMetadata(added, { name: 'review', description: 'x' })).toBe(original);
  });

  it('creates frontmatter for a skill that has none', () => {
    expect(withSkillMetadata('# Skill\n', { description: 'Does things' })).toBe('---\ndescription: Does things\n---\n\n# Skill\n');
  });

  it('leaves malformed frontmatter untouched and reports it', () => {
    const malformed = '---\nname: [broken\n---\n# Skill\n';
    expect(readSkillFrontmatter(malformed).error).toBeTruthy();
    expect(withSkillMetadata(malformed, { name: 'skill' })).toBe(malformed);
  });

  it('keeps hidden keys, CRLF line endings and comments byte for byte', () => {
    expect(withSkillMetadata('---\nname: review\ndescription: Review prose\ncustom: {x: 1,y: 2}\n---\n# Review\n', { name: 'review', description: 'Review clear prose', custom: { x: 1, y: 2 } })).toBe('---\nname: review\ndescription: Review clear prose\ncustom: {x: 1,y: 2}\n---\n# Review\n');
    expect(withSkillMetadata('---\r\nname: review\r\ndescription: Review prose\r\ncustom: keep\r\n---\r\n# Review\r\nBody.\r\n', { name: 'review', description: 'Review clear prose', custom: 'keep' })).toBe('---\r\nname: review\r\ndescription: Review clear prose\r\ncustom: keep\r\n---\r\n# Review\r\nBody.\r\n');
    const multiline = withSkillMetadata('---\nname: review\ndescription: Review prose # keep\ncustom: keep\n---\n# Review\n', { name: 'review', description: 'Line one\nLine two', custom: 'keep' });
    expect(multiline).toBe('---\nname: review\ndescription: |- # keep\n  Line one\n  Line two\ncustom: keep\n---\n# Review\n');
  });

  it('replaces the whole block from the YAML view, keeping the body', () => {
    expect(withSkillFrontmatterSource('---\nname: a\n---\n# Body\n', 'name: a\n# note\nlicense: MIT\n')).toBe('---\nname: a\n# note\nlicense: MIT\n---\n# Body\n');
    expect(withSkillFrontmatterSource('# Body\n', 'name: a')).toBe('---\nname: a\n---\n\n# Body\n');
  });
});

describe('AgentSkillMetadataPanel', () => {
  const content = '---\nname: review\ndescription: Review prose\nlicense: MIT\n---\n# Review\n';
  const panel = (onChange = vi.fn(), onRename = vi.fn(async () => {})) => {
    render(
      <I18nProvider>
        <AgentSkillMetadataPanel content={content} disabled={false} path='blog/.agents/skills/review/SKILL.md' renaming={false} onChange={onChange} onRename={onRename} />
      </I18nProvider>,
    );
    return { onChange, onRename };
  };

  it('edits the description and other fields like a note, and renames the skill from its name', () => {
    const { onChange, onRename } = panel();
    expect(screen.getByRole('button', { name: 'Form' })).toBeInTheDocument();
    expect(screen.getByLabelText('license')).toHaveValue('MIT');
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Review clear prose' } });
    expect(onChange).toHaveBeenLastCalledWith('---\nname: review\ndescription: Review clear prose\nlicense: MIT\n---\n# Review\n');
    const name = screen.getByLabelText('Name');
    expect(name).toHaveValue('review');
    fireEvent.change(name, { target: { value: 'proofread' } });
    fireEvent.keyDown(name, { key: 'Enter' });
    expect(onRename).toHaveBeenCalledWith('proofread');
  });
});
