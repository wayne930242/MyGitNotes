import YAML from 'yaml';

const SKILL_ENTRY = /^(.*\/(?:\.agents|\.codex|\.claude|\.agent)\/skills|(?:\.agents|\.codex|\.claude|\.agent)\/skills)\/([^/]+)\/SKILL\.md$/;
const VALID_SKILL_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

export interface AgentSkillLocation {
  directory: string;
  parent: string;
  slug: string;
}

export interface AgentSkillContentSplit {
  /** The raw `---\n...\n---\n` block, including delimiters; empty when the file has no frontmatter. */
  frontmatter: string;
  /** Everything after the frontmatter block; the whole file when there is none. */
  body: string;
  /** Number added to body-relative line numbers to reach the same line in the saved file. */
  lineNumberOffset: number;
}

/** Returns the directory-backed identity for a native SKILL.md entry file. */
export function agentSkillLocation(file: string): AgentSkillLocation | undefined {
  const match = file.match(SKILL_ENTRY);
  if (!match) return;
  const [, parent, slug] = match;
  return { directory: `${parent}/${slug}`, parent, slug };
}

export function validateAgentSkillSlug(slug: string): string {
  const value = slug.trim();
  if (!VALID_SKILL_SLUG.test(value)) throw new Error('Use lowercase letters, numbers, and single hyphens between words.');
  return value;
}

/** Splits a SKILL.md file into its frontmatter block and body, so an editor can show only the body. */
export function splitAgentSkillContent(content: string): AgentSkillContentSplit {
  const match = content.match(FRONTMATTER);
  if (!match) return { frontmatter: '', body: content, lineNumberOffset: 0 };
  return { frontmatter: match[0], body: content.slice(match[0].length), lineNumberOffset: (match[0].match(/\n/g) || []).length };
}

/** The canonical entry path for a brand-new directory-backed skill. */
export function newAgentSkillEntryPath(slug: string): string {
  return `.agents/skills/${validateAgentSkillSlug(slug)}/SKILL.md`;
}

/** A minimal, immediately valid SKILL.md: frontmatter with a name and empty description, plus a heading. */
export function newAgentSkillEntryContent(slug: string): string {
  const value = validateAgentSkillSlug(slug);
  const yaml = YAML.stringify({ name: value, description: '' }).trim();
  return `---\n${yaml}\n---\n\n# ${value}\n`;
}

export function renamedAgentSkillPath(file: string, slug: string): string {
  const location = agentSkillLocation(file);
  if (!location) throw new Error('Only a SKILL.md entry file can rename a skill.');
  return `${location.parent}/${validateAgentSkillSlug(slug)}/SKILL.md`;
}

/** Rewrites only references containing the skill's directory path; ordinary prose stays byte-identical. */
export function rewriteAgentSkillReferences(content: string, oldDirectory: string, newDirectory: string): string {
  const escapedDirectory = oldDirectory.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pathTokenStart = /(^|[\s"'`()[\]{}<>,;|])/.source;
  return content.replace(new RegExp(`${pathTokenStart}${escapedDirectory}(?=/)`, 'g'), (_match, prefix: string) => `${prefix}${newDirectory}`);
}

/** Updates a renamed skill's own path references and canonical frontmatter name. */
export function renameAgentSkillEntryContent(content: string, oldDirectory: string, newDirectory: string, newSlug: string): string {
  const rewritten = rewriteAgentSkillReferences(content, oldDirectory, newDirectory);
  const match = rewritten.match(FRONTMATTER);
  if (!match) return `---\nname: ${newSlug}\n---\n\n${rewritten}`;
  const document = YAML.parseDocument(match[1]);
  if (document.errors.length || !YAML.isMap(document.contents)) throw new Error('Fix the SKILL.md frontmatter before renaming this skill.');
  document.set('name', newSlug);
  return `---\n${document.toString({ lineWidth: 0 }).trimEnd()}\n---\n${rewritten.slice(match[0].length)}`;
}
