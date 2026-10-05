// Runs `pnpm dev` and shares the web app over Tailscale Serve, so other devices on your tailnet can open it.
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import net from 'node:net';
import QRCode from 'qrcode';
import { remoteHelp } from './lib/dev-remote-help.mjs';

function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

/** Vite binds whichever loopback address `localhost` resolves to first, so either one may answer. */
async function waitUntilReady(port, deadline) {
  while (Date.now() < deadline) {
    for (const base of [`http://127.0.0.1:${port}`, `http://[::1]:${port}`]) {
      try {
        await fetch(base);
        return;
      } catch {
        // Not listening on this address yet.
      }
    }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error(`web dev server did not become ready on port ${port}`);
}

/** pnpm --parallel moves vite and tsx into their own process groups, so collect the whole tree by parent pid. */
function descendants(pid) {
  const rows = execFileSync('ps', ['-A', '-o', 'pid=,ppid='], { encoding: 'utf-8' }).trim().split('\n').map(row => row.trim().split(/\s+/).map(Number));
  const found = [];
  const queue = [pid];
  while (queue.length) {
    const parent = queue.shift();
    for (const [child, ppid] of rows) {
      if (ppid === parent) {
        found.push(child);
        queue.push(child);
      }
    }
  }
  return found;
}

/** The tailnet host this machine serves on, and the login that owns it; a tagged machine has no owner. */
function tailnetIdentity() {
  let status;
  try {
    status = JSON.parse(execFileSync('tailscale', ['status', '--json'], { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }));
  } catch {
    throw new Error('tailscale is not installed or not running; install it from https://tailscale.com/download and sign in.');
  }
  const host = status.Self?.DNSName?.replace(/\.$/, '');
  if (status.BackendState !== 'Running' || !host) throw new Error('tailscale is not connected; sign in and try again.');
  const owner = status.Self?.Tags?.length ? '' : status.User?.[String(status.Self?.UserID)]?.LoginName ?? '';
  return { host, owner };
}

function copyCommand() {
  if (process.platform === 'darwin') return ['pbcopy'];
  if (process.platform === 'win32') return ['clip'];
  return process.env.WAYLAND_DISPLAY ? ['wl-copy'] : ['xclip', '-selection', 'clipboard'];
}

function copy(text) {
  const [command, ...args] = copyCommand();
  try {
    execFileSync(command, args, { input: text, stdio: ['pipe', 'ignore', 'ignore'] });
    console.log(`Copied ${text}`);
  } catch {
    console.log(`Could not copy with ${command}; the URL is ${text}`);
  }
}

async function main() {
  // Fail before Tailscale setup when the local workspace is missing or incompatible.
  const workspaceCheck = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/check-dev-workspace.ts'], { stdio: 'inherit' });
  if (workspaceCheck.error) throw workspaceCheck.error;
  if (workspaceCheck.status !== 0) {
    console.error(remoteHelp());
    process.exitCode = workspaceCheck.status || 1;
    return;
  }

  const { host, owner } = tailnetIdentity();
  const url = `https://${host}/`;
  const port = await findFreePort();
  const children = [];

  function start(command, args, env) {
    const child = spawn(command, args, { stdio: ['ignore', 'inherit', 'inherit'], env: { ...process.env, ...env } });
    children.push(child);
    child.on('error', error => {
      console.error(`\nCould not start ${command}: ${error.message}`);
      stop(1);
    });
    child.on('exit', (code, signal) => {
      console.error(`\n${command} exited (${signal ?? code}); stopping.`);
      stop(code || 1);
    });
    return child;
  }

  function killChildren() {
    const pids = children.filter(child => child.pid && child.exitCode === null && child.signalCode === null).flatMap(child => [child.pid, ...descendants(child.pid)]);
    for (const pid of pids) {
      try {
        process.kill(pid, 'SIGTERM');
      } catch {
        // Already exited.
      }
    }
  }

  function stop(code) {
    if (code !== 0) console.error(remoteHelp());
    killChildren();
    if (process.stdin.isTTY) process.stdin.setRawMode(false);
    process.exit(code);
  }

  /** Polls the tailnet URL; the first run waits while Tailscale issues the HTTPS certificate. */
  async function waitForServe(deadline) {
    while (Date.now() < deadline) {
      try {
        await fetch(url, { signal: AbortSignal.timeout(10_000) });
        return true;
      } catch {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
    return false;
  }

  // killChildren() is synchronous, so it also cleans up when the script exits through an error.
  process.on('exit', killChildren);
  process.on('SIGINT', () => stop(0));
  process.on('SIGTERM', () => stop(0));

  start('pnpm', ['dev'], { MYGITNOTES_WEB_PORT: String(port), MYGITNOTES_REMOTE_ORIGIN: `https://${host}`, MYGITNOTES_REMOTE_OWNER: owner });
  await waitUntilReady(port, Date.now() + 120_000);

  // Foreground `tailscale serve` keeps the config only while it runs, so stopping it leaves no serve entry behind.
  // Target `localhost`: tailscale rewrites `http://[::1]:port` into the unusable `http://::1:port`.
  start('tailscale', ['serve', `http://localhost:${port}`]);

  console.log('\nWaiting for Tailscale HTTPS (the first run issues a certificate, about 30 seconds)...');
  if (!(await waitForServe(Date.now() + 90_000))) {
    console.error(`${url} is not answering yet.\n${remoteHelp()}`);
  }
  console.log(`\nMyGitNotes on your tailnet: ${url}\n`);
  console.log(await QRCode.toString(url, { type: 'utf8', margin: 2 }));
  console.log(remoteHelp());

  if (process.stdin.isTTY) {
    console.log('Press c to copy the URL, q or Ctrl+C to stop.\n');
    process.stdin.setRawMode(true);
    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', key => {
      if (key === 'c') copy(url);
      else if (key === 'q' || key === '\u0003') stop(0);
    });
  }
}

await main().catch(error => {
  console.error(`${error.message}\n${remoteHelp()}`);
  process.exit(1);
});
