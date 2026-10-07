import fs from 'node:fs';
import path from 'node:path';
import { isNotebookContent } from './folders.js';
import { resolveSafePath } from './path-guard.js';
import type { NotebookConfig } from './types.js';
import { workspaceAgentKind } from './workspace-agent.js';

/**
 * An agent workspace is a folder Pi can run in with its own core instructions (`AGENTS.md`) and skills
 * (`.agents/skills/<name>/`). The repository root always is one; any other agent folder becomes one once it
 * holds an `AGENTS.md`. These are the paths Pi itself reads, so no tool needs a copy of its own.
 */
export interface AgentWorkspace {
  /** Repository-relative folder; empty for the repository root. */
  folder: string;
  /** Whether the folder holds its core instructions yet; only the root may lack them. */
  hasInstructions: boolean;
  /** The workspaces this one sits inside, outermost first; Pi reads their instructions and skills too. */
  parents: string[];
}

/** What a file is to its workspace: the core instructions, or a skill's entry, reference file or script. */
export type AgentWorkspaceFileKind = 'instructions' | 'skill' | 'reference' | 'script';

export interface AgentWorkspaceFile {
  path: string;
  /** The workspace folder the file belongs to; empty for the repository root. */
  folder: string;
  kind: AgentWorkspaceFileKind;
  /** The skill's folder name, for every kind but `instructions`. */
  skill?: string;
}

export const INSTRUCTIONS_FILE = 'AGENTS.md';
export const SKILLS_DIRECTORY = '.agents/skills';
const SKILL_FILE = /^(?:(.+)\/)?\.agents\/skills\/([^/]+)\/(.+)$/;
const REFERENCE = /\.(md|markdown|txt)$/i;
const SCRIPT = /\.(sh|bash|zsh|py|js|mjs|cjs|ts|json|ya?ml|toml|txt|md)$/i;
const SKIPPED = new Set(['node_modules', 'dist', 'build']);

const instructionsPath = (folder: string) => folder ? `${folder}/${INSTRUCTIONS_FILE}` : INSTRUCTIONS_FILE;
const visible = (part: string) => Boolean(part) && !part.startsWith('.');
/** Generated folders inside a skill that the worktree walk leaves out; paths through them stay valid workspace files. */
const walked = (part: string) => visible(part) && !SKIPPED.has(part);

/** Whether a folder is a notebook root or a content folder inside one. */
export function insideNotebook(dir: string, notebooks: NotebookConfig[]) {
  return notebooks.some(nb => dir === nb.root || (dir.startsWith(nb.root + '/') && isNotebookContent(dir.slice(nb.root.length + 1), nb)));
}

/** The repository root, notebook roots and their ancestors, and visible folders inside notebooks may be agent workspaces. */
export function agentFolder(dir: string, notebooks: NotebookConfig[]): boolean {
  if (!dir) return true;
  if (!dir.split('/').every(visible)) return false;
  return notebooks.some(nb => nb.root.startsWith(dir + '/')) || insideNotebook(dir, notebooks);
}

/** The workspace file a repository path names, or undefined for anything the agent pages may not touch. */
export function agentWorkspaceFile(file: string, notebooks: NotebookConfig[]): AgentWorkspaceFile | undefined {
  /* eslint-disable no-control-regex -- Reject control characters in persisted paths, identifiers or filenames. */
  if (typeof file !== 'string' || file.includes('\\') || /[\x00-\x1f\x7f]/.test(file)) return;
  /* eslint-enable no-control-regex */
  if (file.split('/').some(p => !p || p === '.' || p === '..')) return;
  if (path.posix.basename(file) === INSTRUCTIONS_FILE) {
    const folder = file === INSTRUCTIONS_FILE ? '' : file.slice(0, -INSTRUCTIONS_FILE.length - 1);
    return agentFolder(folder, notebooks) ? { path: file, folder, kind: 'instructions' } : undefined;
  }
  const match = file.match(SKILL_FILE);
  if (!match) return;
  const [, folder = '', skill, rest] = match;
  const parts = rest.split('/');
  if (!visible(skill) || !parts.every(visible) || !agentFolder(folder, notebooks)) return;
  if (rest === 'SKILL.md') return { path: file, folder, kind: 'skill', skill };
  if (parts[0] === 'scripts' && parts.length > 1) return SCRIPT.test(rest) ? { path: file, folder, kind: 'script', skill } : undefined;
  return REFERENCE.test(rest) ? { path: file, folder, kind: 'reference', skill } : undefined;
}

