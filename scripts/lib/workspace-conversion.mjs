import { execFileSync } from 'node:child_process';

const SPARSE_LIST = '.github/vercel-sparse-paths.txt';
// Root paths a workspace owns even where a fork-model main shares a namespace with Core.
const workspaceOwnedRoots = ['AGENTS.md', 'CLAUDE.md', 'GEMINI.md', '.agents', '.codex', '.claude', '.agent', '.github-notes-screen.yaml', '.github-notes-study.yaml', '.github-notes-focus.yaml'];

/** Core's product paths at `coreRevision`: its sparse deploy list without .github. */
export function coreProductPaths(git, coreRevision) {
  let list;
  try { list = git('show', `${coreRevision}:${SPARSE_LIST}`); }
  catch { throw Error(`Core ${coreRevision} does not track ${SPARSE_LIST}, which names its product paths.`); }
  return list.split('\n').map(line => line.trim()).filter(line => line && !line.startsWith('#') && line.split('/')[0] !== '.github');
}

/**
 * Plans which tracked files leave a fork-model main when it becomes content-only.
 * Product paths (the sparse deploy list of `listRevision`, except .github) leave whole.
 * In every other Core namespace only files byte-identical to the merged Core revision leave,
 * so workspace-owned files there (docs/specs, an edited docs/CONTEXT.md or .gitignore) stay.
 */
export function planWorkspaceConversion(repoRoot, coreRevision, listRevision = coreRevision) {
  const git = (...args) => execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 });
  const listTree = revision => new Map(git('ls-tree', '-r', '-z', '--full-tree', revision).split('\0').filter(Boolean)
    .map(line => { const [meta, file] = line.split('\t'); return [file, meta.split(' ')[2]]; }));
  const head = listTree('HEAD');
  const core = listTree(coreRevision);
  const productPaths = coreProductPaths(git, listRevision);
  const product = file => productPaths.some(entry => file === entry || file.startsWith(`${entry}/`));
  const coreRoots = new Set([...core.keys()].map(file => file.split('/')[0]));
  const owned = file => workspaceOwnedRoots.some(root => file === root || file.startsWith(`${root}/`));
  const remove = [];
  const kept = [];
  for (const [file, blob] of head) {
    const top = file.split('/')[0];
    if (owned(file) || !coreRoots.has(top)) continue;
    if (product(file) || core.get(file) === blob) remove.push(file);
    else kept.push(file);
  }
  return { remove, kept };
}
