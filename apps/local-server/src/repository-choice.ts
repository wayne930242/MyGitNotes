/** The repository a visitor chose, read from their cookie; kept apart from the routes so auth can read it too. */
import { workspaceChoiceCookie } from './browser-sessions.js';
import { unseal } from './record-store/index.js';

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
