import { type CoreComparison, coreComparisonState, type CoreStatus } from '@mygitnotes/core';
import { CoreUpdateError, discoverCoreRemote } from './core-update.js';
import { getGitStatus, runGit } from './git-service.js';

export async function getCoreStatus(repoRoot: string, runningBuild: string): Promise<CoreStatus> {
  const remote = await discoverCoreRemote(repoRoot);
  try {
    await runGit(['fetch', remote, `+refs/heads/core:refs/remotes/${remote}/core`], repoRoot, { timeout: 30000 });
  } catch {
    throw new CoreUpdateError(`Could not fetch ${remote}/core. Check the remote and repository access.`, 'FETCH_FAILED');
  }
  const upstreamSha = (await runGit(['rev-parse', '--verify', `refs/remotes/${remote}/core^{commit}`], repoRoot)).stdout;
  const compare = async (sha: string): Promise<CoreComparison> => {
    const counts = (await runGit(['rev-list', '--left-right', '--count', `${sha}...${upstreamSha}`], repoRoot)).stdout.split(/\s+/).map(Number);
    return { sha, ahead: counts[0], behind: counts[1] };
  };
  const tree = await getGitStatus(repoRoot);
  const current = await compare((await runGit(['rev-parse', 'HEAD'], repoRoot)).stdout);
  let running: CoreComparison | null = null;
  if (/^[a-f0-9]{7,40}$/i.test(runningBuild)) {
    let sha: string | undefined;
    try {
      sha = (await runGit(['rev-parse', '--verify', `${runningBuild}^{commit}`], repoRoot)).stdout;
    } catch {
      // An unavailable or ambiguous build identity remains unknown.
    }
    if (sha) running = await compare(sha);
  }
  const state = tree.branch !== 'core' ? 'invalid_branch' : !tree.isClean ? 'dirty' : coreComparisonState(current);
  return { state, canUpdate: state === 'update_available', current, upstreamSha, upstream: `${remote}/core`, running, runningBuild };
}
