import path from 'node:path';
import fs from 'node:fs';
import { runGit, getCurrentBranch, stageAndCommit } from '../packages/git/src/index.js';
import { WORKSPACE_CONFIG_FILENAME } from '../packages/core/src/index.js';

async function bootstrapWorkspace() {
  const repoRoot = process.cwd();
  console.log(`[bootstrap] Starting workspace initialization for: ${repoRoot}`);

  // 1. Verify this is a GitHub Notes clone
  const agentsPath = path.join(repoRoot, 'AGENTS.md');
  const packagesCore = path.join(repoRoot, 'packages/core');
  if (!fs.existsSync(agentsPath) || !fs.existsSync(packagesCore)) {
    console.error('[bootstrap] Error: This directory does not appear to be a GitHub Notes repository.');
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

  // 4. Check notes/.github-notes.yaml
  const notesConfigPath = path.join(repoRoot, 'notes', WORKSPACE_CONFIG_FILENAME);
  let needsCommit = false;
  const filesToStage: string[] = [];

  if (fs.existsSync(notesConfigPath)) {
    console.log(`[bootstrap] notes/${WORKSPACE_CONFIG_FILENAME} already exists. Preserving configuration.`);
  } else {
    console.log(`[bootstrap] Creating notes/${WORKSPACE_CONFIG_FILENAME} from baseline template...`);
    const notesDir = path.join(repoRoot, 'notes');
    if (!fs.existsSync(notesDir)) {
      fs.mkdirSync(notesDir, { recursive: true });
    }
    fs.writeFileSync(
      notesConfigPath,
      `schema_version: 1\nworkspace:\n  title: "My GitHub Notes"\n  default_notebook: example\nnotebooks:\n  - id: example\n    title: "Example"\n    root: notes/example\n    assets: assets\n    default_view: list\nfiles:\n  hide_dotfiles: true\n`
    );
    filesToStage.push(path.posix.join('notes', WORKSPACE_CONFIG_FILENAME));
    needsCommit = true;
  }

  // 5. Create default notebook folder, note fixture, and agent guidelines
  const targetNotebookDir = path.join(repoRoot, 'notes/example');
  const targetAssetsDir = path.join(targetNotebookDir, 'assets');
  if (!fs.existsSync(targetNotebookDir)) {
    fs.mkdirSync(targetNotebookDir, { recursive: true });
  }
  if (!fs.existsSync(targetAssetsDir)) {
    fs.mkdirSync(targetAssetsDir, { recursive: true });
  }

  const targetNotePath = path.join(targetNotebookDir, 'welcome.md');
  if (!fs.existsSync(targetNotePath)) {
    console.log(`[bootstrap] Creating initial welcome note fixture...`);
    fs.writeFileSync(
      targetNotePath,
      `---\nid: welcome\ntitle: Welcome to GitHub Notes\nstatus: inbox\ntags:\n  - example\n---\n\n# Welcome to GitHub Notes\n\nYour notes workspace is ready.\n`
    );
    filesToStage.push('notes/example/welcome.md');
    needsCommit = true;
  }

  const notesAgentsPath = path.join(repoRoot, 'notes/AGENTS.md');
  if (!fs.existsSync(notesAgentsPath)) {
    fs.writeFileSync(
      notesAgentsPath,
      `# GitHub Notes Workspace Agent System\n\nOperational guidelines for AI agents working within this note repository.\n`
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
  console.log(`✅ GitHub Notes workspace ready on branch 'main'!`);
  console.log(`   - Config: ${WORKSPACE_CONFIG_FILENAME}`);
  console.log(`   - Default Notebook: notes/example/`);
  console.log(`   - Next steps: Run 'pnpm dev' to launch the application.`);
  console.log(`======================================================\n`);
}

bootstrapWorkspace().catch((err) => {
  console.error('[bootstrap] Failed to bootstrap workspace:', err);
  process.exit(1);
});
