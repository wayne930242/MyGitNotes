export interface ToolContext {
  repoRoot: string;
  /** The Core checkout that ships product reference documents; the workspace root in a fork-model checkout. */
  productRoot?: string;
}
