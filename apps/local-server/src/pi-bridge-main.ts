// The Pi bridge as a process, for a hosted sandbox: an edition bundles this file with the two extension files beside it
// and starts it with its settings in the environment. See startPiBridge.
import { startPiBridge } from './pi-bridge.js';

const required = (name: string) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Set ${name}.`);
  return value;
};
const list = (name: string): string[] => {
  const value = process.env[name]?.trim();
  if (!value) return [];
  const parsed: unknown = JSON.parse(value);
  if (!Array.isArray(parsed) || parsed.some(entry => typeof entry !== 'string')) throw new Error(`${name} must be a JSON array of strings.`);
  return parsed as string[];
};

const activityUrl = process.env.MYGITNOTES_BRIDGE_ACTIVITY_URL?.trim();
const bridge = await startPiBridge({
  port: Number(process.env.MYGITNOTES_BRIDGE_PORT ?? 8080),
  token: required('MYGITNOTES_BRIDGE_TOKEN'),
  publicUrl: required('MYGITNOTES_BRIDGE_PUBLIC_URL'),
  allowedOrigins: list('MYGITNOTES_BRIDGE_ORIGINS'),
  cwd: required('MYGITNOTES_BRIDGE_CWD'),
  piArgs: list('MYGITNOTES_BRIDGE_PI_ARGS'),
  // A failed report only costs an earlier stop; the next activity reports again.
  activity: activityUrl ? () => void fetch(activityUrl, { method: 'POST' }).catch(() => {}) : undefined,
});
console.log(`Pi bridge listening at ${bridge.url}`);
const stop = () => void bridge.close().then(() => process.exit(0));
process.once('SIGTERM', stop);
process.once('SIGINT', stop);
