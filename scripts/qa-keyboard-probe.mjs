/**
 * Phase 0 keyboard probe: collector on 127.0.0.1 and OS-level key drivers
 * (docs/specs/2026-10-10-keyboard-navigation/design.md, "Phase 0"; the page is apps/web/keyboard-probe.html).
 *
 *   node scripts/qa-keyboard-probe.mjs export [--out <file>]
 *     Inlines the probe into one offline HTML file (guided manual mode for Windows and IME sessions).
 *   node scripts/qa-keyboard-probe.mjs run --platform mac --browser chrome-fresh|chrome-owner|safari --url <probe url>
 *     Drives a macOS browser with osascript System Events keystrokes. The terminal needs Accessibility and
 *     Screen Recording permission. --url is the Vite dev page, e.g. http://127.0.0.1:5199/keyboard-probe.html.
 *   node scripts/qa-keyboard-probe.mjs linux [--browsers chrome,firefox] [--keep-image] [--debian-mirror <host>]
 *     Builds a Docker image with Xvfb, xdotool, Chrome stable and Firefox and runs the same matrix in it.
 *   Common: --out <dir> (results), --trials <n> (10; Mod+K runs twice as many), --chords a,b, --contexts a,b.
 *   macOS --keep-awake: hold the display awake and declare user activity each trial, so the idle screen lock does not
 *   end an unattended run (the driver stops when the screen is locked, since keys would reach the login window).
 *
 * A trial passes when the page reports exactly one prevented keydown with no blur, hidden page, print, resize or
 * focus loss for 800 ms, and the driver sees the same frontmost app, the same windows, the same probe tab title and an
 * unchanged browser toolbar strip. Results are written as JSON and a Markdown summary.
 */
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');
const NO_KEY_TIMEOUT_MS = 1500;
const STRIP_DIFF_LIMIT = 0.004;
const IMAGE = 'mgn-keyboard-probe:p0';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const args = process.argv.slice(2);
const command = args[0];
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? fallback : args[index + 1];
};
const flag = name => args.includes(`--${name}`);

function run(binary, list, options = {}) {
  const result = spawnSync(binary, list, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, ...options });
  if (result.error) throw result.error;
  return result;
}

// ---------------------------------------------------------------------------------------------------------------------
// export: one self-contained HTML file

async function exportProbe(out) {
  const { build } = await import('esbuild');
  const entry = path.join(repoRoot, 'apps/web/src/dev/keyboard-probe.ts');
  const bundle = await build({ entryPoints: [entry], bundle: true, format: 'iife', target: 'es2020', minify: true, write: false, charset: 'utf8', legalComments: 'none' });
  const code = bundle.outputFiles[0].text.replaceAll('</script', '<\\/script');
  const html = fs.readFileSync(path.join(repoRoot, 'apps/web/keyboard-probe.html'), 'utf8');
  const tag = '<script type="module" src="/src/dev/keyboard-probe.ts"></script>';
  if (!html.includes(tag)) throw new Error('keyboard-probe.html no longer loads /src/dev/keyboard-probe.ts');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, html.replace(tag, () => `<script>${code}</script>`));
  console.log(`Wrote ${out} (${Math.round(fs.statSync(out).size / 1024)} KiB)`);
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// Collector: long poll for commands, sendBeacon for reports, optional static page.

function startCollector({ servePage }) {
  const commands = [];
  const reports = [];
  const pollers = new Set();
  const waiters = new Set();
  let seq = 0;
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'cache-control': 'no-store' };
  const flush = () => {
    for (const poller of pollers) {
      const next = commands.find(item => item.seq > poller.after && item.session === poller.session);
      if (!next) continue;
      pollers.delete(poller);
      clearTimeout(poller.timer);
      poller.response.writeHead(200, { ...cors, 'content-type': 'application/json' }).end(JSON.stringify(next));
    }
  };
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    if (request.method === 'OPTIONS') return response.writeHead(204, cors).end();
    if (url.pathname === '/keyboard-probe.html' && servePage) return response.writeHead(200, { ...cors, 'content-type': 'text/html; charset=utf-8' }).end(fs.readFileSync(servePage));
    if (url.pathname === '/next') {
      const poller = { session: url.searchParams.get('session'), after: Number(url.searchParams.get('after') ?? 0), response };
      poller.timer = setTimeout(() => {
        pollers.delete(poller);
        response.writeHead(204, cors).end();
      }, 15000);
      pollers.add(poller);
      request.on('close', () => {
        pollers.delete(poller);
        clearTimeout(poller.timer);
      });
      return flush();
    }
    if (url.pathname === '/report' && request.method === 'POST') {
      let body = '';
      request.on('data', chunk => (body += chunk));
      request.on('end', () => {
        response.writeHead(204, cors).end();
        try {
          const item = JSON.parse(body);
          item.receivedAt = Date.now();
          reports.push(item);
          for (const waiter of waiters) {
            if (waiter.match(item)) {
              waiters.delete(waiter);
              clearTimeout(waiter.timer);
              waiter.resolve(item);
            }
          }
        } catch (error) {
          console.error('bad report', error);
        }
      });
      return undefined;
    }
    response.writeHead(404, cors).end();
    return undefined;
  });
  return new Promise(resolve => {
    server.listen(Number(option('port', 0)), '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        url: `http://127.0.0.1:${port}`,
        port,
        reports,
        send(session, item) {
          seq += 1;
          const entry = { ...item, seq, session };
          commands.push(entry);
          flush();
          return entry;
        },
        wait(match, timeoutMs, since = 0) {
          const existing = reports.find(item => item.receivedAt >= since && match(item));
          if (existing) return Promise.resolve(existing);
          return new Promise(done => {
            const waiter = { match: item => item.receivedAt >= since && match(item), resolve: done };
            waiter.timer = setTimeout(() => {
              waiters.delete(waiter);
              done(null);
            }, timeoutMs);
            waiters.add(waiter);
          });
        },
        close() {
          for (const poller of pollers) poller.response.destroy();
          return new Promise(done => server.close(done));
        },
      });
    });
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// Image strip comparison (browser toolbar above the page)

