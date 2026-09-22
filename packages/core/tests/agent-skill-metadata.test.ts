import YAML from 'yaml';
import { describe, expect, it } from 'vitest';
import { agentSkillLocation, newAgentSkillEntryContent, newAgentSkillEntryPath, renameAgentSkillEntryContent, renamedAgentSkillPath, rewriteAgentSkillReferences, splitAgentSkillContent, validateAgentSkillSlug } from '../src/agent-skill-metadata.js';

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
    const descendantReferences = [`${oldDirectory}/SKILL.md`, `${oldDirectory}/nested/file.md`, `${oldDirectory}/`].join(' ');
    expect(rewriteAgentSkillReferences(descendantReferences, oldDirectory, newDirectory)).toBe(descendantReferences.replaceAll(oldDirectory, newDirectory));

    const nonDescendantReferences = [...['runner', 'run-extra', 'run_legacy', 'run.old', 'run legacy'].map(slug => `.agents/skills/${slug}/SKILL.md`), oldDirectory].join(' ');
    expect(rewriteAgentSkillReferences(nonDescendantReferences, oldDirectory, newDirectory)).toBe(nonDescendantReferences);
  });

  it('rewrites only complete path tokens for the renamed skill scope', () => {
    const rootDirectory = '.agents/skills/run';
    const notebookDirectory = `my-notes/${rootDirectory}`;
    const rootReference = `${rootDirectory}/SKILL.md`;
    const notebookReference = `${notebookDirectory}/SKILL.md`;

    expect(rewriteAgentSkillReferences(notebookReference, rootDirectory, '.agents/skills/execute')).toBe(notebookReference);
    expect(rewriteAgentSkillReferences(`${notebookReference} ${rootReference}`, notebookDirectory, 'my-notes/.agents/skills/execute')).toBe(`my-notes/.agents/skills/execute/SKILL.md ${rootReference}`);
    expect(rewriteAgentSkillReferences(`[x](${notebookReference})`, notebookDirectory, 'my-notes/.agents/skills/execute')).toBe('[x](my-notes/.agents/skills/execute/SKILL.md)');
    for (const delimiter of [' ', '"', "'", '`', '(', ')', '[', ']', '{', '}', '<', '>', ',', ';', '|']) {
      expect(rewriteAgentSkillReferences(`${delimiter}${rootReference}`, rootDirectory, '.agents/skills/execute')).toBe(`${delimiter}.agents/skills/execute/SKILL.md`);
    }
  });

  it('updates only the renamed skill entry frontmatter name and path references', () => {
    const content = '---\nname: run\ndescription: Run the tests, then run lint.\ncustom: keep\n---\nUse $run at `.agents/skills/run/SKILL.md`.\n';
    expect(renameAgentSkillEntryContent(content, '.agents/skills/run', '.agents/skills/execute', 'execute')).toBe('---\nname: execute\ndescription: Run the tests, then run lint.\ncustom: keep\n---\nUse $run at `.agents/skills/execute/SKILL.md`.\n');
  });

  it('splits frontmatter from body, round-tripping a key the panel does not expose and CRLF line endings', () => {
    const content = '---\r\nname: review\r\ndescription: Review prose\r\ncustom: keep\r\n---\r\n# Review\r\nBody text.\r\n';
    const split = splitAgentSkillContent(content);
    expect(split.body).toBe('# Review\r\nBody text.\r\n');
    expect(split.frontmatter).not.toContain('# Review');
    expect(split.frontmatter + split.body).toBe(content);
    expect(split.lineNumberOffset).toBe(5);

    const editedBody = split.body.replace('Body text.', 'Edited body.');
    const merged = split.frontmatter + editedBody;
    expect(merged).toContain('custom: keep');
    expect(merged).toContain('Edited body.');
  });

  it('treats a file with no frontmatter as all body', () => {
    expect(splitAgentSkillContent('# Skill\nBody\n')).toEqual({ frontmatter: '', body: '# Skill\nBody\n', lineNumberOffset: 0 });
  });

  it('builds a new skill entry path from a validated slug', () => {
    expect(newAgentSkillEntryPath('daily-writing')).toBe('.agents/skills/daily-writing/SKILL.md');
    expect(() => newAgentSkillEntryPath('Bad Slug')).toThrow();
  });

  it('builds a minimal, immediately valid skeleton for a new skill', () => {
    const content = newAgentSkillEntryContent('daily-writing');
    const split = splitAgentSkillContent(content);
    expect(split.frontmatter).not.toBe('');
    const metadata = YAML.parse(split.frontmatter.replace(/^---\n/, '').replace(/\n---\n$/, ''));
    expect(metadata).toEqual({ name: 'daily-writing', description: '' });
    expect(split.body).toBe('\n# daily-writing\n');
  });
});
