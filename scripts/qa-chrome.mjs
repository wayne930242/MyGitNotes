import os from 'node:os';
import path from 'node:path';

const LINUX_PUPPETEER_CHROME = path.join(os.homedir(), '.cache/puppeteer/chrome/linux-131.0.6778.204/chrome-linux64/chrome');
const MACOS_SYSTEM_CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

/** Resolves the Chrome binary a qa-*.mjs script should launch: an explicit env override,
 *  else the system Chrome on macOS, else the puppeteer-managed Chrome cache used on Linux CI. */
export function resolveQaChromePath(envVar = 'PUPPETEER_EXECUTABLE_PATH') {
  return process.env[envVar] || (process.platform === 'darwin' ? MACOS_SYSTEM_CHROME : LINUX_PUPPETEER_CHROME);
}
