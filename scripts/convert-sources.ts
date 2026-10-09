import { execFileSync } from 'node:child_process';
import readline from 'node:readline/promises';
import { applyConvertedRepository, type ConvertedRepository, loadRepositoryMappings, mappedRepositoryEntry, planSourceConversion, serverConfigFile, type SourceConversionPlan } from '../packages/core/src/index.js';
import { resolveWorkspaceRoot } from './lib/workspace-root.js';

const git = (root: string, args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const quote = (text: string) => `'${text.replaceAll("'", "'\\''")}'`;
const log = (line: string) => console.log(`[convert-sources] ${line}`);
const flag = (name: string) => process.argv.includes(name);

/** The files of `files` with uncommitted changes, untracked ones included. */
const dirtyFiles = (root: string, files: string[]) => git(root, ['status', '--porcelain', '-z', '--', ...files]).split('\0').filter(Boolean).map(entry => entry.slice(3));

function describe(plan: SourceConversionPlan) {
  log(`Plan for ${plan.converting.root} (${plan.converting.file}):`);
  for (const target of plan.targets) {
    const what = [target.added.length ? `adds notebook(s) ${target.added.join(', ')}` : '', target.present.length ? `already has ${target.present.join(', ')} from an earlier run` : ''].filter(Boolean).join('; ');
    log(`  ${target.label} (${target.root}): ${what}${target.action === 'none' ? ', nothing to write' : target.created ? `, creating ${target.file}:` : ` in ${target.file}, keeping its title, default notebook and preferences`}`);
    if (target.created) { for (const line of target.text.trimEnd().split('\n')) console.log(`      ${line}`); }
  }
  const moved = plan.targets.flatMap(target => [...target.added, ...target.present]);
  if (plan.converting.action === 'delete') log(`  ${plan.converting.root}: every notebook leaves, so ${plan.converting.file} is deleted and the repository is removed from mygitnotes.server.yaml (--remove-emptied).`);
  else log(`  ${plan.converting.root}: ${moved.length ? `removes notebook(s) ${moved.join(', ')}, ` : ''}drops source and sets schema_version 4 in ${plan.converting.file}.`);
  if (plan.defaultNotebook) log(`  ${plan.converting.file}: default_notebook changes from ${plan.defaultNotebook.from}, which moves to another repository, to ${plan.defaultNotebook.to}.`);
  for (const entry of plan.legacyEntries) log(`  ${entry.file} in ${plan.converting.root} names notebook ${entry.notebookId} ${entry.count} time(s); those entries were written before each notebook kept its documents in its own repository and stay where they are.`);
}

/** Asks before writing; without a terminal the plan is only shown unless `--yes` confirms it. */
async function confirmed(): Promise<boolean> {
  if (flag('--yes')) return true;
  if (!process.stdin.isTTY) {
    log('Nothing was written. Run again with --yes to apply this plan.');
    return false;
  }
  const prompt = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await prompt.question('[convert-sources] Write and commit these changes? [y/N] ');
  prompt.close();
  if (/^y(es)?$/i.test(answer.trim())) return true;
  log('Nothing was written.');
  return false;
}

/** Writes and commits one repository's part; on failure, names what was written and how to commit it. */
function apply(repository: ConvertedRepository, message: string): boolean {
  try {
    applyConvertedRepository(repository);
  } catch (error) {
    console.error(`[convert-sources] Writing ${repository.file} in ${repository.root} failed: ${(error as Error).message}. Nothing else was written; fix it and run pnpm convert-sources again.`);
    return false;
  }
  try {
    git(repository.root, ['add', '--all', '--', repository.file]);
    git(repository.root, ['commit', '-m', message, '--only', '--', repository.file]);
    log(`${repository.root}: committed.`);
    return true;
  } catch (error) {
    const reason = String((error as { stderr?: unknown; }).stderr || (error as Error).message).trim().split('\n')[0];
    console.error(`[convert-sources] ${repository.root}: ${repository.file} was written but not committed (${reason}). Commit it yourself, then run pnpm convert-sources again to finish:\n  git -C ${quote(repository.root)} add --all -- ${quote(repository.file)} && git -C ${quote(repository.root)} commit -m ${quote(message)} --only -- ${quote(repository.file)}`);
    return false;
  }
}

try {
  const root = resolveWorkspaceRoot();
  const checkout = process.cwd();
  const removeEmptied = flag('--remove-emptied');
  const plan = planSourceConversion(root, { mappings: loadRepositoryMappings(checkout), removeEmptied, dirtyFiles });
  if (!plan) {
    log(`${root} has no notebook with source; nothing to convert.`);
    process.exit(0);
  }
  const serverFile = serverConfigFile(checkout);
  const entry = plan.emptied ? mappedRepositoryEntry(serverFile, root) : null;
  describe(plan);
  if (!await confirmed()) process.exit(0);
  // Each notebook reaches its own repository's manifest before it leaves the converting one, so a run that stops
  // part way is run again: notebooks already present, identically, are skipped.
  for (const target of plan.targets.filter(candidate => candidate.action === 'write')) {
    const moved = target.added.length ? target.added.join(', ') : 'its notebooks';
    if (!apply(target, `chore(workspace): take notebook(s) ${moved} into this repository's manifest`)) process.exit(1);
  }
  if (!apply(plan.converting, plan.converting.action === 'delete' ? 'chore(workspace): remove the manifest whose notebooks moved to their own repositories' : 'chore(workspace): move notebooks with source to their own repositories')) process.exit(1);
  if (entry) {
    entry.remove();
    log(`Removed ${root} from repositories in ${serverFile}.`);
  }
  log('Converted. Restart the server so it reads every repository from its own manifest.');
} catch (error) {
  console.error(`[convert-sources] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
