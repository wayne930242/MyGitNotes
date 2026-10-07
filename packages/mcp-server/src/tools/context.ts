import type { ToolAssets } from './assets.js';
import type { WorkspaceConfig, WorkspaceRepositories } from '@mygitnotes/core';

export interface ToolContext {
  /** The selected repository root for a single tool invocation. */
  repoRoot: string;
  /** Request workspace; each operation selects one or more handles before dispatch. */
  workspace?: WorkspaceRepositories<{ kind: 'local'; id: string; root: string; }>;
  config?: WorkspaceConfig;
  /** The Core checkout that ships product reference documents; the workspace root when the app serves its own checkout. */
  productRoot?: string;
  /** The bucket the asset tools use; defaults to the one the environment names. */
  assets?: ToolAssets;
}
