import fs from 'node:fs';
import path from 'node:path';
import { resolveSafePath } from './path-guard.js';

export type WorkspaceAgentKind = 'instructions' | 'skills' | 'docs';
export interface WorkspaceAgentResource {
  path: string;
  name: string;
  editable: boolean;
  scope: 'workspace' | 'notes';
}

/** UI document allowlist, deliberately narrower than Git namespace ownership. */
export function workspaceAgentKind(file: string): WorkspaceAgentKind | undefined {
  if (file.includes('\\') || /[\x00-\x1f\x7f]/.test(file) || file.split('/').some(p => !p || p === '.' || p === '..')) return;
  if (file === 'AGENTS.md') return 'instructions';
  const parts = file.split('/');
  if (parts[0] === 'notes') {
    if (parts.some(p => p.startsWith('.'))) return;
    if (parts.at(-1)?.toLowerCase() === 'agents.md') return 'instructions';
    if (/\/docs\/agent\/.+\.(md|markdown|txt)$/i.test(file)) return 'docs';
    return;
  }
  if (!['.agents', '.codex'].includes(parts[0]) || parts.slice(1).some(p => p.startsWith('.'))) return;
  if (parts.length === 2 && parts[1] === 'AGENTS.md') return 'instructions';
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
    try { if (fs.lstatSync(current).isSymbolicLink()) throw new Error('Agent documents cannot cross symlinks.'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  return target;
}

export function listWorkspaceAgentFiles(root: string): string[] {
  const files: string[] = [];
  const walk = (relative: string) => {
    const full = path.join(root, relative);
    if (!fs.existsSync(full) || fs.lstatSync(full).isSymbolicLink()) return;
    if (fs.statSync(full).isFile()) { if (workspaceAgentKind(relative)) files.push(relative); return; }
    for (const entry of fs.readdirSync(full, { withFileTypes: true })) {
      if (!entry.isSymbolicLink() && !entry.name.startsWith('.') && !['node_modules', 'dist', 'build'].includes(entry.name)) walk(path.posix.join(relative, entry.name));
    }
  };
  for (const entry of ['AGENTS.md', '.agents', '.codex', 'notes']) walk(entry);
  return files.sort();
}

export function workspaceAgentResource(file: string, editable: boolean): WorkspaceAgentResource {
  const notebook = file.match(/^notes\/([^/]+)\/AGENTS\.md$/);
  return { path: file, editable, scope: file.startsWith('notes/') ? 'notes' : 'workspace',
    name: file === 'AGENTS.md' ? 'Workspace Guidelines' : file === 'notes/AGENTS.md' ? 'Notes Workspace Guidelines'
      : notebook ? `Notebook: ${notebook[1].charAt(0).toUpperCase() + notebook[1].slice(1)} Guidelines` : file };
}
