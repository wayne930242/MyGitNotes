import { SourceError } from './github-api.js';
import { type RepositoryRef, repositoryRef } from './repository.js';
import { loadRepositoryMappings, loadSourceConfig, mapsRepository, type RepositoryMapping } from './source-config.js';
import type { WorkspaceConfig } from './types.js';

/** What an adapter may inspect to decide which workspace a request belongs to. */
export interface WorkspaceRequest {
  headers: Record<string, string | string[] | undefined>;
}
/** Reads and saves the workspace manifest wherever the configuration source keeps it. */
export interface ManifestStore {
  load(): Promise<{ config: WorkspaceConfig; revision: string; }>;
  save(yaml: string, revision: string): Promise<{ config: WorkspaceConfig; revision: string; }>;
}
/** Configuration of the workspace serving one request. */
export interface WorkspaceSettings {
  home: RepositoryRef;
  /** Local mode: the worktree path mapped to a notebook repository, if any. */
  localPath(ref: RepositoryRef): string | undefined;
  /** Chooses the manifest store; `inHomeRepository` keeps the manifest as a file in the home repository. */
  manifest(inHomeRepository: () => ManifestStore): ManifestStore;
}
/** Where workspace configuration comes from. Callers resolve settings per request and never read deployment files themselves. */
export interface WorkspaceConfigSource {
  /** Local deployments serve worktrees; remote deployments reach every repository through a provider API. */
  readonly mode: 'local' | 'remote';
  settings(request: WorkspaceRequest): Promise<WorkspaceSettings>;
}

/** The deployment has no usable source configuration yet. */
export class WorkspaceSetupError extends SourceError {
  constructor(message: string) {
    super(message, 503);
  }
}

function readDeploymentSettings(base: string, env: NodeJS.ProcessEnv): WorkspaceSettings {
  let source;
  let mappings: RepositoryMapping[];
  try {
    source = loadSourceConfig(base, env);
    if (env.VERCEL && source.type === 'local') throw new Error('Vercel requires a GitHub or GitLab source. Configure MYGITNOTES_SOURCE, MYGITNOTES_REPOSITORY and MYGITNOTES_BRANCH.');
    mappings = source.type === 'local' ? loadRepositoryMappings(base, env) : [];
  } catch (error) {
    throw new WorkspaceSetupError((error as Error).message);
  }
  const localPath = (ref: RepositoryRef) => ref.source.type === 'local' ? undefined : mappings.find(mapping => mapsRepository(mapping, ref.source as Exclude<typeof ref.source, { type: 'local'; }>))?.path;
  return { home: repositoryRef(source), localPath, manifest: inHomeRepository => inHomeRepository() };
}

/** Configuration from the environment and `mygitnotes.server.yaml`, with the manifest in the home repository. Settings are read on every call; the mode is fixed when the deployment starts. */
export function deploymentConfigSource(base: string, env: NodeJS.ProcessEnv = process.env): WorkspaceConfigSource {
  let mode: WorkspaceConfigSource['mode'] = 'remote';
  try {
    mode = readDeploymentSettings(base, env).home.source.type === 'local' ? 'local' : 'remote';
  } catch {
    // A deployment without a usable source starts in remote mode and reports the setup error per request.
  }
  return {
    mode,
    settings: async () => {
      const settings = readDeploymentSettings(base, env);
      if ((settings.home.source.type === 'local') !== (mode === 'local')) throw new WorkspaceSetupError('The deployment source changed between local and remote. Restart the server.');
      return settings;
    },
  };
}
