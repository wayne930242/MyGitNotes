import type { WorkspaceConfigSource } from '@mygitnotes/core';
import { afterEach, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => ({ authToken: vi.fn() }));
vi.mock('../src/auth.js', async original => ({ ...await original<typeof import('../src/auth.js')>(), authToken: mock.authToken }));
import { CredentialRejected } from '../src/auth.js';
import { requestWorkspace } from '../src/request-workspace.js';

const configSource: WorkspaceConfigSource = { mode: 'remote', settings: async () => ({ home: { id: 'home', source: { type: 'github', owner: 'owner', repo: 'notes', branch: 'main' } } as any, localPath: () => undefined, manifest: store => store() }) };
async function respond() {
  const res: any = { locals: {}, headersSent: false };
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  const next = vi.fn();
  await requestWorkspace({} as any, configSource)({} as any, res, next);
  return { status: res.status.mock.calls[0]?.[0], body: res.json.mock.calls[0]?.[0], next };
}
afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

it('asks the reader to sign in again only when the credential is rejected', async () => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  mock.authToken.mockRejectedValue(new CredentialRejected('expired', 'Authorization expired.'));
  const { status, body, next } = await respond();
  expect(status).toBe(401);
  expect(body).toEqual({ error: 'Session unavailable. Sign in again.' });
  expect(next).not.toHaveBeenCalled();
});

it('reports an unreachable session store as temporarily unavailable instead of a lost session', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  mock.authToken.mockRejectedValue(new DOMException('The operation was aborted due to timeout', 'TimeoutError'));
  const { status, body, next } = await respond();
  expect(status).toBe(503);
  expect(body).toEqual({ error: 'Session service temporarily unavailable. Retry shortly.' });
  expect(next).not.toHaveBeenCalled();
  expect(warn).toHaveBeenCalledWith('[auth] session service unavailable: The operation was aborted due to timeout');
});
