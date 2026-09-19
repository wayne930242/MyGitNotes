import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSync } from 'oxc-parser';
import { transformSync } from 'esbuild';

export const root = realpathSync(fileURLToPath(new URL('..', import.meta.url)));

export function run(binary, args, input) {
  const result = spawnSync(binary, args, { input, cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: 120000 });
  if (result.error) throw result.error;
  if (result.signal) throw new Error(`${path.basename(binary)} terminated by ${result.signal}`);
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

export function sourceFile(file) {
  const absolute = path.resolve(root, file);
  const relative = path.relative(root, absolute).split(path.sep).join('/');
  if (!/^(apps|packages|scripts)\//.test(relative)) return null;
  if (!/\.(ts|tsx|js|mjs)$/.test(relative) && !/^apps\/.*\.css$/.test(relative)) return null;
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

// Use the same JSX compiler as Vite for text folding and entity decoding.
function preserveJsxWhitespace(file, source) {
  if (!/\.(tsx|jsx|js|mjs)$/.test(file) || !source.includes('<')) return source;
  const parsed = parseSync(file, source);
  if (parsed.errors.length) return source; // dprint reports the original syntax diagnostics.
  const nodes = [];
  const visit = node => {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'JSXText') {
      nodes.push(node);
      return;
    }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === 'object') visit(value);
    }
  };
  visit(parsed.program);
  if (!nodes.length) return source;
  const fragments = nodes.map(node => `<>${source.slice(node.start, node.end)}</>`);
  const compiled = transformSync(`const texts = [${fragments.join(',')}];`, { loader: 'tsx', jsx: 'transform', jsxFactory: '__jsx', jsxFragment: '__fragment' }).code;
  const expressions = parseSync('jsx-text.js', compiled).program.body[0].declarations[0].init.elements;
  const replacements = [];
  nodes.forEach((node, index) => {
    const literal = expressions[index].arguments[2];
    if (!literal) {
      replacements.push({ start: node.start, end: node.end, text: '' });
      return;
    }
    if (literal.type !== 'Literal' || typeof literal.value !== 'string') throw new Error('Unexpected compiled JSX text');
    const text = literal.value;
    if (text && /^\s|\s$|[ \t]{2}/.test(text)) replacements.push({ start: node.start, end: node.end, text: `{${JSON.stringify(text)}}` });
  });
  for (const edit of replacements.sort((a, b) => b.start - a.start)) source = source.slice(0, edit.start) + edit.text + source.slice(edit.end);
  return source;
}

export function formatFiles(files, check = false) {
  if (!files.length) return { status: 0, stdout: '', stderr: '' };
  const pending = [];
  for (const file of files) {
    const absolute = path.resolve(root, file);
    const source = readFileSync(absolute, 'utf8');
    const preserved = preserveJsxWhitespace(file, source);
    if (source !== preserved) {
      if (check) {
        // Unlike file mode, dprint stdin applies only one pass. Match its stable file output.
        let input = preserved;
        let stable = false;
        for (let attempt = 0; attempt < 5; attempt++) {
          const formatted = run(path.join(root, 'node_modules/.bin/dprint'), ['fmt', '--config', path.join(root, 'dprint.json'), '--stdin', file], input);
          if (formatted.status !== 0) return formatted;
          if (formatted.stdout === input) {
            stable = true;
            break;
          }
          input = formatted.stdout;
        }
        if (!stable) return { status: 1, stdout: '', stderr: `Formatting did not stabilize: ${file}\n` };
        if (input !== source) pending.push(file);
      } else writeFileSync(absolute, preserved);
    }
  }
  const result = run(path.join(root, 'node_modules/.bin/dprint'), [check ? 'check' : 'fmt', '--config', path.join(root, 'dprint.json'), '--', ...files]);
  if (pending.length) return { ...result, status: result.status || 1, stderr: result.stderr + `JSX whitespace normalization required: ${pending.join(', ')}\n` };
  return result;
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
