import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { remoteHelp } from './lib/dev-remote-help.mjs';

const commands = vi.hoisted(() => ({ execFileSync: vi.fn(), spawn: vi.fn(), spawnSync: vi.fn() }));
vi.mock('node:child_process', () => commands);
vi.mock('node:net', () => ({
  default: {
    createServer: () => ({
      on() {},
      listen(_port, _host, callback) {
        queueMicrotask(callback);
      },
      address: () => ({ port: 43210 }),
      close(callback) {
        callback();
      },
    }),
  },
}));
vi.mock('qrcode', () => ({ default: { toString: async () => '[QR]' } }));

describe('dev:remote failure guidance', () => {
  let children;
  let log;
  let error;
  let exit;
  let handlers;
  let originalExitCode;
  const run = () => import('./dev-remote.mjs');
  const errors = () => error.mock.calls.map(args => args.join(' ')).join('\n');

  beforeEach(() => {
    vi.resetModules();
    vi.resetAllMocks();
    originalExitCode = process.exitCode;
    children = [];
    handlers = {};
    log = vi.spyOn(console, 'log').mockImplementation(() => {});
    error = vi.spyOn(console, 'error').mockImplementation(() => {});
    exit = vi.spyOn(process, 'exit').mockImplementation(code => {
      throw new Error(`exit:${code}`);
    });
    vi.spyOn(process, 'on').mockImplementation((event, handler) => {
      handlers[event] = handler;
      return process;
    });
    vi.spyOn(process, 'stdin', 'get').mockReturnValue({ isTTY: false });
    commands.spawnSync.mockReturnValue({ status: 0 });
    commands.execFileSync.mockReturnValue(JSON.stringify({ BackendState: 'Running', Self: { DNSName: 'server.example.ts.net.' } }));
    commands.spawn.mockImplementation(() => {
      const child = new EventEmitter();
      children.push(child);
      return child;
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({}));
    // Advance deadlines without sleeping or opening sockets.
    let now = 0;
    vi.spyOn(Date, 'now').mockImplementation(() => now += 60_000);
    vi.stubGlobal('setTimeout', callback => {
      callback();
      return 0;
    });
  });

  afterEach(() => {
    process.exitCode = originalExitCode;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('covers distinct tailnet, DNS, browser permission, activation and operator checks', () => {
    const help = remoteHelp();
    for (const text of ['same tailnet', 'WSL and Windows', 'Use Tailscale DNS settings', 'Secure DNS', 'Allow local access', 'does not fix NXDOMAIN', 'node not found', "server's tailnet", 'only if prompted or blocked', 'https://login.tailscale.com/admin/dns', 'HTTPS Certificates', 'sudo tailscale set --operator="$USER"', 'Do not run pnpm dev:remote with sudo', 'newly printed URL']) {
      expect(help).toContain(text);
    }
    expect(help).not.toContain('exit-node-allow-lan-access');
    expect(help).not.toContain('Turn off');
  });

  it('preserves workspace failure status and prints help before any network setup', async () => {
    commands.spawnSync.mockReturnValue({ status: 7 });
    await run();
    expect(process.exitCode).toBe(7);
    expect(errors()).toContain(remoteHelp());
    expect(commands.execFileSync).not.toHaveBeenCalled();
    expect(commands.spawn).not.toHaveBeenCalled();
  });

  it.each(['workspace spawn', 'tailscale status', 'disconnected'])('reports %s failure with help and exit 1', async scenario => {
    if (scenario === 'workspace spawn') commands.spawnSync.mockReturnValue({ error: new Error('workspace check failed') });
    if (scenario === 'tailscale status') {
      commands.execFileSync.mockImplementation(() => {
        throw new Error('missing');
      });
    }
    if (scenario === 'disconnected') commands.execFileSync.mockReturnValue('{}');
    await expect(run()).rejects.toThrow('exit:1');
    expect(exit).toHaveBeenCalledWith(1);
    expect(errors()).toContain(remoteHelp());
    expect(commands.spawn).not.toHaveBeenCalled();
  });

  it('prints help on local readiness timeout without starting Serve', async () => {
    fetch.mockRejectedValue(new Error('not ready'));
    await expect(run()).rejects.toThrow('exit:1');
    expect(errors()).toContain('web dev server did not become ready');
    expect(errors()).toContain(remoteHelp());
    expect(commands.spawn).toHaveBeenCalledTimes(1);
  });

  it('prints help on HTTPS timeout while preserving the foreground session', async () => {
    fetch.mockImplementation(url => url.startsWith('https:') ? Promise.reject(new Error('unreachable')) : Promise.resolve({}));
    await run();
    expect(errors()).toContain('https://server.example.ts.net/ is not answering yet.');
    expect(errors()).toContain(remoteHelp());
    expect(exit).not.toHaveBeenCalled();
    expect(commands.spawn.mock.calls.map(([command]) => command)).toEqual(['pnpm', 'tailscale']);
  });

  it.each([0, 7, null])('prints help when a child exits (%s), preserving nonzero status', async code => {
    await run();
    error.mockClear();
    expect(() => children[1].emit('exit', code, code === null ? 'SIGTERM' : null)).toThrow(`exit:${code || 1}`);
    expect(errors()).toContain(remoteHelp());
    expect(exit).toHaveBeenCalledWith(code || 1);
  });

  it('retains synchronous process-tree cleanup on failure', async () => {
    await run();
    Object.assign(children[0], { pid: 12345, exitCode: null, signalCode: null });
    commands.execFileSync.mockReturnValue('12346 12345\n12347 12346');
    const kill = vi.spyOn(process, 'kill').mockReturnValue(true);
    expect(() => children[1].emit('error', new Error('ENOENT'))).toThrow('exit:1');
    expect(kill.mock.calls).toEqual([[12345, 'SIGTERM'], [12346, 'SIGTERM'], [12347, 'SIGTERM']]);
    expect(handlers.exit).toBeTypeOf('function');
  });

  it('reports child spawn errors rather than leaving an unhandled error', async () => {
    await run();
    error.mockClear();
    expect(() => children[1].emit('error', new Error('ENOENT'))).toThrow('exit:1');
    expect(errors()).toContain('Could not start tailscale: ENOENT');
    expect(errors()).toContain(remoteHelp());
  });

  it('keeps help on success and does not print failure advice on Ctrl+C', async () => {
    Date.now.mockReturnValue(0);
    await run();
    expect(log.mock.calls.flat()).toContain(remoteHelp());
    expect(errors()).toBe('');
    expect(() => handlers.SIGINT()).toThrow('exit:0');
    expect(errors()).toBe('');
  });
});
