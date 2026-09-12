import { createApp, applicationRoot } from './app.js';
try { process.loadEnvFile(`${applicationRoot()}/.env`); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
const app = createApp(applicationRoot());
const port = Number(process.env.PORT || 4321);
app.listen(port, '127.0.0.1', () => console.log(`[local-server] http://127.0.0.1:${port}`));
