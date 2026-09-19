import path from 'node:path';
import { ClassifiedResource, WorkspaceConfig } from './types.js';
import { LEGACY_WORKSPACE_CONFIG_FILENAME, WORKSPACE_CONFIG_FILENAME } from './config.js';
import { workspaceAgentKind } from './workspace-agent.js';

const HIDDEN_PATTERNS = [
  /(?:^|\/)\.[^/]/, // Any dotfile/dotdirectory (.git, .github, etc.)
  /(?:^|\/)node_modules\//,
  /(?:^|\/)dist\//,
  /(?:^|\/)build\//,
  /(?:^|\/)\.DS_Store$/,
  /(?:^|\/)Thumbs\.db$/,
  /(?:^|\/)\.gitkeep$/,
];

/**
 * Checks if a relative path matches standard hidden / noise criteria.
 */
export function isHiddenPath(relPath: string): boolean {
  const normalized = relPath.replace(/\\/g, '/');
  return HIDDEN_PATTERNS.some((pattern) => pattern.test(normalized));
}

/**
 * Classifies a repository-relative path into its distinct product resource category.
 */
export function classifyResource(relPath: string, config?: WorkspaceConfig | null): ClassifiedResource {
  const normalized = path.posix.normalize(relPath.replace(/\\/g, '/')).replace(/^\.\//, '');

  const agentKind = workspaceAgentKind(relPath);
  if (agentKind) return { path: normalized, type: agentKind === 'instructions' ? 'agent_instruction' : 'agent_doc' };

  // 1. Workspace / System configuration file (standard or legacy name)
  if (normalized === WORKSPACE_CONFIG_FILENAME || normalized === `notes/${WORKSPACE_CONFIG_FILENAME}` || normalized === LEGACY_WORKSPACE_CONFIG_FILENAME || normalized === `notes/${LEGACY_WORKSPACE_CONFIG_FILENAME}`) {
    return { path: normalized, type: 'workspace_config' };
  }

  // 2. Hidden noise or dotfiles (except the workspace manifest checked above)
  if (isHiddenPath(normalized)) {
    return { path: normalized, type: 'hidden' };
  }

  // 3. Agent Instructions: root AGENTS.md or nested AGENTS.md
  if (path.posix.basename(normalized).toLowerCase() === 'agents.md') {
    return { path: normalized, type: 'agent_instruction' };
  }

  // 4. Agent Docs: docs/agent/** or notes/<notebook>/docs/agent/**
  if (normalized.startsWith('docs/agent/') || normalized === 'docs/agent' || normalized.includes('/docs/agent/')) {
    return { path: normalized, type: 'agent_doc' };
  }

  // Check against notebook configurations if available
  if (config && config.notebooks) {
    for (const nb of config.notebooks) {
      const nbRoot = nb.root.replace(/\/$/, '');
      if (normalized === nbRoot || normalized.startsWith(`${nbRoot}/`)) {
        const subPath = normalized.slice(nbRoot.length + 1);

        // Assets inside notebook
        const assetFolder = (nb.assets || 'assets').replace(/\/$/, '');
        if (subPath === assetFolder || subPath.startsWith(`${assetFolder}/`)) {
          return { path: normalized, type: 'asset', notebookId: nb.id };
        }

        // Agent instructions or docs inside notebook
        if (path.posix.basename(normalized).toLowerCase() === 'agents.md') {
          return { path: normalized, type: 'agent_instruction', notebookId: nb.id };
        }
        if (subPath.startsWith('docs/agent/') || subPath.includes('/docs/agent/')) {
          return { path: normalized, type: 'agent_doc', notebookId: nb.id };
        }

        // Regular notes inside notebook
        const ext = path.posix.extname(normalized).toLowerCase();
        if (['.md', '.markdown', '.mdx', '.txt'].includes(ext)) {
          return { path: normalized, type: 'note', notebookId: nb.id };
        }

        // Other files within notebook (images/assets or other documents)
        if (['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp'].includes(ext)) {
          return { path: normalized, type: 'asset', notebookId: nb.id };
        }

        return { path: normalized, type: 'note', notebookId: nb.id };
      }

      // Check if file is an asset under a notebook's pathAliases target (e.g. blog/src/assets/**)
      if (nb.pathAliases) {
        for (const target of Object.values(nb.pathAliases)) {
          const targetDir = target.replace(/\*$/, '').replace(/\/$/, '');
          if (targetDir && (normalized === targetDir || normalized.startsWith(`${targetDir}/`))) {
            const ext = path.posix.extname(normalized).toLowerCase();
            if (['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.avif', '.ico', '.pdf', '.mp4', '.webm', '.m4a', '.mp3', '.ogg'].includes(ext) || normalized.includes('/assets/')) {
              return { path: normalized, type: 'asset', notebookId: nb.id };
            }
          }
        }
      }
    }
  } else {
    // If no config provided, check notes/ prefix convention
    if (normalized.startsWith('notes/')) {
      const parts = normalized.split('/');
      const notebookId = parts[1];
      const subPath = parts.slice(2).join('/');
      if (subPath.startsWith('assets/')) {
        return { path: normalized, type: 'asset', notebookId };
      }
      return { path: normalized, type: 'note', notebookId };
    }
  }

  // 5. Product source code: packages/**, apps/**, scripts/**, etc.
  if (normalized.startsWith('packages/') || normalized.startsWith('apps/') || normalized.startsWith('scripts/') || normalized.startsWith('.agents/') || normalized.startsWith('examples/') || normalized === 'package.json' || normalized === 'pnpm-workspace.yaml' || normalized === 'README.md' || normalized === '.env.example') {
    return { path: normalized, type: 'product_source' };
  }

  return { path: normalized, type: 'product_source' };
}
