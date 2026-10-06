/** Where the repository a visitor chose is kept; apart from the routes so auth can read it too. */
import type { WorkspaceRequest } from '@mygitnotes/core';
import type { Request, Response } from 'express';
import { cookieOptions, workspaceChoiceCookie } from './browser-sessions.js';
import { seal, unseal } from './record-store/index.js';

export const choiceLifetime = 365 * 24 * 60 * 60;

/** The GitHub repository and branch a visitor works in. */
export interface WorkspaceChoice {
  repository: string;
  branch: string;
}

const setting = (env: NodeJS.ProcessEnv, suffix: string) => env[`MYGITNOTES_${suffix}`] || env[`GITHUB_NOTES_${suffix}`] || undefined;
/** A GitHub deployment without a configured repository lets each visitor pick theirs. */
export function choosesRepository(env: NodeJS.ProcessEnv = process.env): boolean {
  return setting(env, 'SOURCE') === 'github' && !setting(env, 'REPOSITORY');
}

/**
 * Keeps the repository each visitor works in, where the deployment lets them choose one.
 * The community edition seals it into a cookie; an edition with accounts keeps it per user.
 */
export interface WorkspaceChoices {
  /** The repository this request serves, or null when the visitor has not chosen one. */
  read(request: WorkspaceRequest): Promise<WorkspaceChoice | null>;
  write(req: Request, res: Response, choice: WorkspaceChoice): Promise<void>;
  /** Forgets the visitor's current choice, so they choose again. */
  clear(req: Request, res: Response): Promise<void>;
  /** Runs when the visitor signs out, before the session is cleared: a choice kept with the sign-in goes with it, one kept per user stays. */
  signedOut(req: Request, res: Response): Promise<void>;
}

/** The choice sealed into the visitor's cookie: the community edition's {@link WorkspaceChoices}. */
export function cookieWorkspaceChoices(): WorkspaceChoices {
  const clear = async (_req: Request, res: Response) => {
    res.clearCookie(workspaceChoiceCookie, cookieOptions());
  };
  return {
    read: async request => readWorkspaceChoice(request.headers.cookie),
    write: async (_req, res, choice) => {
      res.cookie(workspaceChoiceCookie, seal(choice), { ...cookieOptions(), maxAge: choiceLifetime * 1000 });
    },
    clear,
    // The cookie belongs to the sign-in it was made under.
    signedOut: clear,
  };
}

/** The choice sealed in the visitor's cookie, or null when there is none or it cannot be read. */
export function readWorkspaceChoice(cookieHeader: string | string[] | undefined): WorkspaceChoice | null {
  const header = Array.isArray(cookieHeader) ? cookieHeader.join(';') : cookieHeader || '';
  const value = header.split(';').map(part => part.trim().split('=')).find(([name, , extra]) => name === workspaceChoiceCookie && extra === undefined)?.[1];
  if (!value) return null;
  try {
    const choice = unseal(value);
    return typeof choice?.repository === 'string' && typeof choice?.branch === 'string' ? { repository: choice.repository, branch: choice.branch } : null;
  } catch {
    return null;
  }
}
