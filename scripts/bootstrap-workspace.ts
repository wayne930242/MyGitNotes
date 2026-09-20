import path from 'node:path';
import fs from 'node:fs';
import { getCurrentBranch, runGit, stageAndCommit } from '../packages/git/src/index.js';
import { loadWorkspaceConfig, resolveSafePath, resolveWorkspaceConfigPath, WORKSPACE_CONFIG_FILENAME } from '../packages/core/src/index.js';

const EMPTY_WORKSPACE_CONFIG = `schema_version: 1
workspace:
  title: My Notes
  default_notebook: personal
notebooks:
  - id: personal
    title: Personal
    root: notes/personal
    assets: assets
    default_view: list
files:
  hide_dotfiles: true
`;

// Deployment settings live in GitHub and Vercel, so bootstrap prints the commands and never handles tokens.
const VERCEL_DEPLOY_STEPS = `
   Deploy to Vercel (optional; .github/workflows/deploy-vercel-sparse.yml skips until configured):
  1. Create or link the Vercel project from this Core checkout: vercel link
     Read orgId and projectId from .vercel/project.json.
  2. Disconnect the project's Git integration in Vercel (Settings -> Git).
  3. Import runtime settings: pnpm env:vercel production
     The deployment reads notes from 'main': MYGITNOTES_SOURCE=github, MYGITNOTES_BRANCH=main.
  4. Configure the GitHub repository:
     gh variable set VERCEL_ORG_ID --body <orgId>
     gh variable set VERCEL_PROJECT_ID --body <projectId>
     gh secret set VERCEL_TOKEN   # paste a token from https://vercel.com/account/tokens
  5. Push 'core' and 'main'. Pushes to 'core' deploy production; note pushes to 'main' do not.
     Run it manually with: gh workflow run deploy-vercel-sparse.yml --ref core
   To let Vercel Git integration deploy instead (production branch 'core'): gh variable set MYGITNOTES_VERCEL_DEPLOY --body git-integration`;

const git = async (args: string[], cwd: string) => (await runGit(args, cwd)).stdout.trim();

/** The worktree that has 'main' checked out, if any. */
async function mainWorktree(productRoot: string): Promise<string | undefined> {
  const blocks = (await git(['worktree', 'list', '--porcelain'], productRoot)).split('\n\n');
  const block = blocks.find(entry => entry.split('\n').includes('branch refs/heads/main'));
  return block?.split('\n').find(line => line.startsWith('worktree '))?.slice('worktree '.length);
}

/** Points the Core checkout's local server at the workspace worktree, keeping the rest of .env. */
function writeLocalPath(productRoot: string, workspace: string) {
  const envFile = path.join(productRoot, '.env');
  const relative = path.relative(fs.realpathSync(productRoot), fs.realpathSync(workspace)).split(path.sep).join('/');
  const lines = fs.existsSync(envFile) ? fs.readFileSync(envFile, 'utf8').split('\n') : [];
  const set = (key: string, value: string) => {
    const index = lines.findIndex(line => line.startsWith(`${key}=`));
    if (index >= 0) lines[index] = `${key}=${value}`;
    else lines.splice(lines.length && lines.at(-1) === '' ? lines.length - 1 : lines.length, 0, `${key}=${value}`);
  };
  set('MYGITNOTES_SOURCE', 'local');
  set('MYGITNOTES_LOCAL_PATH', relative);
  if (lines.at(-1) !== '') lines.push('');
  fs.writeFileSync(envFile, lines.join('\n'));
  return relative;
}

