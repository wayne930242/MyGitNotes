export interface ToolContext {
  repoRoot: string;
  /** The Core checkout that ships product reference documents; the workspace root when the app serves its own checkout. */
  productRoot?: string;
}
