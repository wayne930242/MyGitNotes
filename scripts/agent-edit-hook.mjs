import { existsSync, mkdirSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatFiles, lintFiles, root, run, sourceFile } from './source-tools.mjs';

export function editedPaths(event) {
  if (event.hook_event_name !== 'PostToolUse') return [];
  const input = event.tool_input ?? {};
  if (['Edit', 'Write', 'MultiEdit'].includes(event.tool_name)) return typeof input.file_path === 'string' ? [input.file_path] : [];
  if (event.tool_name !== 'apply_patch' || typeof input.command !== 'string') return [];
  const files = [];
  let current;
  for (const line of input.command.split(/\r?\n/)) {
    const match = /^\*\*\* (Add File|Update File|Move to|Delete File): (.+)$/.exec(line);
    if (!match) continue;
    const [, operation, file] = match;
    if (operation === 'Move to') {
      if (current !== undefined) files[current] = file;
    } else if (operation === 'Delete File') {
      current = undefined;
    } else {
      current = files.push(file) - 1;
    }
  }
  return files;
}

function packageConfig(file) {
  let dir = path.dirname(path.join(root, file));
  while (dir !== root) {
    if (existsSync(path.join(dir, 'package.json'))) return existsSync(path.join(dir, 'tsconfig.json')) ? path.join(dir, 'tsconfig.json') : null;
    dir = path.dirname(dir);
  }
  return null;
}

function failures(label, result) {
  return result.status === 0 ? '' : `${label}\n${result.stdout}${result.stderr}`.trim();
}

export function checkEdit(event) {
  const files = [...new Set(editedPaths(event).map(file => sourceFile(path.resolve(event.cwd ?? root, file))).filter(Boolean))];
  if (!files.length) return [];
  const diagnostics = [];
  const configs = new Set();
  for (const file of files) {
    // Lint JSON contains only diagnostics remaining after safe fixes.
    const lint = lintFiles([file], true);
    let report;
    try {
      report = file.endsWith('.css') ? { diagnostics: [] } : JSON.parse(lint.stdout);
    } catch {
      throw new Error(failures(`oxlint ${file}`, lint) || `Invalid oxlint JSON for ${file}`);
    }
    if (report.diagnostics?.length) diagnostics.push(`oxlint ${file}\n${JSON.stringify(report.diagnostics)}`);
    else if (lint.status !== 0) diagnostics.push(failures(`oxlint ${file}`, lint));
    diagnostics.push(failures(`dprint ${file}`, formatFiles([file])));
    const config = packageConfig(file);
    if (config) configs.add(config);
  }
  // Format every edited file before checking a package once, including multi-file patches.
  for (const config of configs) {
    const cache = path.join(root, '.cache/agent-edit-hooks', path.relative(root, path.dirname(config)), 'tsconfig.tsbuildinfo');
    mkdirSync(path.dirname(cache), { recursive: true });
    diagnostics.push(failures(`tsc ${path.relative(root, config)}`, run(path.join(root, 'node_modules/.bin/tsc'), ['--project', config, '--noEmit', '--incremental', '--tsBuildInfoFile', cache, '--pretty', 'false'])));
  }
  return diagnostics.filter(Boolean);
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let diagnostics;
  try {
    diagnostics = checkEdit(JSON.parse(readFileSync(0, 'utf8')));
  } catch (error) {
    diagnostics = [`Edit checks failed: ${error.message}`];
  }
  if (diagnostics.length) process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: diagnostics.join('\n\n') } }) + '\n');
}
