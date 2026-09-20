/** Repository eligibility and running-build freshness are independent. */
export type CoreUpdateState = 'update_available' | 'up_to_date' | 'ahead' | 'diverged' | 'dirty' | 'invalid_branch' | 'permission_required' | 'unsupported' | 'workflow_missing' | 'workflow_permission_required' | 'ancestry_unknown' | 'reauthorization_required' | 'secret_permission_required';
export interface CoreComparison {
  sha: string;
  ahead: number;
  behind: number;
}
export interface CoreStatus {
  state: CoreUpdateState;
  canUpdate: boolean;
  current: CoreComparison | null;
  upstreamSha: string | null;
  upstream: string;
  running: CoreComparison | null;
  runningBuild: string;
  defaultBranch?: string;
}
export function coreComparisonState(comparison: CoreComparison): CoreUpdateState {
  return comparison.ahead && comparison.behind ? 'diverged' : comparison.behind ? 'update_available' : comparison.ahead ? 'ahead' : 'up_to_date';
}

export interface CoreUpdateReceipt {
  requestId: string;
  targetSha: string;
}
export interface CoreUpdateRun {
  state: 'pending' | 'running' | 'succeeded' | 'already_current' | 'run_failed' | 'diverged' | 'workflow_permission_required' | 'update_unconfirmed';
  url?: string;
  targetSha: string;
  currentSha?: string;
}