const magick = run('sh', ['-c', 'command -v magick || true']).stdout.trim();
const imageTool = (tool, list) => magick ? run(magick, [tool, ...list]) : run(tool, list);

function stripDiff(before, after, pixels) {
  if (!before || !after || !fs.existsSync(before) || !fs.existsSync(after)) return null;
  const result = imageTool('compare', ['-metric', 'AE', '-fuzz', '12%', before, after, 'null:']);
  const changed = Number.parseFloat((result.stderr || result.stdout).trim().split(/\s/)[0]);
  if (!Number.isFinite(changed) || !pixels) return null;
  return { changed, ratio: changed / pixels };
}

/** Window bounds come from the window system: a window manager can move a window after the page read screenX. */
function stripRect(state, bounds) {
  const top = Math.max(bounds.h - state.geometry.innerHeight, 0);
  return { x: Math.round(bounds.x), y: Math.round(bounds.y), w: Math.round(bounds.w), h: Math.max(Math.round(top), 24) };
}

function clickPoint(state, bounds) {
  const left = bounds.x + Math.max(bounds.w - state.geometry.innerWidth, 0) / 2;
  const top = bounds.y + Math.max(bounds.h - state.geometry.innerHeight, 0);
  const target = state.geometry.target;
  const inset = state.context === 'codemirror' ? { x: Math.min(60, target.width / 2), y: Math.min(24, target.height / 2) } : { x: target.width / 2, y: target.height / 2 };
  return { x: Math.round(left + target.x + inset.x), y: Math.round(top + target.y + inset.y) };
}

// ---------------------------------------------------------------------------------------------------------------------
// macOS driver: osascript System Events for keys, a small Swift helper for windows, frontmost app and clicks.

const MAC_KEY_CODES = { KeyK: 40, KeyP: 35, KeyF: 3, KeyG: 5, KeyE: 14, KeyT: 17, KeyL: 37, KeyR: 15, KeyW: 13, KeyQ: 12, Slash: 44, Enter: 36, F1: 122, F6: 97, Escape: 53 };

function macHelper() {
  const source = path.join(here, 'lib/keyboard-probe-mac.swift');
  const hash = createHash('sha256').update(fs.readFileSync(source)).digest('hex').slice(0, 12);
  // Not os.tmpdir(): executables under /var/folders took about 1.5 s per launch on the owner's Mac (checked per exec).
  const binary = `/tmp/mgn-keyboard-probe-mac-${hash}`;
  if (!fs.existsSync(binary)) {
    const result = run('xcrun', ['swiftc', '-O', '-o', binary, source]);
    if (result.status !== 0) throw new Error(`swiftc failed: ${result.stderr}`);
  }
  // /tmp is shared: run only a plain file this user owns that nobody else can rewrite.
  const stat = fs.lstatSync(binary);
  if (!stat.isFile() || stat.uid !== process.getuid() || (stat.mode & 0o022) !== 0) {
    throw new Error(`${binary} is not a file owned by you and writable only by you; remove it and run again`);
  }
  return list => {
    const result = run(binary, list);
    if (result.status !== 0) throw new Error(`mac helper ${list.join(' ')}: ${result.stderr}`);
    return result.stdout.trim();
  };
}

function osascript(script) {
  const result = run('osascript', ['-e', script]);
  if (result.status !== 0) {
    const message = result.stderr.trim();
    if (/not allowed assistive access|1002|-25211|-1719/.test(message)) {
      throw new Error(`Accessibility permission is missing: System Settings → Privacy & Security → Accessibility → enable the terminal app running this script (${process.env.TERM_PROGRAM ?? 'your terminal'}). osascript said: ${message}`);
    }
    throw new Error(`osascript failed: ${message}`);
  }
  return result.stdout.trim();
}

function parseWindows(text) {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`mac helper printed no window list: ${text.slice(0, 200)} (${error.message})`);
  }
}

// AeroSpace (a tiling window manager) moves new Chrome windows to another workspace and parks them off screen there.
const aerospace = process.platform === 'darwin' && run('sh', ['-c', 'command -v aerospace && pgrep -x AeroSpace >/dev/null && echo running || true']).stdout.includes('running');
const aerospaceRun = list => run('aerospace', list);

