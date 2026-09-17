import YAML from 'yaml';
import path from 'node:path';
import fs from 'node:fs';
import { WorkspaceConfig, NotebookConfig, NoteTemplate, NotebookMetadataField } from './types.js';

export const WORKSPACE_CONFIG_FILENAME = '.mygitnotes.yaml';
export const LEGACY_WORKSPACE_CONFIG_FILENAME = '.github-notes.yaml';

/** Returns whichever manifest filename exists in `dir` (new name preferred), or null if neither does. */
function existingConfigFilename(dir: string): string | null {
  if (fs.existsSync(path.join(dir, WORKSPACE_CONFIG_FILENAME))) return WORKSPACE_CONFIG_FILENAME;
  if (fs.existsSync(path.join(dir, LEGACY_WORKSPACE_CONFIG_FILENAME))) return LEGACY_WORKSPACE_CONFIG_FILENAME;
  return null;
}

export class ConfigValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigValidationError';
  }
}

/**
 * Validates a parsed WorkspaceConfig object according to project invariants.
 */
export function validateWorkspaceConfig(config: unknown): WorkspaceConfig {
  if (!config || typeof config !== 'object') {
    throw new ConfigValidationError('Configuration must be an object');
  }

  const raw = config as Record<string, unknown>;

  if (typeof raw.schema_version !== 'number' || raw.schema_version < 1) {
    throw new ConfigValidationError('schema_version must be a positive integer');
  }

  if (!raw.workspace || typeof raw.workspace !== 'object') {
    throw new ConfigValidationError('Missing or invalid workspace block');
  }

  const ws = raw.workspace as Record<string, unknown>;
  if (typeof ws.title !== 'string' || !ws.title.trim()) {
    throw new ConfigValidationError('workspace.title is required');
  }
  if (typeof ws.default_notebook !== 'string' || !ws.default_notebook.trim()) {
    throw new ConfigValidationError('workspace.default_notebook is required');
  }

  if (!Array.isArray(raw.notebooks) || raw.notebooks.length === 0) {
    throw new ConfigValidationError('notebooks must be a non-empty array');
  }

  const notebookIds = new Set<string>();
  const notebookRoots: string[] = [];

  const validatedNotebooks: NotebookConfig[] = [];

  for (const nb of raw.notebooks) {
    if (!nb || typeof nb !== 'object') {
      throw new ConfigValidationError('Each notebook entry must be an object');
    }
    const item = nb as Record<string, unknown>;

    // Validate notebook id: slug format
    if (typeof item.id !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(item.id)) {
      throw new ConfigValidationError(
        `Notebook ID '${item.id}' must be an alphanumeric/slug string without special characters`
      );
    }
    if (notebookIds.has(item.id)) {
      throw new ConfigValidationError(`Duplicate notebook ID detected: '${item.id}'`);
    }
    notebookIds.add(item.id);

    // Validate title: allow Unicode
    if (typeof item.title !== 'string' || !item.title.trim()) {
      throw new ConfigValidationError(`Notebook '${item.id}' must have a title`);
    }

    // Validate root: must be relative, inside repo, non-overlapping
    if (typeof item.root !== 'string' || !item.root.trim()) {
      throw new ConfigValidationError(`Notebook '${item.id}' must have a root directory`);
    }
    const normalizedRoot = path.posix.normalize(item.root.replace(/\\/g, '/'));
    if (path.isAbsolute(normalizedRoot) || normalizedRoot.startsWith('..') || normalizedRoot === '.') {
      throw new ConfigValidationError(
        `Notebook '${item.id}' root must be a relative subdirectory inside the repository: '${item.root}'`
      );
    }

    // Check non-overlapping roots
    for (const existingRoot of notebookRoots) {
      const relA = path.posix.relative(existingRoot, normalizedRoot);
      const relB = path.posix.relative(normalizedRoot, existingRoot);
      if (!relA.startsWith('..') || !relB.startsWith('..')) {
        throw new ConfigValidationError(
          `Notebook roots overlap: '${existingRoot}' and '${normalizedRoot}'`
        );
      }
    }
    notebookRoots.push(normalizedRoot);

    const assetPath = typeof item.assets === 'string' ? item.assets.replace(/\\/g, '/') : 'assets';
    if (!assetPath || assetPath.startsWith('/') || assetPath.split('/').some(p => p === '..' || p === '.' || !p) || /^[A-Za-z]:/.test(assetPath)) {
      throw new ConfigValidationError(`Notebook '${item.id}' assets must be a relative directory within its notebook`);
    }

    if (item.statuses !== undefined) {
      if (!Array.isArray(item.statuses) || item.statuses.some(status =>
        typeof status !== 'string' || !status.trim() || status !== status.trim()
      ) || new Set(item.statuses).size !== item.statuses.length) {
        throw new ConfigValidationError(`Notebook '${item.id}' statuses must be an array of distinct nonblank strings without surrounding whitespace`);
      }
    }

    let validatedTemplates: NoteTemplate[] | undefined;
    if (item.templates !== undefined) {
      if (!Array.isArray(item.templates)) {
        throw new ConfigValidationError(`Notebook '${item.id}' templates must be an array`);
      }
      const templateIds = new Set<string>();
      validatedTemplates = item.templates.map((raw) => {
        if (!raw || typeof raw !== 'object') {
          throw new ConfigValidationError(`Notebook '${item.id}' has an invalid template entry`);
        }
        const tpl = raw as Record<string, unknown>;
        if (typeof tpl.id !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(tpl.id)) {
          throw new ConfigValidationError(
            `Notebook '${item.id}' template ID '${tpl.id}' must be an alphanumeric/slug string without special characters`
          );
        }
        if (templateIds.has(tpl.id)) {
          throw new ConfigValidationError(`Notebook '${item.id}' has a duplicate template ID: '${tpl.id}'`);
        }
        templateIds.add(tpl.id);
        if (typeof tpl.title !== 'string' || !tpl.title.trim()) {
          throw new ConfigValidationError(`Notebook '${item.id}' template '${tpl.id}' must have a title`);
        }
        if (typeof tpl.file !== 'string' || !tpl.file.trim()) {
          throw new ConfigValidationError(`Notebook '${item.id}' template '${tpl.id}' must have a file`);
        }
        const file = tpl.file.replace(/\\/g, '/');
        if (
          path.isAbsolute(file) ||
          file.split('/').some(p => p === '..' || p === '' || p === '.') ||
          !/\.(md|markdown)$/i.test(file)
        ) {
          throw new ConfigValidationError(
            `Notebook '${item.id}' template '${tpl.id}' file must be a relative Markdown path inside the notebook: '${tpl.file}'`
          );
        }
        return { id: tpl.id, title: tpl.title, file };
      });
    }

    let validatedMetadata: NotebookMetadataField[] | undefined;
    if (item.metadata !== undefined) {
      if (!Array.isArray(item.metadata)) {
        throw new ConfigValidationError(`Notebook '${item.id}' metadata must be an array`);
      }
      const fieldKeys = new Set<string>();
      validatedMetadata = item.metadata.map((raw) => {
        if (typeof raw === 'string') {
          const key = raw.trim();
          if (!key || !/^[a-zA-Z0-9_-]+$/.test(key)) {
            throw new ConfigValidationError(`Notebook '${item.id}' metadata key '${raw}' must be an alphanumeric/slug string`);
          }
          if (fieldKeys.has(key)) {
            throw new ConfigValidationError(`Notebook '${item.id}' has duplicate metadata field '${key}'`);
          }
          fieldKeys.add(key);
          return { key };
        }
        if (!raw || typeof raw !== 'object') {
          throw new ConfigValidationError(`Notebook '${item.id}' has an invalid metadata field entry`);
        }
        const field = raw as Record<string, unknown>;
        if (typeof field.key !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(field.key)) {
          throw new ConfigValidationError(`Notebook '${item.id}' metadata field key must be an alphanumeric/slug string`);
        }
        if (fieldKeys.has(field.key)) {
          throw new ConfigValidationError(`Notebook '${item.id}' has duplicate metadata field '${field.key}'`);
        }
        fieldKeys.add(field.key);
        if (field.type !== undefined && !['string', 'boolean', 'number'].includes(field.type as string)) {
          throw new ConfigValidationError(`Notebook '${item.id}' metadata field '${field.key}' has invalid type: ${field.type}`);
        }
        if (field.label !== undefined && (typeof field.label !== 'string' || !field.label.trim())) {
          throw new ConfigValidationError(`Notebook '${item.id}' metadata field '${field.key}' has invalid label`);
        }
        return {
          key: field.key,
          ...(field.type ? { type: field.type as 'string' | 'boolean' | 'number' } : {}),
          ...(field.label ? { label: field.label as string } : {}),
        };
      });
    }

    let validatedPathAliases: Record<string, string> | undefined;
    const rawAliases = (item.pathAliases || item.path_aliases || item.paths) as Record<string, unknown> | undefined;
    if (rawAliases && typeof rawAliases === 'object') {
      validatedPathAliases = {};
      for (const [k, v] of Object.entries(rawAliases)) {
        if (typeof k === 'string' && typeof v === 'string') {
          validatedPathAliases[k] = v;
        } else if (typeof k === 'string' && Array.isArray(v) && typeof v[0] === 'string') {
          validatedPathAliases[k] = v[0];
        }
      }
    }

    validatedNotebooks.push({
      id: item.id,
      title: item.title,
      root: normalizedRoot,
      assets: assetPath,
      default_view: (item.default_view as 'list' | 'card' | 'kanban' | 'flat') || 'list',
      ...(item.statuses !== undefined ? { statuses: [...item.statuses as string[]] } : {}),
      ...(validatedTemplates !== undefined ? { templates: validatedTemplates } : {}),
      ...(validatedMetadata !== undefined ? { metadata: validatedMetadata } : {}),
      ...(validatedPathAliases !== undefined ? { pathAliases: validatedPathAliases } : {}),
    });
  }

  // Ensure default_notebook exists
  if (!notebookIds.has(ws.default_notebook as string)) {
    throw new ConfigValidationError(
      `default_notebook '${ws.default_notebook}' does not match any configured notebook ID`
    );
  }

  return {
    schema_version: raw.schema_version as number,
    workspace: {
      title: ws.title as string,
      default_notebook: ws.default_notebook as string,
    },
    notebooks: validatedNotebooks,
    files: {
      hide_dotfiles: raw.files && typeof raw.files === 'object' && 'hide_dotfiles' in (raw.files as Record<string, unknown>)
        ? Boolean((raw.files as Record<string, unknown>).hide_dotfiles)
        : true,
    },
  };
}

