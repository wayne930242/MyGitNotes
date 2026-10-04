export interface PullFailure {
  code: string;
  message: string;
  files: string[];
}

/** An English prompt a local coding agent can act on to finish a pull the sidebar button could not complete. */
export function pullFailurePrompt({ code, message, files }: PullFailure, repoRoot: string): string {
  const where = repoRoot ? `the Git repository at ${repoRoot}` : 'my MyGitNotes workspace repository';
  const fileList = files.length ? `\nConflicting files:\n${files.map(file => `- ${file}`).join('\n')}\n` : '';
  const rules = 'Keep the intent of both sides when resolving; ask me when a hunk cannot be merged sensibly. Do not push, force anything, or discard my changes.';
  if (code === 'STASH_CONFLICT') {
    return `In ${where}, main was just pulled from its upstream, but my uncommitted changes conflict with the pulled commits. They are saved in stash@{0} and the worktree matches the pulled HEAD.\n${fileList}\nRun \`git stash pop\`, resolve the conflicts in the working tree, then \`git restore --staged .\` so the result stays uncommitted, and \`git stash drop\` only after every conflict is resolved. ${rules}`;
  }
  if (code === 'CONFLICT') {
    return `In ${where}, pulling main from its upstream stopped because my local commits conflict with the remote commits. The rebase was aborted and nothing changed.\n${fileList}\nStash any uncommitted changes, run \`git pull --rebase\`, resolve each conflict and \`git rebase --continue\` until it finishes, then pop the stash. ${rules}`;
  }
  return `In ${where}, pulling main from its upstream (fetch, then rebase onto the upstream) failed with:\n\n${message}\n${fileList}\nDiagnose the cause and fix it so main is up to date with its upstream. ${rules}`;
}
