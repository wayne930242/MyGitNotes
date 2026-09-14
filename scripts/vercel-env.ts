import fs from 'node:fs';
import { loadSourceConfig } from '../packages/core/src/source-config.js';
import { spawnSync } from 'node:child_process';

// Node parses .env without executing shell expressions. Values pass through stdin.
process.loadEnvFile('.env');
if (!fs.existsSync('.vercel/project.json')) throw new Error('Link the intended project with vercel link first.');
const environment = process.argv[2] || 'production';
if (!['production', 'preview', 'development'].includes(environment)) throw new Error('Use production, preview or development.');
const names = ['MYGITNOTES_SOURCE', 'MYGITNOTES_REPOSITORY', 'MYGITNOTES_BRANCH', 'MYGITNOTES_GITLAB_URL', 'GITLAB_CLIENT_ID', 'GITLAB_CLIENT_SECRET', 'GITHUB_CLIENT_ID',
  'GITHUB_CLIENT_SECRET', 'GITHUB_APP_TYPE', 'APP_URL', 'SESSION_SECRET', 'MYGITNOTES_SESSION_NAMESPACE', 'UPSTASH_REDIS_REST_URL',
  'UPSTASH_REDIS_REST_TOKEN', 'GEMINI_API_KEY'];
if (loadSourceConfig(process.cwd()).type === 'local') throw new Error('Configure a GitHub or GitLab source in .env before importing a Vercel deployment.');
if (environment === 'production' && (!process.env.APP_URL || !process.env.APP_URL.startsWith('https://'))) throw new Error('Set APP_URL (e.g. https://your-project.vercel.app) before importing production environment.');
for (const name of names) {
  const value = process.env[name] ?? (name.startsWith('MYGITNOTES_') ? process.env[name.replace('MYGITNOTES_', 'GITHUB_NOTES_')] : undefined)
    ?? (name === 'MYGITNOTES_GITLAB_URL' ? process.env.GITLAB_URL : undefined);
  if (!value) continue;
  const result = spawnSync('vercel', ['env', 'add', name, environment, '--force', '--yes', ...(/SECRET|TOKEN|API_KEY/.test(name) && environment !== 'development' ? ['--sensitive'] : [])], { input: value, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
  if (result.status !== 0) throw new Error(`Could not import ${name}. Check Vercel access and CLI support for env add --force.`);
  console.log(`Imported ${name} (${environment}).`);
}
console.log('Redeploy with vercel --prod to apply the new environment.');
