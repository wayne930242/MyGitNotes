import path from 'node:path';
import fs from 'node:fs';
import { runGit, getCurrentBranch, stageAndCommit } from '../packages/git/src/index.js';
import { WORKSPACE_CONFIG_FILENAME, loadWorkspaceConfig, resolveSafePath } from '../packages/core/src/index.js';

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

async function bootstrapWorkspace() {
  const repoRoot = process.cwd();
  const withExamples = !process.argv.includes('--no-examples');
  console.log(`[bootstrap] Starting workspace initialization for: ${repoRoot}`);

  // 1. Verify this is a MyGitNotes clone
  const workspaceMarker = path.join(repoRoot, 'pnpm-workspace.yaml');
  const packagesCore = path.join(repoRoot, 'packages/core');
  if (!fs.existsSync(workspaceMarker) || !fs.existsSync(packagesCore)) {
    console.error('[bootstrap] Error: This directory does not appear to be a MyGitNotes repository.');
    process.exit(1);
  }

  // 2. Check current branch
  const currentBranch = await getCurrentBranch(repoRoot);
  console.log(`[bootstrap] Current active branch: ${currentBranch}`);

  // 3. Create or switch to main safely
  if (currentBranch !== 'main') {
    const { stdout: branches } = await runGit(['branch', '--list', 'main'], repoRoot);
    if (branches.trim()) {
      console.log(`[bootstrap] Switching to existing 'main' branch...`);
      await runGit(['checkout', 'main'], repoRoot);
    } else {
      console.log(`[bootstrap] Creating and switching to new 'main' user workspace branch...`);
      await runGit(['checkout', '-b', 'main'], repoRoot);
    }
  }

  // Core owns the template; initialization copies only missing workspace files.
  const template = path.join(repoRoot, 'examples/demo-workspace');
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
  const notesConfig = resolveSafePath(repoRoot, `notes/${WORKSPACE_CONFIG_FILENAME}`);
  const rootConfig = resolveSafePath(repoRoot, WORKSPACE_CONFIG_FILENAME);
  if (!fs.existsSync(notesConfig) && !fs.existsSync(rootConfig)) {
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
  copyDirectory(path.join(repoRoot, 'examples/workspace-agent-system'), '');
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
    fs.writeFileSync(
      notesAgentsPath,
      `# MyGitNotes Workspace Agent System\n\nOperational guidelines for AI agents working within this note repository.\n`
    );
    filesToStage.push('notes/AGENTS.md');
    needsCommit = true;
  }

  // 6. Commit user initialization
  if (needsCommit && filesToStage.length > 0) {
    console.log(`[bootstrap] Creating initial user workspace commit on 'main'...`);
    const { commitHash } = await stageAndCommit(
      repoRoot,
      filesToStage,
      'chore(workspace): initialize user workspace'
    );
    console.log(`[bootstrap] Initialized commit: ${commitHash.slice(0, 7)}`);
  } else {
    console.log(`[bootstrap] Workspace files already up to date.`);
  }

  console.log(`\n======================================================`);
  console.log(`✅ MyGitNotes workspace ready on branch 'main'!`);
  console.log(`   - Config: ${WORKSPACE_CONFIG_FILENAME}`);
  console.log(`   - Default Notebook: ${config.workspace.default_notebook}`);
  console.log(`   - Next steps: Run 'pnpm dev' to launch the application.`);
  console.log(`======================================================\n`);
}

bootstrapWorkspace().catch((err) => {
  console.error('[bootstrap] Failed to bootstrap workspace:', err);
  process.exit(1);
});
