import {
  getGitStatus,
  stageAndCommit,
  updateCore,
  runGit,
} from '@github-notes/git';
import { assertSafeRepoPath } from '../guards.js';
import type { ToolContext } from './context.js';

export async function handleGetGitStatus(ctx: ToolContext) {
  const status = await getGitStatus(ctx.repoRoot);
  return { status };
}

export async function handleGitCommit(
  ctx: ToolContext,
  args: { files: string[]; message: string }
) {
  for (const f of args.files) {
    assertSafeRepoPath(ctx.repoRoot, f);
  }
  const result = await stageAndCommit(ctx.repoRoot, args.files, args.message);
  return { success: true, commit: result };
}

export async function handleCheckCoreUpdate(ctx: ToolContext) {
  try {
    const { stdout: remotes } = await runGit(['remote'], ctx.repoRoot);
    const remote = remotes.includes('upstream') ? 'upstream' : 'origin';
    await runGit(['fetch', remote, 'core'], ctx.repoRoot);

    const { stdout: currentHash } = await runGit(['rev-parse', 'HEAD'], ctx.repoRoot);
    const { stdout: coreHash } = await runGit(['rev-parse', `${remote}/core`], ctx.repoRoot);

    let isUpToDate = false;
    try {
      await runGit(['merge-base', '--is-ancestor', `${remote}/core`, 'HEAD'], ctx.repoRoot);
      isUpToDate = true;
    } catch {
      isUpToDate = false;
    }

    return {
      remoteUsed: remote,
      currentHash,
      coreHash,
      isUpToDate,
    };
  } catch (err: unknown) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

export async function handleUpdateCore(
  ctx: ToolContext,
  args: { autoPush?: boolean }
) {
  const result = await updateCore({
    repoRoot: ctx.repoRoot,
    autoPush: args.autoPush,
  });
  return { result };
}