/**
 * Parses a YAML string into a validated WorkspaceConfig.
 */
export function parseWorkspaceConfig(yamlContent: string): WorkspaceConfig {
  const parsed = YAML.parse(yamlContent);
  return validateWorkspaceConfig(parsed);
}

/**
 * Serializes a WorkspaceConfig to YAML string.
 */
export function serializeWorkspaceConfig(config: WorkspaceConfig): string {
  return YAML.stringify(config);
}

/**
 * Searches for tsconfig.json or jsconfig.json starting from notebook directory upwards to repository root,
 * and extracts compilerOptions.paths converted to repository-relative paths.
 */
export function discoverTsconfigPaths(repoRoot: string, notebookRoot: string): Record<string, string> {
  const aliases: Record<string, string> = {};
  if (!repoRoot || !notebookRoot) return aliases;
  try {
    const resolvedRepoRoot = path.resolve(repoRoot);
    let currentDir = path.resolve(repoRoot, notebookRoot);

    while (currentDir === resolvedRepoRoot || currentDir.startsWith(resolvedRepoRoot + path.sep)) {
      for (const configFile of ['tsconfig.json', 'jsconfig.json']) {
        const configPath = path.join(currentDir, configFile);
        if (fs.existsSync(configPath)) {
          try {
            const raw = fs.readFileSync(configPath, 'utf-8');
            const cleaned = raw
              .replace(/\/\*[\s\S]*?\*\/|([^\\:]|^)\/\/.*$/gm, '$1')
              .replace(/,\s*([}\]])/g, '$1');
            const parsed = JSON.parse(cleaned);
            const compilerOptions = parsed?.compilerOptions;
            if (compilerOptions && typeof compilerOptions.paths === 'object') {
              const baseUrl = typeof compilerOptions.baseUrl === 'string' ? compilerOptions.baseUrl : '.';
              const relProjectDir = path.relative(resolvedRepoRoot, currentDir).replace(/\\/g, '/');
              for (const [pattern, targetList] of Object.entries(compilerOptions.paths)) {
                if (Array.isArray(targetList) && typeof targetList[0] === 'string') {
                  const targetFirst = targetList[0];
                  const resolvedTarget = path.posix.normalize(
                    path.posix.join(relProjectDir, baseUrl, targetFirst)
                  );
                  aliases[pattern] = resolvedTarget;
                }
              }
            }
          } catch {
            // Ignore syntax errors in tsconfig
          }
          if (Object.keys(aliases).length > 0) return aliases;
        }
      }
      const parent = path.dirname(currentDir);
      if (parent === currentDir) break;
      currentDir = parent;
    }
  } catch {
    // Graceful fallback
  }
  return aliases;
}

