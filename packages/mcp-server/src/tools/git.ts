import {
  getGitStatus,
  stageAndCommit,
  updateCore,
  coreUpdateCheckout,
  runGit,
} from '@mygitnotes/git';
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

const coreCheckout = (ctx: ToolContext) => coreUpdateCheckout(ctx.productRoot ?? ctx.repoRoot, ctx.repoRoot);

export async function handleCheckCoreUpdate(ctx: ToolContext) {
  const checkout = await coreCheckout(ctx);
  try {
    const { stdout: remotes } = await runGit(['remote'], checkout);
    const remote = remotes.includes('upstream') ? 'upstream' : 'origin';
    await runGit(['fetch', remote, 'core'], checkout);

    const { stdout: currentHash } = await runGit(['rev-parse', 'HEAD'], checkout);
    const { stdout: coreHash } = await runGit(['rev-parse', `${remote}/core`], checkout);

    let isUpToDate = false;
    try {
      await runGit(['merge-base', '--is-ancestor', `${remote}/core`, 'HEAD'], checkout);
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
  args: { autoPush?: boolean; checkOnly?: boolean } = {}
) {
  if (args.checkOnly) {
    return handleCheckCoreUpdate(ctx);
  }
  const checkout = await coreCheckout(ctx);
  const result = await updateCore({ repoRoot: checkout, autoPush: args.autoPush });
  return { result };
}
