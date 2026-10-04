import fs from 'node:fs';
import path from 'node:path';
import { parseEnv } from 'node:util';
import { assertWorkspaceCompatible, loadWorkspaceConfig } from '../packages/core/src/index.js';

try {
  const args = process.argv.slice(2);
  if (args.length !== 1 || !args[0] || args[0].startsWith('-')) throw new Error('Usage: pnpm link-workspace <path>');
  const checkout = process.cwd();
  if (!fs.existsSync(path.join(checkout, 'pnpm-workspace.yaml')) || !fs.existsSync(path.join(checkout, 'packages/core'))) throw new Error('Run this command from a MyGitNotes Core checkout.');
  const workspace = fs.realpathSync(path.resolve(args[0]));
  if (!fs.statSync(workspace).isDirectory()) throw new Error('The workspace path must be a directory.');
  assertWorkspaceCompatible(workspace);
  if (!loadWorkspaceConfig(workspace)) throw new Error('Workspace configuration could not be loaded.');

  // Node's dotenv parser uses the last assignment. Append overrides rather than rewriting
  // existing entries: exported/duplicate keys and unrelated multiline values stay intact.
  const quote = ["'", '"', '`'].find(delimiter => !workspace.includes(delimiter));
  if (!quote || /[\r\n]/.test(workspace)) throw new Error('The workspace path cannot be represented safely in .env.');
  const file = path.join(checkout, '.env');
  const previous = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const before = parseEnv(previous);
  const next = `${previous}${previous && !previous.endsWith('\n') ? '\n' : ''}MYGITNOTES_SOURCE=local\nMYGITNOTES_LOCAL_PATH=${quote}${workspace}${quote}\n`;
  const after = parseEnv(next);
  if (after.MYGITNOTES_SOURCE !== 'local' || after.MYGITNOTES_LOCAL_PATH !== workspace || Object.entries(before).some(([key, value]) => !['MYGITNOTES_SOURCE', 'MYGITNOTES_LOCAL_PATH'].includes(key) && after[key] !== value)) {
    throw new Error('Cannot safely update .env; fix its quoting before linking a workspace.');
  }
  if (before.MYGITNOTES_SOURCE !== 'local' || before.MYGITNOTES_LOCAL_PATH !== workspace) fs.writeFileSync(file, next, { mode: 0o600 });
  console.log(`[link-workspace] Linked ${workspace} in ${file}. Run pnpm dev or pnpm dev:remote. Existing shell environment overrides still take precedence over .env.`);
} catch (error) {
  console.error(`[link-workspace] ${(error as Error).message}`);
  process.exitCode = 1;
}
