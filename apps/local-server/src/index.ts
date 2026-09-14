import { createApp, applicationRoot } from './app.js';
try { process.loadEnvFile(`${applicationRoot()}/.env`); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
const port = Number(process.env.PORT || 4321);
const host = process.env.HOST || '127.0.0.1';
if (process.argv.includes('--local')) {
  process.env.MYGITNOTES_SOURCE = 'local';
  process.env.MYGITNOTES_LOCAL_PATH = process.env.REPO_ROOT || process.env.MYGITNOTES_LOCAL_PATH || process.env.GITHUB_NOTES_LOCAL_PATH || applicationRoot();
  process.env.APP_URL = `http://localhost:${port}`;
}
const app = createApp(applicationRoot());
app.listen(port, host, () => console.log(`[local-server] http://${host}:${port}`));