async function bootstrapWorkspace() {
  const productRoot = process.cwd();
  const withExamples = !process.argv.includes('--no-examples');
  const pathIndex = process.argv.indexOf('--path');
  if (pathIndex >= 0 && (!process.argv[pathIndex + 1] || process.argv[pathIndex + 1].startsWith('--'))) throw new Error('--path requires a directory for the main worktree.');

  // 1. Verify this is a MyGitNotes Core checkout
  if (!fs.existsSync(path.join(productRoot, 'pnpm-workspace.yaml')) || !fs.existsSync(path.join(productRoot, 'packages/core'))) {
    console.error('[bootstrap] Error: This directory does not appear to be a MyGitNotes repository.');
    process.exit(1);
  }
  const currentBranch = await getCurrentBranch(productRoot);
  if (currentBranch === 'main') {
    throw new Error("This checkout is a fork-model 'main' that carries the product. Run `pnpm convert-workspace` to make 'main' content-only, then bootstrap from a 'core' checkout.");
  }

  // 2. Find or create the content-only main worktree
  const existing = await mainWorktree(productRoot);
  const hasMain = Boolean(await git(['branch', '--list', 'main'], productRoot));
  // A clone of an existing workspace has its content on origin/main; an orphan would split its history.
  const remoteMain = !hasMain && Boolean(await git(['branch', '--list', '--remotes', 'origin/main'], productRoot));
  const mainRef = hasMain ? 'main' : remoteMain ? 'origin/main' : undefined;
  if (mainRef && await git(['ls-tree', '--name-only', mainRef, '--', 'pnpm-workspace.yaml'], productRoot)) {
    throw new Error(`Branch '${mainRef}' still carries the product. Run \`pnpm convert-workspace\` in its checkout first.`);
  }
  const repoRoot = existing ?? (pathIndex >= 0 ? path.resolve(process.argv[pathIndex + 1]) : path.join(path.dirname(productRoot), `${path.basename(productRoot)}-notes`));
  if (!existing) {
    if (hasMain) {
      console.log(`[bootstrap] Adding a worktree for the existing 'main' at ${repoRoot}...`);
      await runGit(['worktree', 'add', repoRoot, 'main'], productRoot);
    } else if (remoteMain) {
      console.log(`[bootstrap] Adding a worktree for 'origin/main' at ${repoRoot}...`);
      await runGit(['worktree', 'add', '--track', '-b', 'main', repoRoot, 'origin/main'], productRoot);
    } else {
      console.log(`[bootstrap] Creating the content-only 'main' branch in a worktree at ${repoRoot}...`);
      await runGit(['worktree', 'add', '--orphan', '-b', 'main', repoRoot], productRoot);
    }
  } else console.log(`[bootstrap] Using the 'main' worktree at ${repoRoot}.`);

  // Core owns the template; initialization copies only missing workspace files.
  const template = path.join(productRoot, 'examples/demo-workspace');
  const filesToStage: string[] = [];
  let needsCommit = false;
  const copyMissing = (source: string, relative: string) => {
    const target = resolveSafePath(repoRoot, relative);
    if (fs.existsSync(target)) return;
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL);
    filesToStage.push(relative);
    needsCommit = true;
  };
  const rootConfig = resolveSafePath(repoRoot, WORKSPACE_CONFIG_FILENAME);
  if (!resolveWorkspaceConfigPath(repoRoot)) {
    if (withExamples) copyMissing(path.join(template, WORKSPACE_CONFIG_FILENAME), WORKSPACE_CONFIG_FILENAME);
    else {
      fs.writeFileSync(rootConfig, EMPTY_WORKSPACE_CONFIG, { flag: 'wx' });
      filesToStage.push(WORKSPACE_CONFIG_FILENAME);
      needsCommit = true;
    }
  }
  const config = loadWorkspaceConfig(repoRoot);
  if (!config) throw new Error('Workspace configuration could not be loaded.');
  const copyDirectory = (directory: string, relative: string) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const source = path.join(directory, entry.name);
      const target = path.posix.join(relative, entry.name);
      if (entry.isDirectory()) copyDirectory(source, target);
      else if (entry.isFile()) copyMissing(source, target);
    }
  };
  copyDirectory(path.join(productRoot, 'examples/workspace-agent-system'), '');
  copyMissing(path.join(productRoot, 'packages/core/assets/mygitnotes-core-sync.yml'), '.github/workflows/mygitnotes-core-sync.yml');
  if (withExamples && config.notebooks.some(notebook => notebook.id === 'example' && notebook.root === 'notes/example')) {
    copyDirectory(path.join(template, 'notes/example'), 'notes/example');
    fs.mkdirSync(resolveSafePath(repoRoot, 'notes/example/assets'), { recursive: true });
  }
  if (withExamples && config.notebooks.some(notebook => notebook.id === 'learning' && notebook.root === 'notes/learning')) {
    copyDirectory(path.join(template, 'notes/learning'), 'notes/learning');
  }
  if (withExamples && fs.existsSync(path.join(template, '.github-notes-screen.yaml')) && !fs.existsSync(resolveSafePath(repoRoot, '.github-notes-screen.yaml'))) {
    copyMissing(path.join(template, '.github-notes-screen.yaml'), '.github-notes-screen.yaml');
  }

  const notesAgentsPath = resolveSafePath(repoRoot, 'notes/AGENTS.md');
  if (!fs.existsSync(notesAgentsPath)) {
    fs.mkdirSync(path.dirname(notesAgentsPath), { recursive: true });
    fs.writeFileSync(notesAgentsPath, `# MyGitNotes Workspace Agent System\n\nOperational guidelines for AI agents working within this note repository.\n`);
    filesToStage.push('notes/AGENTS.md');
    needsCommit = true;
  }

  // 6. Commit user initialization
  if (needsCommit && filesToStage.length > 0) {
    console.log(`[bootstrap] Creating initial user workspace commit on 'main'...`);
    const { commitHash } = await stageAndCommit(repoRoot, filesToStage, 'chore(workspace): initialize user workspace');
    console.log(`[bootstrap] Initialized commit: ${commitHash.slice(0, 7)}`);
  } else {
    console.log(`[bootstrap] Workspace files already up to date.`);
  }

  const localPath = writeLocalPath(productRoot, repoRoot);

  console.log(`\n======================================================`);
  console.log(`✅ MyGitNotes workspace ready on branch 'main' at ${repoRoot}!`);
  console.log(`   - .env: MYGITNOTES_LOCAL_PATH=${localPath}`);
  console.log(`   - Config: ${WORKSPACE_CONFIG_FILENAME}`);
  console.log(`   - Default Notebook: ${config.workspace.default_notebook}`);
  console.log(`   - Next steps: Run 'pnpm dev' here (the Core checkout) to launch the application.`);
  console.log(VERCEL_DEPLOY_STEPS);
  console.log(`======================================================\n`);
}

bootstrapWorkspace().catch((err) => {
  console.error('[bootstrap] Failed to bootstrap workspace:', err);
  process.exit(1);
});
