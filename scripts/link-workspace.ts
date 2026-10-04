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
  // Dev gives REPO_ROOT precedence over LOCAL_PATH. Keep an existing selector in sync,
  // but do not introduce it when absent/empty or change shell environment precedence.
  const updates = { MYGITNOTES_SOURCE: 'local', MYGITNOTES_LOCAL_PATH: workspace, ...(before.REPO_ROOT ? { REPO_ROOT: workspace } : {}) };
  const assignments = Object.entries(updates).map(([key, value]) => `${key}=${quote}${value}${quote}\n`).join('');
  const next = `${previous}${previous && !previous.endsWith('\n') ? '\n' : ''}${assignments}`;
  const after = parseEnv(next);
  if (Object.entries(updates).some(([key, value]) => after[key] !== value) || Object.entries(before).some(([key, value]) => !Object.hasOwn(updates, key) && after[key] !== value)) {
    throw new Error('Cannot safely update .env; fix its quoting before linking a workspace.');
  }
  if (Object.entries(updates).some(([key, value]) => before[key] !== value)) fs.writeFileSync(file, next, { mode: 0o600 });
  console.log(`[link-workspace] Linked ${workspace} in ${file}. Run pnpm dev or pnpm dev:remote. Existing shell environment overrides still take precedence over .env.`);
} catch (error) {
  console.error(`[link-workspace] ${(error as Error).message}`);
  process.exitCode = 1;
}
