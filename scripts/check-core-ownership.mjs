import { execFileSync } from 'node:child_process';
import { workspaceOwnedRoots } from './lib/workspace-agent-merge.mjs';

const git = (...args) => execFileSync('git', args, {encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
const branch = git('branch', '--show-current');
if (branch === 'core' || process.argv.includes('--core')) {
  const forbidden = git('ls-files', '-z', '--', ...workspaceOwnedRoots).split('\0').filter(Boolean);
  if (forbidden.length) {
    console.error(`Core cannot track workspace settings:\n${forbidden.join('\n')}\nKeep product guidance under docs/agent/product and examples under examples/.`);
    process.exitCode = 1;
  } else console.log('Core workspace Agent ownership check passed.');
} else console.log('Workspace branch: Agent settings remain tracked normally.');
