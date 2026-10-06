import { describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';
import { cookieWorkspaceChoices } from '../src/repository-choice.js';
import { workspaceChoicesContract } from '../src/workspace-choices-contract.js';

workspaceChoicesContract('cookie', () => ({ choices: cookieWorkspaceChoices(), visitor: async () => ({}) }));

describe('cookie workspace choices', () => {
  it('forgets the choice when the visitor signs out', async () => {
    const res = { clearCookie: vi.fn() };
    await cookieWorkspaceChoices().signedOut({ headers: {} } as Request, res as unknown as Response);
    expect(res.clearCookie).toHaveBeenCalledWith('mygitnotes_workspace', expect.objectContaining({ path: '/' }));
  });
});
