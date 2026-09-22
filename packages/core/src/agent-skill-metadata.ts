const SKILL_ENTRY = /^(.*\/(?:\.agents|\.codex|\.claude|\.agent)\/skills|(?:\.agents|\.codex|\.claude|\.agent)\/skills)\/([^/]+)\/SKILL\.md$/;
const VALID_SKILL_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export interface AgentSkillLocation {
  directory: string;
  parent: string;
  slug: string;
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

export function renamedAgentSkillPath(file: string, slug: string): string {
  const location = agentSkillLocation(file);
  if (!location) throw new Error('Only a SKILL.md entry file can rename a skill.');
  return `${location.parent}/${validateAgentSkillSlug(slug)}/SKILL.md`;
}

/** Rewrites exact skill-path and slug tokens while leaving longer identifiers untouched. */
export function rewriteAgentSkillReferences(content: string, oldDirectory: string, newDirectory: string, oldSlug: string, newSlug: string): string {
  const escapedDirectory = oldDirectory.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const escapedSlug = oldSlug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return content
    .replace(new RegExp(escapedDirectory, 'g'), newDirectory)
    .replace(new RegExp(`(?<![A-Za-z0-9_-])${escapedSlug}(?![A-Za-z0-9_-])`, 'g'), newSlug);
}