function macDriver() {
  const helper = macHelper();
  const self = {
    platform: 'mac',
    pid: 0,
    probeWindowId: 0,
    workspace: aerospace ? aerospaceRun(['list-workspaces', '--focused']).stdout.trim() : null,
    front: () => Number(helper(['front'])),
    locked: () => helper(['locked']) === '1',
    bounds: () => self.windows().find(window => window.id === self.probeWindowId) ?? null,
    /** Brings only the probe window to the visible workspace as a floating window and gives it a fixed frame. */
    async adopt() {
      if (aerospace) {
        const id = String(self.probeWindowId);
        const workspaceOf = () => aerospaceRun(['list-windows', '--all', '--format', '%{window-id}|%{workspace}']).stdout.split('\n').find(line => line.startsWith(`${id}|`))?.split('|')[1];
        // Wait for the window rules to place the window first; moving it earlier races with them.
        await waitFor(workspaceOf, 10000, 'AeroSpace to see the probe window');
        await sleep(1500);
        for (let attempt = 0; attempt < 3 && workspaceOf() !== self.workspace; attempt++) {
          aerospaceRun(['move-node-to-workspace', '--window-id', id, self.workspace]);
          await sleep(800);
        }
        if (workspaceOf() !== self.workspace) throw new Abort(`AeroSpace keeps the probe window on workspace ${workspaceOf()}`);
        aerospaceRun(['layout', '--window-id', id, 'floating']);
        aerospaceRun(['focus', '--window-id', id]);
        await sleep(500);
      }
      const window = `(first window of (first process whose unix id is ${self.pid}) whose name contains "${self.marker}")`;
      osascript(`tell application "System Events"
  set position of ${window} to {60, 60}
  set size of ${window} to {1320, 960}
end tell`);
    },
    windows: () => parseWindows(helper(['windows', String(self.pid)])).filter(window => window.layer === 0 && window.h > 40),
    frontWindow: () => self.windows()[0] ?? null,
    key({ code, mod = false, shift = false }) {
      const using = [mod && 'command down', shift && 'shift down'].filter(Boolean);
      return osascript(`tell application "System Events"
  set frontPid to unix id of first process whose frontmost is true
  if frontPid is not ${self.pid} then return "not-front:" & frontPid
  key code ${MAC_KEY_CODES[code]}${using.length ? ` using {${using.join(', ')}}` : ''}
  return "ok"
end tell`);
    },
    click: point => helper(['click', String(point.x), String(point.y)]),
    closeProbeWindow(marker) {
      osascript(`tell application "System Events"
  click (first button of (first window of (first process whose unix id is ${self.pid}) whose name contains "${marker}") whose subrole is "AXCloseButton")
end tell`);
    },
    activate(marker) {
      if (aerospace && self.probeWindowId) aerospaceRun(['focus', '--window-id', String(self.probeWindowId)]);
      // Inline references only: a process stored in a variable resolves by name, which picks the owner's Chrome when
      // a second Chrome runs with its own profile.
      osascript(`tell application "System Events"
  set frontmost of (first process whose unix id is ${self.pid}) to true
  try
    perform action "AXRaise" of (first window of (first process whose unix id is ${self.pid}) whose name contains "${marker}")
  end try
end tell`);
    },
    screenshot(rect, file) {
      run('screencapture', ['-x', `-R${rect.x},${rect.y},${rect.w},${rect.h}`, file]);
      return fs.existsSync(file) ? file : null;
    },
  };
  return self;
}

// ---------------------------------------------------------------------------------------------------------------------
// Linux driver: xdotool (XTEST) keys and clicks, wmctrl windows, ImageMagick import for the strip.

const X_KEYS = { KeyK: 'k', KeyP: 'p', KeyF: 'f', KeyG: 'g', KeyE: 'e', KeyT: 't', KeyL: 'l', KeyR: 'r', KeyW: 'w', Slash: 'slash', Enter: 'Return', F1: 'F1', F6: 'F6', Escape: 'Escape' };

function linuxDriver() {
  const x = list => run('xdotool', list).stdout.trim();
  const self = {
    platform: 'linux',
    pid: 0,
    probeWindowId: 0,
    front: () => {
      const id = x(['getactivewindow']);
      return id ? Number(x(['getwindowpid', id])) : -1;
    },
    windows: () => run('wmctrl', ['-lp']).stdout.split('\n').filter(Boolean).map(line => {
      const [id, , pid, , ...title] = line.split(/\s+/);
      return { id: Number.parseInt(id, 16), pid: Number(pid), title: title.join(' ') };
    }).filter(window => window.pid === self.pid),
    frontWindow() {
      const id = Number(x(['getactivewindow']) || 0);
      return self.windows().find(window => window.id === id) ?? (id ? { id, title: x(['getwindowname', String(id)]) } : null);
    },
    key({ code, mod = false, shift = false }) {
      const front = self.front();
      if (front !== self.pid) return `not-front:${front}`;
      x(['key', '--clearmodifiers', [mod && 'ctrl', shift && 'shift', X_KEYS[code]].filter(Boolean).join('+')]);
      return 'ok';
    },
    click: point => x(['mousemove', '--sync', String(point.x), String(point.y), 'click', '1']),
    activate() {
      if (self.probeWindowId) x(['windowactivate', '--sync', String(self.probeWindowId)]);
    },
    adopt() {
      x(['windowsize', '--sync', String(self.probeWindowId), '1400', '960']);
      x(['windowmove', '--sync', String(self.probeWindowId), '0', '0']);
      self.activate();
    },
    bounds() {
      if (!self.probeWindowId) return null;
      const values = Object.fromEntries(x(['getwindowgeometry', '--shell', String(self.probeWindowId)]).split('\n').map(line => line.split('=')));
      return { x: Number(values.X), y: Number(values.Y), w: Number(values.WIDTH), h: Number(values.HEIGHT) };
    },
    closeWindow: id => run('wmctrl', ['-ic', `0x${id.toString(16)}`]),
    closeProbeWindow: () => self.probeWindowId && self.closeWindow(self.probeWindowId),
    screenshot(rect, file) {
      imageTool('import', ['-window', 'root', '-crop', `${rect.w}x${rect.h}+${rect.x}+${rect.y}`, '+repage', file]);
      return fs.existsSync(file) ? file : null;
    },
  };
  return self;
}

