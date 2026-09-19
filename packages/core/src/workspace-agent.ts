import fs from 'node:fs';
import path from 'node:path';
import { resolveSafePath } from './path-guard.js';

export type WorkspaceAgentKind = 'instructions' | 'skills' | 'docs';
export interface WorkspaceAgentResource {
  path: string;
  name: string;
  editable: boolean;
  scope: 'workspace' | 'notes' | 'product';
}

const instructionFiles = ['AGENTS.md', 'CLAUDE.md', 'GEMINI.md'];
const agentDirectories = ['.agents', '.codex', '.claude', '.agent'];

/** UI document allowlist, deliberately narrower than Git namespace ownership. */
export function workspaceAgentKind(file: string): WorkspaceAgentKind | undefined {
  if (file.includes('\\') || /[\x00-\x1f\x7f]/.test(file) || file.split('/').some(p => !p || p === '.' || p === '..')) return;
  if (instructionFiles.includes(file)) return 'instructions';
  const parts = file.split('/');
  if (parts[0] === 'notes') {
    if (parts.some(p => p.startsWith('.'))) return;
    if (instructionFiles.some(name => name.toLowerCase() === parts.at(-1)?.toLowerCase())) return 'instructions';
    if (/\/docs\/agent\/.+\.(md|markdown|txt)$/i.test(file)) return 'docs';
    return;
  }
  if (!agentDirectories.includes(parts[0]) || parts.slice(1).some(p => p.startsWith('.'))) return;
  if (parts.length === 2 && parts[1] === 'AGENTS.md') return 'instructions';
  if (file === '.claude/CLAUDE.md') return 'instructions';
  if (parts[0] === '.agents' && parts[1] === 'skills' && parts.length === 3 && /\.md$/i.test(file)) return 'skills';
  if (parts[1] === 'skills' && parts.length === 5 && parts[3] === 'agents' && parts[4] === 'openai.yaml') return 'skills';
  if (parts[1] === 'skills' && parts.length >= 4 && /\.(md|markdown|txt)$/i.test(file)) return 'skills';
  if (parts[1] === 'agents' && parts.length >= 3 && /\.(md|markdown|txt|toml|ya?ml)$/i.test(file)) return 'docs';
  if (parts[1] === 'rules' && parts.length >= 3 && /\.(md|rules)$/i.test(file)) return 'docs';
  if (parts[1] === 'docs' && parts.length >= 3 && /\.(md|markdown|txt)$/i.test(file)) return 'docs';
}

/** Reject even in-repository symlinks so a document cannot alias a secret or product file. */
export function resolveWorkspaceAgentPath(root: string, file: string): string {
  if (!workspaceAgentKind(file)) throw new Error('Path is not a workspace Agent document.');
  const target = resolveSafePath(root, file);
  let current = root;
  for (const part of file.split('/')) {
    current = path.join(current, part);
    try {
      if (fs.lstatSync(current).isSymbolicLink()) throw new Error('Agent documents cannot cross symlinks.');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  return target;
}

export function listWorkspaceAgentFiles(root: string): string[] {
  const files: string[] = [];
  const walk = (relative: string) => {
    const full = path.join(root, relative);
    if (!fs.existsSync(full) || fs.lstatSync(full).isSymbolicLink()) return;
    if (fs.statSync(full).isFile()) {
      if (workspaceAgentKind(relative)) files.push(relative);
      return;
    }
    for (const entry of fs.readdirSync(full, { withFileTypes: true })) {
      if (!entry.isSymbolicLink() && !entry.name.startsWith('.') && !['node_modules', 'dist', 'build'].includes(entry.name)) walk(path.posix.join(relative, entry.name));
    }
  };
  for (const entry of [...instructionFiles, ...agentDirectories, 'notes']) walk(entry);
  return files.sort();
}

export function workspaceAgentResource(file: string, editable: boolean): WorkspaceAgentResource {
  const notebook = file.match(/^notes\/([^/]+)\/AGENTS\.md$/);
  return { path: file, editable, scope: file.startsWith('notes/') ? 'notes' : 'workspace', name: file === 'AGENTS.md' ? 'Workspace Guidelines' : file === 'notes/AGENTS.md' ? 'Notes Workspace Guidelines' : notebook ? `Notebook: ${notebook[1].charAt(0).toUpperCase() + notebook[1].slice(1)} Guidelines` : file };
}

/** Product reference documents ship with Core under docs/agent and are read-only in every workspace. */
export function isProductAgentDoc(file: string): boolean {
  if (file.includes('\\') || /[\x00-\x1f\x7f]/.test(file)) return false;
  const parts = file.split('/');
  return parts.length >= 3 && parts[0] === 'docs' && parts[1] === 'agent' && parts.every(p => p && !p.startsWith('.')) && /\.md$/i.test(file);
}

export function listProductAgentDocs(productRoot: string): string[] {
  const files: string[] = [];
  const walk = (relative: string) => {
    const full = path.join(productRoot, relative);
    if (!fs.existsSync(full) || fs.lstatSync(full).isSymbolicLink()) return;
    if (fs.statSync(full).isFile()) {
      if (isProductAgentDoc(relative)) files.push(relative);
      return;
    }
    for (const entry of fs.readdirSync(full)) if (!entry.startsWith('.')) walk(path.posix.join(relative, entry));
  };
  walk('docs/agent');
  return files.sort();
}

export function readProductAgentDoc(productRoot: string, file: string): string {
  if (!isProductAgentDoc(file)) throw new Error('Path is not a product reference document.');
  let current = productRoot;
  for (const part of file.split('/')) {
    current = path.join(current, part);
    if (fs.lstatSync(current).isSymbolicLink()) throw new Error('Product documents cannot cross symlinks.');
  }
  return fs.readFileSync(resolveSafePath(productRoot, file), 'utf8');
}

export function productAgentResource(file: string, content: string): WorkspaceAgentResource {
  return { path: file, editable: false, scope: 'product', name: content.match(/^#\s+(.+)$/m)?.[1].trim() || file };
}

export function productAgentResources(productRoot: string): WorkspaceAgentResource[] {
  return listProductAgentDocs(productRoot).map(file => productAgentResource(file, readProductAgentDoc(productRoot, file)));
}