/** Whether Git and the agent routes may touch a path: a workspace file, or a file of another tool kept from before workspaces. */
export function agentFileAllowed(file: string, notebooks: NotebookConfig[]): boolean {
  return Boolean(agentWorkspaceFile(file, notebooks) || workspaceAgentKind(file));
}

/** The workspaces of one repository, from its list of workspace files: the root first, then by folder. */
export function agentWorkspaces(files: AgentWorkspaceFile[]): AgentWorkspace[] {
  const folders = new Set(['', ...files.filter(file => file.kind === 'instructions').map(file => file.folder)]);
  const instructed = new Set(files.filter(file => file.kind === 'instructions').map(file => file.folder));
  const sorted = [...folders].sort((a, b) => a === '' ? -1 : b === '' ? 1 : a.localeCompare(b, 'en'));
  return sorted.map(folder => ({ folder, hasInstructions: instructed.has(folder), parents: sorted.filter(other => other !== folder && (other === '' || folder.startsWith(`${other}/`))) }));
}

/** Resolves a workspace file inside `root`, refusing a path that crosses a symlink so it cannot alias another file. */
export function resolveAgentFile(root: string, file: string, notebooks: NotebookConfig[]): string {
  if (!agentFileAllowed(file, notebooks)) throw new Error('Path is not an agent workspace file.');
  const target = resolveSafePath(root, file);
  let current = root;
  for (const part of file.split('/')) {
    current = path.join(current, part);
    try {
      if (fs.lstatSync(current).isSymbolicLink()) throw new Error('Agent files cannot cross symlinks.');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  return target;
}

/** Every workspace file in a worktree, walking only the folders that may be workspaces and their skill folders. */
export function listAgentWorkspaceFiles(root: string, notebooks: NotebookConfig[]): AgentWorkspaceFile[] {
  const found: AgentWorkspaceFile[] = [];
  const isDirectory = (full: string) => fs.existsSync(full) && !fs.lstatSync(full).isSymbolicLink() && fs.statSync(full).isDirectory();
  const collect = (relative: string) => {
    const full = path.join(root, relative);
    if (fs.lstatSync(full).isSymbolicLink()) return;
    if (fs.statSync(full).isDirectory()) {
      for (const entry of fs.readdirSync(full)) if (walked(entry)) collect(`${relative}/${entry}`);
      return;
    }
    const file = agentWorkspaceFile(relative, notebooks);
    if (file) found.push(file);
  };
  const walk = (folder: string) => {
    const full = path.join(root, folder);
    const instructions = instructionsPath(folder);
    const instructionsFull = path.join(root, instructions);
    if (fs.existsSync(instructionsFull) && fs.lstatSync(instructionsFull).isFile()) found.push({ path: instructions, folder, kind: 'instructions' });
    const skills = folder ? `${folder}/${SKILLS_DIRECTORY}` : SKILLS_DIRECTORY;
    // Neither `.agents` nor `.agents/skills` may be a symlink, or the walk would leave the folder.
    if (isDirectory(path.join(root, skills, '..')) && isDirectory(path.join(root, skills))) {
      for (const skill of fs.readdirSync(path.join(root, skills))) if (walked(skill) && isDirectory(path.join(root, skills, skill))) collect(`${skills}/${skill}`);
    }
    for (const entry of fs.readdirSync(full, { withFileTypes: true })) {
      const child = folder ? `${folder}/${entry.name}` : entry.name;
      if (entry.isDirectory() && agentFolder(child, notebooks)) walk(child);
    }
  };
  walk('');
  return found.sort((a, b) => a.path.localeCompare(b.path, 'en'));
}