// ---------------------------------------------------------------------------------------------------------------------
// Browsers

function psList() {
  return run('ps', ['-axo', 'pid=,command=']).stdout.split('\n').map(line => line.trim()).filter(Boolean).map(line => {
    const [pid, ...rest] = line.split(/\s+/);
    return { pid: Number(pid), command: rest.join(' ') };
  });
}

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitFor(check, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await check();
    if (value) return value;
    await sleep(200);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

const CHROME_MAC = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

async function launchBrowser(driver, browser, url, work) {
  if (driver.platform === 'mac' && browser === 'chrome-fresh') {
    const profile = path.join(work, 'chrome-fresh-profile');
    fs.mkdirSync(profile, { recursive: true });
    run('open', ['-na', 'Google Chrome', '--args', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--use-mock-keychain', '--window-position=40,40', '--window-size=1320,960', url]);
    const pid = await waitFor(() => psList().find(item => item.command.startsWith(CHROME_MAC) && item.command.includes(`--user-data-dir=${profile}`) && !item.command.includes('--type='))?.pid, 20000, 'fresh Chrome');
    return { pid, launched: true, profile, version: macVersion('/Applications/Google Chrome.app') };
  }
  if (driver.platform === 'mac' && browser === 'chrome-owner') {
    const owner = psList().find(item => item.command === CHROME_MAC || (item.command.startsWith(`${CHROME_MAC} `) && !item.command.includes('--type=') && !item.command.includes('--user-data-dir=')));
    if (!owner) throw new Error("The owner's Chrome is not running; the owner-profile trial only adds a window to a running Chrome.");
    run(CHROME_MAC, ['--new-window', url]);
    return { pid: owner.pid, launched: false, version: macVersion('/Applications/Google Chrome.app') };
  }
  if (driver.platform === 'mac' && browser === 'safari') {
    // macOS 26 and later run Safari from a Cryptex (/System/Volumes/Preboot/Cryptexes/App/System/Applications/Safari.app).
    const safari = () => psList().find(item => item.command.endsWith('/Safari.app/Contents/MacOS/Safari'));
    const running = safari();
    run('open', ['-a', 'Safari', url]);
    const pid = await waitFor(() => safari()?.pid, 20000, 'Safari');
    return { pid, launched: !running, version: macVersion('/Applications/Safari.app') };
  }
  if (driver.platform === 'linux' && browser === 'chrome') {
    const profile = path.join(work, 'chrome-profile');
    fs.mkdirSync(profile, { recursive: true });
    const child = spawn('google-chrome', [`--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--no-sandbox', '--disable-dev-shm-usage', '--password-store=basic', '--window-position=0,0', '--window-size=1400,960', url], { detached: true, stdio: 'ignore' });
    child.unref();
    return { pid: child.pid, launched: true, profile, child, version: run('google-chrome', ['--version']).stdout.trim() };
  }
  if (driver.platform === 'linux' && browser === 'firefox') {
    const profile = path.join(work, 'firefox-profile');
    fs.mkdirSync(profile, { recursive: true });
    // Only first-run screens are suppressed; key handling and shortcuts keep their defaults.
    fs.writeFileSync(path.join(profile, 'user.js'), ['user_pref("browser.shell.checkDefaultBrowser", false);', 'user_pref("browser.aboutwelcome.enabled", false);', 'user_pref("browser.startup.homepage_override.mstone", "ignore");', 'user_pref("startup.homepage_welcome_url", "");', 'user_pref("startup.homepage_welcome_url.additional", "");', 'user_pref("datareporting.policy.dataSubmissionPolicyBypassNotification", true);', 'user_pref("toolkit.telemetry.reportingpolicy.firstRun", false);', 'user_pref("trailhead.firstrun.didSeeAboutWelcome", true);', 'user_pref("browser.tabs.warnOnClose", false);', 'user_pref("browser.warnOnQuit", false);', ''].join('\n'));
    const child = spawn('firefox', ['--no-remote', '--profile', profile, '--width', '1400', '--height', '960', url], { detached: true, stdio: 'ignore' });
    child.unref();
    return { pid: child.pid, launched: true, profile, child, version: run('firefox', ['--version']).stdout.trim() };
  }
  throw new Error(`Unknown browser ${browser} on ${driver.platform}`);
}

function macVersion(app) {
  return run('defaults', ['read', `${app}/Contents/Info`, 'CFBundleShortVersionString']).stdout.trim();
}

// ---------------------------------------------------------------------------------------------------------------------
// Matrix

class Abort extends Error {}

async function runMatrix() {
  const platform = option('platform', process.platform === 'darwin' ? 'mac' : 'linux');
  const browser = option('browser');
  const trials = Number(option('trials', 10));
  const out = path.resolve(option('out', path.join(repoRoot, 'artifacts/keyboard-probe')));
  const servePage = option('serve');
  const session = `${browser}-${Date.now().toString(36)}`;
  const marker = `MGN Keyboard Probe ${session}`;
  const work = fs.mkdtempSync(path.join(os.tmpdir(), `mgn-kbprobe-${browser}-`));
  fs.mkdirSync(out, { recursive: true });
  const collector = await startCollector({ servePage });
  const base = servePage ? `${collector.url}/keyboard-probe.html` : option('url');
  if (!base) throw new Error('--url (the probe page) or --serve (an exported probe file) is required');
  const pageUrl = `${base}?collector=${encodeURIComponent(collector.url)}&session=${encodeURIComponent(session)}`;
  const driver = platform === 'mac' ? macDriver() : linuxDriver();
  const resultFile = path.join(out, `${platform}-${browser}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  const startedAt = new Date().toISOString();
  const results = [];
  let instance = null;
  let ready = null;
  let baselineGeometry = null;
  console.log(`[probe] ${platform}/${browser} collector ${collector.url} session ${session}`);

  const write = extra => fs.writeFileSync(resultFile, JSON.stringify({ platform, browser, version: instance?.version, userAgent: ready?.userAgent, startedAt, updatedAt: new Date().toISOString(), trialsPerCell: trials, stripDiffLimit: STRIP_DIFF_LIMIT, ...extra, results }, null, 1));

  const findProbeWindow = () => driver.windows().find(window => window.title.includes(marker));
  const launch = async () => {
    const since = Date.now();
    const launchedAt = since;
    instance = await launchBrowser(driver, browser, pageUrl, work);
    driver.pid = instance.pid;
    ready = await collector.wait(item => item.type === 'ready' && item.session === session, 30000, since);
    if (!ready) throw new Error(`The probe page did not report ready in ${browser}`);
    const window = await waitFor(findProbeWindow, 15000, 'the probe window').catch(error => {
      throw new Error(`${error.message}; pid ${driver.pid} has ${JSON.stringify(driver.windows())}`);
    });
    driver.probeWindowId = window.id;
    driver.marker = marker;
    await driver.adopt();
    await sleep(800);
    console.log(`[probe] window ${JSON.stringify(driver.bounds())} page geometry ${JSON.stringify(ready.state.geometry)}`);
    await sleep(1500);
    driver.activate(marker);
    await sleep(500);
    await settle(launchedAt);
  };

  const ensureFront = async () => {
    if (driver.locked?.()) throw new Abort('The screen is locked; keys would reach the login window. Unlock the Mac and run again.');
    for (let attempt = 0; attempt < 3; attempt++) {
      const frontWindow = driver.frontWindow();
      const front = driver.front();
      if (front === driver.pid && frontWindow?.id === driver.probeWindowId) return;
      console.log(`[probe] not front yet: pid ${front}, window ${JSON.stringify(frontWindow)}`);
      driver.activate(marker);
      await sleep(400);
    }
    throw new Abort(`The probe window is not frontmost (front pid ${driver.front()}, browser pid ${driver.pid}, probe window ${driver.probeWindowId}, windows ${JSON.stringify(driver.windows())}); stopping so no key goes to another app.`);
  };

  const reload = async () => {
    const since = Date.now();
    collector.send(session, { type: 'reload' });
    let item = await collector.wait(entry => entry.type === 'ready' && entry.session === session, 8000, since);
    if (!item) {
      await ensureFront();
      const front = driver.frontWindow();
      if (front?.id === driver.probeWindowId) driver.key({ code: 'KeyR', mod: true });
      item = await collector.wait(entry => entry.type === 'ready' && entry.session === session, 8000, since);
    }
    if (!item) throw new Abort('The probe page did not come back after a reload.');
    ready = item;
    await sleep(250);
    return item;
  };

  const arm = async spec => {
    const since = Date.now();
    // The page waits for the keydown until the driver's deadline; the safety timeout only covers a lost driver.
    const sent = collector.send(session, { type: 'arm', spec, noKeyTimeoutMs: 20000 });
    const armed = await collector.wait(item => item.type === 'armed' && item.seq === sent.seq, 5000, since);
    return armed ? { ...armed, since } : null;
  };

  const observe = (state, tag) => {
    const windows = driver.windows();
    const probe = windows.find(window => window.id === driver.probeWindowId) ?? null;
    // The macOS window list carries bounds; wmctrl's does not, so Linux asks xdotool.
    const bounds = driver.platform === 'mac' ? probe : driver.bounds();
    const rect = bounds ? stripRect(state, bounds) : null;
    const shot = rect ? driver.screenshot(rect, path.join(work, `${tag}.png`)) : null;
    const pixels = rect ? rect.w * rect.h * (driver.platform === 'mac' ? state.geometry.devicePixelRatio ** 2 : 1) : 0;
    return { front: driver.front(), windows, probeTitle: probe?.title ?? null, shot, pixels };
  };

  /**
   * A fresh Chrome profile shows a "Sign In to Chrome?" pill that collapses about 30 s after start, which the strip
   * comparison would blame on a chord; wait at least 45 s after launch and until the toolbar holds still for 4 s.
   */
  const settle = async launchedAt => {
    for (let attempt = 0; attempt < 30; attempt++) {
      const first = observe(ready.state, 'settle-a');
      await sleep(4000);
      const second = observe(ready.state, 'settle-b');
      const diff = stripDiff(first.shot, second.shot, second.pixels);
      if (diff && diff.ratio <= STRIP_DIFF_LIMIT / 4 && (!instance.profile || Date.now() - launchedAt >= 45000)) return;
    }
    console.log('[probe] the toolbar never held still; toolbar diffs need a manual look');
  };

  const recover = async baseline => {
    const ids = new Set(baseline.windows.map(window => window.id));
    for (let attempt = 0; attempt < 6; attempt++) {
      if (driver.front() === driver.pid) driver.key({ code: 'Escape' });
      await sleep(200);
      const windows = driver.windows();
      const extra = windows.filter(window => !ids.has(window.id));
      const probe = windows.find(window => window.id === driver.probeWindowId);
      if (!probe) throw new Abort('The probe window disappeared.');
      if (!extra.length && probe.title.includes(marker)) return;
      if (extra.length && driver.closeWindow) {
        for (const window of extra) driver.closeWindow(window.id);
      } else {
        const front = driver.frontWindow();
        // Close only a window this trial opened, or a tab the chord opened inside the probe window.
        if (front && (!ids.has(front.id) || (front.id === driver.probeWindowId && !front.title.includes(marker)))) driver.key({ code: 'KeyW', mod: true });
        else driver.activate(marker);
      }
      await sleep(600);
    }
    throw new Abort('Could not restore the browser after a failed trial.');
  };

  const restart = async () => {
    if (!instance?.launched || browser === 'safari') return false;
    await closeBrowser(driver, instance, marker);
    await launch();
    await reload();
    baselineGeometry = ready.state.geometry;
    return true;
  };

  const keepAwake = platform === 'mac' && flag('keep-awake');
  if (keepAwake) spawn('caffeinate', ['-d', '-i', '-w', String(process.pid)], { stdio: 'ignore' }).unref();

  const runTrial = async (spec, chord, needReload) => {
    if (keepAwake) spawn('caffeinate', ['-u', '-t', '2'], { stdio: 'ignore' }).unref();
    if (needReload) await reload();
    await ensureFront();
    baselineGeometry ??= ready.state.geometry;
    if ((ready.state.geometry.innerHeight !== baselineGeometry.innerHeight || ready.state.geometry.innerWidth !== baselineGeometry.innerWidth)) {
      console.log(`[probe] page size drifted (${ready.state.geometry.innerWidth}x${ready.state.geometry.innerHeight}); restarting the browser`);
      if (await restart()) await ensureFront();
    }
    let armed = null;
    let before = null;
    let sent = 'not-sent';
    // Another app can take the front between arming and typing (focus returns to the terminal when a browser exits);
    // re-arm then, and stop the run if it keeps happening so no key reaches another app.
    for (let round = 0; round < 3 && sent !== 'ok'; round++) {
      if (round) await ensureFront();
      if (spec.variant === 'address-bar') {
        driver.key({ code: 'KeyL', mod: true });
        await sleep(400);
      }
      armed = await arm(spec);
      for (let attempt = 0; attempt < 3 && armed && !(armed.state.hasFocus && armed.state.contextFocused); attempt++) {
        // Safari's address field opens its suggestions in a separate window that keeps focus through a click on the
        // page; Escape closes it first, as a person would.
        const frontWindow = driver.frontWindow();
        if (driver.front() === driver.pid && frontWindow && frontWindow.id !== driver.probeWindowId) {
          driver.key({ code: 'Escape' });
          await sleep(300);
        }
        const bounds = driver.bounds();
        if (bounds) driver.click(clickPoint(armed.state, bounds));
        await sleep(300);
        armed = await arm(spec);
      }
      if (!armed || !armed.state.hasFocus || !armed.state.contextFocused) return { spec, pass: false, setupFailed: true, pageReasons: null, driverReasons: ['setup-focus'], state: armed?.state ?? null };
      before = observe(armed.state, 'before');
      sent = driver.key({ code: chord.code, mod: chord.mod, shift: chord.shift });
      if (sent !== 'ok') console.log(`[probe] ${spec.id}: ${sent}; re-arming`);
    }
    if (sent !== 'ok') throw new Abort(`Refused to type: ${sent}`);
    const isResult = item => item.type === 'result' && item.seq === armed.seq;
    let report = await collector.wait(isResult, NO_KEY_TIMEOUT_MS, armed.since);
    if (!report) {
      collector.send(session, { type: 'deadline', trialId: spec.id });
      report = await collector.wait(isResult, 4000, armed.since);
    }
    await sleep(150);
    const after = observe(armed.state, 'after');
    const diff = stripDiff(before.shot, after.shot, before.pixels);
    const driverReasons = [];
    if (!report) driverReasons.push('no-report');
    // Another app taking the front during a trial is interference, not the chord: name it so the cell can be re-run.
    const frontApp = after.front === driver.pid ? null : psList().find(item => item.pid === after.front)?.command ?? String(after.front);
    if (frontApp) driverReasons.push('front-app-changed');
    const beforeIds = new Set(before.windows.map(window => window.id));
    if (after.windows.some(window => !beforeIds.has(window.id))) driverReasons.push('window-opened');
    if (after.windows.length < before.windows.length) driverReasons.push('window-closed');
    if (after.probeTitle !== before.probeTitle) driverReasons.push('tab-changed');
    if (diff && diff.ratio > STRIP_DIFF_LIMIT) driverReasons.push('toolbar-changed');
    const page = report?.result ?? null;
    const pass = Boolean(page?.pagePass) && driverReasons.length === 0;
    if (!pass) {
      const failed = path.join(out, 'failed-strips', `${platform}-${browser}`);
      fs.mkdirSync(failed, { recursive: true });
      const name = spec.id.replace(/[^\w.-]+/g, '_');
      if (before.shot) fs.copyFileSync(before.shot, path.join(failed, `${name}-before.png`));
      if (after.shot) fs.copyFileSync(after.shot, path.join(failed, `${name}-after.png`));
      await recover(before);
    }
    if (page) page.events = page.events.slice(0, 40);
    return { spec, pass, pageReasons: page?.reasons ?? null, driverReasons, frontApp, diff, page, windowsBefore: before.windows.length, windowsAfter: after.windows.length };
  };

  const chordFilter = option('chords')?.split(',');
  const contextFilter = option('contexts')?.split(',');
  try {
    await launch();
    const plan = [];
    for (const chord of ready.chords.filter(item => !chordFilter || chordFilter.includes(item.id))) {
      for (const context of chord.contexts.filter(item => !contextFilter || contextFilter.includes(item))) {
        const count = chord.id === 'mod+k' ? trials * 2 : trials;
        for (let index = 0; index < count; index++) plan.push({ chord, spec: { id: `${chord.id}@${context}#${index + 1}`, chord: chord.id, context, variant: index === 0 ? 'fresh' : index === 1 ? 'address-bar' : 'normal' } });
      }
    }
    let needReload = true;
    for (const [index, { chord, spec }] of plan.entries()) {
      const trial = await runTrial(spec, chord, needReload || spec.variant === 'fresh');
      results.push(trial);
      needReload = !trial.pass;
      const reasons = [...(trial.pageReasons ?? []), ...trial.driverReasons].join(',');
      console.log(`[${index + 1}/${plan.length}] ${spec.id} ${spec.variant} ${trial.pass ? 'PASS' : `FAIL ${reasons}`}${trial.diff ? ` strip=${trial.diff.ratio.toFixed(4)}` : ''}`);
      if (index % 20 === 0) write({ complete: false });
    }
    write({ complete: true });
  } catch (error) {
    write({ complete: false, aborted: String(error.message ?? error) });
    console.error(`[probe] aborted: ${error.message ?? error}`);
    process.exitCode = 1;
  } finally {
    if (instance) await closeBrowser(driver, instance, marker).catch(error => console.error(`[probe] close failed: ${error.message}`));
    if (aerospace && driver.workspace && aerospaceRun(['list-workspaces', '--focused']).stdout.trim() !== driver.workspace) aerospaceRun(['workspace', driver.workspace]);
    await collector.close();
    fs.rmSync(work, { recursive: true, force: true });
  }
  const summary = summarize(results, { platform, browser, version: instance?.version, userAgent: ready?.userAgent, trials });
  fs.writeFileSync(resultFile.replace(/\.json$/, '.md'), summary);
  console.log(summary);
  console.log(`[probe] results ${resultFile}`);
}

async function closeBrowser(driver, instance, marker) {
  // A browser this run started with its own profile is stopped by pid; Safari keeps the owner's profile.
  if (instance.launched && instance.profile) {
    try {
      process.kill(instance.pid, 'SIGTERM');
    } catch { /* already gone */ }
    await waitFor(() => !alive(instance.pid), 15000, 'the browser to exit').catch(() => {
      process.kill(instance.pid, 'SIGKILL');
    });
    return;
  }
  // The owner's Chrome, or Safari with the owner's profile: close only the probe window, with its own close button, so
  // no key reaches a bubble or another window that happens to be in front.
  for (let attempt = 0; attempt < 4 && driver.windows().some(window => window.title.includes(marker)); attempt++) {
    driver.closeProbeWindow(marker);
    await sleep(800);
  }
  if (driver.windows().some(window => window.title.includes(marker))) throw new Error('The probe window is still open.');
  if (instance.launched) {
    // Safari started by this run keeps running without windows; stop that instance.
    try {
      process.kill(instance.pid, 'SIGTERM');
    } catch { /* already gone */ }
    await waitFor(() => !alive(instance.pid), 15000, 'Safari to quit');
  }
}

function summarize(results, { platform, browser, version, userAgent, trials }) {
  const cells = new Map();
  for (const trial of results) {
    const key = `${trial.spec.chord}|${trial.spec.context}`;
    const cell = cells.get(key) ?? { pass: 0, total: 0, reasons: new Map() };
    cell.total += 1;
    if (trial.pass) cell.pass += 1;
    for (const reason of [...(trial.pageReasons ?? []), ...trial.driverReasons]) cell.reasons.set(reason, (cell.reasons.get(reason) ?? 0) + 1);
    cells.set(key, cell);
  }
  const contexts = ['body', 'input', 'textarea', 'contenteditable', 'codemirror'];
  const chords = [...new Set(results.map(trial => trial.spec.chord))];
  const lines = [`# ${platform} / ${browser}${version ? ` ${version}` : ''}`, '', `User agent: ${userAgent ?? 'unknown'}`, `Trials per cell: ${trials} (Mod+K ${trials * 2}).`, '', `| chord | ${contexts.join(' | ')} |`, `| --- | ${contexts.map(() => '---').join(' | ')} |`];
  for (const chord of chords) {
    const row = contexts.map(context => {
      const cell = cells.get(`${chord}|${context}`);
      if (!cell) return '–';
      const verdict = cell.pass === cell.total ? 'PASS' : cell.pass === 0 ? 'FAIL' : 'FLAKY';
      const reasons = [...cell.reasons.entries()].map(([reason, count]) => `${reason}×${count}`).join(' ');
      return `${verdict} ${cell.pass}/${cell.total}${reasons ? ` (${reasons})` : ''}`;
    });
    lines.push(`| ${chord} | ${row.join(' | ')} |`);
  }
  return `${lines.join('\n')}\n`;
}

// ---------------------------------------------------------------------------------------------------------------------
// Linux: host side builds and runs the container; inside it starts Xvfb and openbox and runs each browser.

async function linuxHost() {
  const out = path.resolve(option('out', path.join(repoRoot, 'artifacts/keyboard-probe')));
  fs.mkdirSync(out, { recursive: true });
  const page = await exportProbe(path.join(out, 'keyboard-probe.html'));
  if (run('docker', ['image', 'inspect', IMAGE]).status !== 0) {
    const mirror = option('debian-mirror') ? ['--build-arg', `DEBIAN_MIRROR=${option('debian-mirror')}`] : [];
    const built = spawnSync('docker', ['build', ...mirror, '-t', IMAGE, '-f', path.join(here, 'lib/keyboard-probe-linux.Dockerfile'), path.join(here, 'lib')], { stdio: 'inherit' });
    if (built.status !== 0) throw new Error('docker build failed');
  }
  const inner = ['node', '/probe/scripts/qa-keyboard-probe.mjs', 'linux-inner', '--serve', `/out/${path.basename(page)}`, '--out', '/out', '--browsers', option('browsers', 'chrome,firefox'), '--trials', option('trials', '10')];
  for (const name of ['chords', 'contexts']) if (option(name)) inner.push(`--${name}`, option(name));
  const name = `mgn-keyboard-probe-${Date.now().toString(36)}`;
  const result = spawnSync('docker', ['run', '--rm', '--name', name, '--shm-size=1g', '-v', `${here}:/probe/scripts:ro`, '-v', `${out}:/out`, IMAGE, ...inner], { stdio: 'inherit' });
  if (!flag('keep-image')) run('docker', ['image', 'rm', IMAGE]);
  process.exitCode = result.status ?? 1;
}

async function linuxInner() {
  const display = ':99';
  process.env.DISPLAY = display;
  const xvfb = spawn('Xvfb', [display, '-screen', '0', '1440x1000x24', '-nolisten', 'tcp'], { stdio: 'ignore' });
  await waitFor(() => fs.existsSync('/tmp/.X11-unix/X99'), 10000, 'Xvfb');
  const wm = spawn('openbox', [], { stdio: 'ignore', env: process.env });
  await sleep(1000);
  const browsers = option('browsers', 'chrome,firefox').split(',');
  const passthrough = ['--serve', option('serve'), '--out', option('out', '/out'), '--trials', option('trials', '10'), '--platform', 'linux'];
  for (const name of ['chords', 'contexts']) if (option(name)) passthrough.push(`--${name}`, option(name));
  let status = 0;
  for (const browser of browsers) {
    const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), 'run', '--browser', browser, ...passthrough], { stdio: 'inherit', env: process.env });
    status ||= child.status ?? 1;
  }
  wm.kill('SIGTERM');
  xvfb.kill('SIGTERM');
  process.exitCode = status;
}

// ---------------------------------------------------------------------------------------------------------------------

if (command === 'export') await exportProbe(path.resolve(option('out', path.join(repoRoot, 'artifacts/keyboard-probe/keyboard-probe.html'))));
else if (command === 'run') await runMatrix();
else if (command === 'linux') await linuxHost();
else if (command === 'linux-inner') await linuxInner();
else {
  console.error('usage: qa-keyboard-probe.mjs export|run|linux [options]; see the header comment');
  process.exitCode = 2;
}