function attachTsconfigPaths(parsed: WorkspaceConfig, repoRoot: string): WorkspaceConfig {
  parsed.notebooks = parsed.notebooks.map((nb) => {
    const discovered = discoverTsconfigPaths(repoRoot, nb.root);
    const pathAliases = { ...discovered, ...(nb.pathAliases || {}) };
    return {
      ...nb,
      ...(Object.keys(pathAliases).length > 0 ? { pathAliases } : {}),
    };
  });
  return parsed;
}

/**
 * Loads and validates the workspace manifest from a repository notes root or root directory.
 * Accepts the standard `.mygitnotes.yaml` name and falls back to the legacy `.github-notes.yaml` name.
 */
export function loadWorkspaceConfig(repoRoot: string): WorkspaceConfig | null {
  // 1. Primary: Look in notes/ root directly (e.g. notes/.mygitnotes.yaml)
  const notesDir = path.join(repoRoot, 'notes');
  const notesFilename = existingConfigFilename(notesDir);
  if (notesFilename) {
    const notesConfigPath = path.join(notesDir, notesFilename);
    const content = fs.readFileSync(notesConfigPath, 'utf-8');
    const parsed = parseWorkspaceConfig(content);
    // Normalize notebook roots to repository-relative paths
    parsed.notebooks = parsed.notebooks.map((nb) => {
      let root = nb.root.replace(/\\/g, '/');
      if (!root.startsWith('notes/') && root !== 'notes') {
        if (fs.existsSync(path.join(repoRoot, 'notes', root))) {
          root = path.posix.join('notes', root);
        }
      }
      return { ...nb, root };
    });
    return attachTsconfigPaths(parsed, repoRoot);
  }

  // 2. Secondary: Look in repository root (.mygitnotes.yaml)
  const rootFilename = existingConfigFilename(repoRoot);
  if (rootFilename) {
    const rootConfigPath = path.join(repoRoot, rootFilename);
    const content = fs.readFileSync(rootConfigPath, 'utf-8');
    return attachTsconfigPaths(parseWorkspaceConfig(content), repoRoot);
  }

  // 3. Fallback: Legacy example path if present
  const exampleDir = path.join(repoRoot, 'examples/workspace');
  const exampleFilename = existingConfigFilename(exampleDir);
  if (exampleFilename) {
    const exampleConfig = path.join(exampleDir, exampleFilename);
    const content = fs.readFileSync(exampleConfig, 'utf-8');
    const parsed = parseWorkspaceConfig(content);
    parsed.notebooks = parsed.notebooks.map((nb) => ({
      ...nb,
      root: path.posix.join('examples/workspace', nb.root),
    }));
    return attachTsconfigPaths(parsed, repoRoot);
  }

  return null;
}

/**
 * Resolves the repository-relative path of the manifest that `loadWorkspaceConfig` would load
 * from the notes/ or root tier (the two tiers a workspace can be edited in), or null if neither
 * tier has a manifest yet. Used to write updates back to the file that was actually loaded.
 */
export function resolveWorkspaceConfigPath(repoRoot: string): string | null {
  const notesFilename = existingConfigFilename(path.join(repoRoot, 'notes'));
  if (notesFilename) return path.posix.join('notes', notesFilename);
  const rootFilename = existingConfigFilename(repoRoot);
  if (rootFilename) return rootFilename;
  return null;
}
