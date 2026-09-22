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
    const descendantReferences = [`${oldDirectory}/SKILL.md`, `${oldDirectory}/nested/file.md`, `${oldDirectory}/`].join(' ');
    expect(rewriteAgentSkillReferences(descendantReferences, oldDirectory, newDirectory)).toBe(descendantReferences.replaceAll(oldDirectory, newDirectory));

    const nonDescendantReferences = [
      ...['runner', 'run-extra', 'run_legacy', 'run.old', 'run legacy'].map(slug => `.agents/skills/${slug}/SKILL.md`),
      oldDirectory,
    ].join(' ');
    expect(rewriteAgentSkillReferences(nonDescendantReferences, oldDirectory, newDirectory)).toBe(nonDescendantReferences);
  });

  it('rewrites only complete path tokens for the renamed skill scope', () => {
    const rootDirectory = '.agents/skills/run';
    const notebookDirectory = `my-notes/${rootDirectory}`;
    const rootReference = `${rootDirectory}/SKILL.md`;
    const notebookReference = `${notebookDirectory}/SKILL.md`;

    expect(rewriteAgentSkillReferences(notebookReference, rootDirectory, '.agents/skills/execute')).toBe(notebookReference);
    expect(rewriteAgentSkillReferences(`${notebookReference} ${rootReference}`, notebookDirectory, 'my-notes/.agents/skills/execute')).toBe(
      `my-notes/.agents/skills/execute/SKILL.md ${rootReference}`,
    );
    expect(rewriteAgentSkillReferences(`[x](${notebookReference})`, notebookDirectory, 'my-notes/.agents/skills/execute')).toBe(
      '[x](my-notes/.agents/skills/execute/SKILL.md)',
    );
    for (const delimiter of [' ', '"', "'", '`', '(', ')', '[', ']', '{', '}', '<', '>', ',', ';', '|']) {
      expect(rewriteAgentSkillReferences(`${delimiter}${rootReference}`, rootDirectory, '.agents/skills/execute')).toBe(
        `${delimiter}.agents/skills/execute/SKILL.md`,
      );
    }
  });

  it('updates only the renamed skill entry frontmatter name and path references', () => {
    const content = '---\nname: run\ndescription: Run the tests, then run lint.\ncustom: keep\n---\nUse $run at `.agents/skills/run/SKILL.md`.\n';
    expect(renameAgentSkillEntryContent(content, '.agents/skills/run', '.agents/skills/execute', 'execute')).toBe('---\nname: execute\ndescription: Run the tests, then run lint.\ncustom: keep\n---\nUse $run at `.agents/skills/execute/SKILL.md`.\n');
  });
});
