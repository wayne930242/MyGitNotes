import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { nonDeployPaths } from './vercel-sparse-non-deploy-paths.mjs';

const listFile = '.github/vercel-sparse-paths.txt';
const workflowFile = '.github/workflows/deploy-vercel-sparse.yml';

const git = (...args) => execFileSync('git', args, {encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
if (git('branch', '--show-current') !== 'core' && !process.argv.includes('--core')) {
  console.log('Workspace branch: the Vercel sparse path list is verified on Core.');
  process.exit(0);
}
const listed = fs.readFileSync(listFile, 'utf8').split('\n').map(line => line.trim()).filter(line => line && !line.startsWith('#'));
const topLevel = git('ls-files', '-z').split('\0').filter(Boolean).map(file => file.split('/')[0]);
const errors = [];
for (const entry of new Set(topLevel)) {
  if (!listed.some(path => path.split('/')[0] === entry) && !nonDeployPaths.includes(entry)) errors.push(`Top-level path '${entry}' is neither in ${listFile} nor a known non-deploy path.`);
}
for (const path of listed) {
  if (!git('ls-files', '--', path)) errors.push(`${listFile} lists '${path}', which Core does not track.`);
}
const deployed = file => listed.some(entry => file === entry || file.startsWith(`${entry}/`));
const trackedFiles = git('ls-files', '-z').split('\0').filter(Boolean);
for (const file of trackedFiles.filter(file => deployed(file) && /\.(?:[cm]?[jt]sx?)$/.test(file))) {
  if (!fs.existsSync(file)) continue;
  for (const [, specifier] of fs.readFileSync(file, 'utf8').matchAll(/(?:from|import\s*\(?|require\s*\()\s*['"](\.{1,2}\/[^'"]+)['"]/g)) {
    const target = path.posix.normalize(path.posix.join(path.posix.dirname(file), specifier));
    if (!deployed(target) && trackedFiles.some(tracked => tracked === target || tracked.startsWith(`${target}/`) || tracked.startsWith(`${target}.`))) errors.push(`${file} imports '${specifier}', outside ${listFile}.`);
  }
}
const block = fs.readFileSync(workflowFile, 'utf8').match(/\n    paths:\n((?:      - .*\n)+)/);
const filters = block ? [...block[1].matchAll(/- '([^']+)'/g)].map(match => match[1]) : [];
const expected = listed.map(path => fs.statSync(path).isDirectory() ? `${path}/**` : path);
if (JSON.stringify(filters) !== JSON.stringify(expected)) errors.push(`${workflowFile} push paths must equal ${listFile}:\n  ${expected.join('\n  ')}`);
if (errors.length) {
  console.error(errors.join('\n'));
  process.exitCode = 1;
} else console.log('Vercel sparse path list check passed.');
