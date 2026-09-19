import { spawnSync } from 'node:child_process';
import { existsSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = realpathSync(fileURLToPath(new URL('..', import.meta.url)));
const cssFiles = new Set(['apps/web/src/index.css', 'apps/web/src/workspace.css', 'apps/web/src/directives.css']);

export function run(binary, args) {
  const result = spawnSync(binary, args, { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: 120000 });
  if (result.error) throw result.error;
  if (result.signal) throw new Error(`${path.basename(binary)} terminated by ${result.signal}`);
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

export function sourceFile(file) {
  const absolute = path.resolve(root, file);
  const relative = path.relative(root, absolute).split(path.sep).join('/');
  if (!/^(apps|packages|scripts)\//.test(relative)) return null;
  if (!/\.(ts|tsx|js|mjs)$/.test(relative) && !cssFiles.has(relative)) return null;
  if (/(^|\/)(node_modules|dist|build|coverage|generated|\.cache|notes|examples)(\/|$)/.test(relative)) return null;
  if (!existsSync(absolute) || !statSync(absolute).isFile()) return null;
  if (realpathSync(absolute) !== absolute) return null;
  const ignored = run('git', ['check-ignore', '--quiet', '--', relative]);
  if (ignored.status === 0) return null;
  if (ignored.status !== 1) throw new Error(ignored.stderr || 'git check-ignore failed');
  return relative;
}

export function trackedSources() {
  const result = run('git', ['ls-files', '-z', '--', 'apps', 'packages', 'scripts']);
  if (result.status !== 0) throw new Error(result.stderr || 'git ls-files failed');
  return result.stdout.split('\0').filter(Boolean).map(sourceFile).filter(Boolean);
}

export function lintFiles(files, fix = false) {
  const sources = files.filter(file => !file.endsWith('.css'));
  if (!sources.length) return { status: 0, stdout: '', stderr: '' };
  return run(path.join(root, 'node_modules/.bin/oxlint'), ['--config', path.join(root, '.oxlintrc.json'), '--format', 'json', ...(fix ? ['--fix'] : []), '--', ...sources]);
}

export function formatFiles(files, check = false) {
  if (!files.length) return { status: 0, stdout: '', stderr: '' };
  return run(path.join(root, 'node_modules/.bin/dprint'), [check ? 'check' : 'fmt', '--config', path.join(root, 'dprint.json'), '--', ...files]);
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const command = process.argv[2];
  if (!['format', 'format-check', 'lint', 'lint-fix'].includes(command)) throw new Error('Expected format, format-check, lint or lint-fix');
  const files = trackedSources();
  const result = command.startsWith('format') ? formatFiles(files, command === 'format-check') : lintFiles(files, command === 'lint-fix');
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  process.exitCode = result.status;
}
