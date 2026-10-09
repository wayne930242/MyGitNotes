import type { RepositoryStatus } from '@mygitnotes/core/repository';

/** A folder Pi can run in with its own core instructions and skills; `folder` is empty for the repository root. */
export interface AgentWorkspace {
  repository: string;
  folder: string;
  /** Whether the folder holds its core instructions (`AGENTS.md`) yet; only the root may lack them. */
  hasInstructions: boolean;
  /** The workspaces this one sits inside, outermost first. */
  parents: string[];
}

/** A file of a workspace as `/api/agent-resources` lists it. */
export interface AgentFile {
  path: string;
  folder: string;
  kind: 'instructions' | 'skill' | 'reference' | 'script';
  skill?: string;
  editable: boolean;
}

/** One skill with its entry, reference files and scripts. */
export interface AgentSkill {
  name: string;
  /** The skill folder, `<workspace>/.agents/skills/<name>`. */
  directory: string;
  entry?: AgentFile;
  references: AgentFile[];
  scripts: AgentFile[];
}

export const INSTRUCTIONS_FILE = 'AGENTS.md';

export const workspaceKey = (workspace: Pick<AgentWorkspace, 'repository' | 'folder'>) => `${workspace.repository}\n${workspace.folder}`;
export const sameWorkspace = (a: Pick<AgentWorkspace, 'repository' | 'folder'> | undefined, b: Pick<AgentWorkspace, 'repository' | 'folder'> | undefined) => Boolean(a && b && a.repository === b.repository && a.folder === b.folder);
export const instructionsPath = (folder: string) => folder ? `${folder}/${INSTRUCTIONS_FILE}` : INSTRUCTIONS_FILE;
export const skillsDirectory = (folder: string) => folder ? `${folder}/.agents/skills` : '.agents/skills';

/** A repository as people know it: its platform name, or the worktree folder of a local one. */
export function repositoryName(repository: Pick<RepositoryStatus, 'id' | 'repository'> | undefined, id = ''): string {
  const value = repository?.repository ?? repository?.id ?? id;
  return value.startsWith('local:') ? value.slice('local:'.length).replace(/\/+$/, '').split('/').pop() || value : value;
}

/**
 * How a workspace reads in a list: a repository's root by that repository's title (its manifest's `workspace.title`,
 * or its name without a manifest), and a folder by its own name.
 */
export function workspaceName(workspace: Pick<AgentWorkspace, 'repository' | 'folder'>, repositories: Pick<RepositoryStatus, 'id' | 'repository' | 'title'>[]): string {
  if (workspace.folder) return workspace.folder.split('/').pop()!;
  const repository = repositories.find(candidate => candidate.id === workspace.repository);
  return repository?.title || repositoryName(repository, workspace.repository);
}

/** The skills of one workspace, by name, each with its files in path order. */
export function workspaceSkills(files: AgentFile[], folder: string): AgentSkill[] {
  const skills = new Map<string, AgentSkill>();
  for (const file of files) {
    if (file.folder !== folder || !file.skill) continue;
    const skill = skills.get(file.skill) ?? { name: file.skill, directory: `${skillsDirectory(folder)}/${file.skill}`, references: [], scripts: [] };
    if (file.kind === 'skill') skill.entry = file;
    else if (file.kind === 'script') skill.scripts.push(file);
    else skill.references.push(file);
    skills.set(file.skill, skill);
  }
  // A folder without SKILL.md is not a skill Pi would load.
  return [...skills.values()].filter(skill => skill.entry).sort((a, b) => a.name.localeCompare(b.name, 'en'));
}

/** Whether a file is a script, which opens in the code editor rather than the Markdown editor. */
export const isScript = (path: string) => /\/\.agents\/skills\/[^/]+\/scripts\/|^\.agents\/skills\/[^/]+\/scripts\//.test(path);

/** A file name a person types for a new reference file or script: one plain segment, with an extension added when it has none. */
export function newSkillFileName(name: string, kind: 'reference' | 'script'): string {
  const value = name.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value)) throw new Error('Use letters, numbers, dots, hyphens and underscores.');
  if (kind === 'reference') return /\.(md|markdown|txt)$/i.test(value) ? value : `${value}.md`;
  if (!/\.(sh|bash|zsh|py|js|mjs|cjs|ts|json|ya?ml|toml|txt|md)$/i.test(value)) throw new Error('Name the script with an extension such as .sh, .py or .js.');
  return value;
}
