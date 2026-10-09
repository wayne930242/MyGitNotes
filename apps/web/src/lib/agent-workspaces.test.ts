import { expect, it } from 'vitest';
import { workspaceName } from './agent-workspaces.js';

it("names each repository's root by that repository's title, and a folder by its own name", () => {
  const repositories = [{ id: 'github:me/kb@main', repository: 'me/kb', title: 'Knowledge base' }, { id: 'github:me/campaign@main', repository: 'me/campaign', title: 'Campaign' }];
  expect(workspaceName({ repository: 'github:me/kb@main', folder: '' }, repositories)).toBe('Knowledge base');
  expect(workspaceName({ repository: 'github:me/campaign@main', folder: '' }, repositories)).toBe('Campaign');
  expect(workspaceName({ repository: 'github:me/campaign@main', folder: 'notes/trpg' }, repositories)).toBe('trpg');
  // A repository the workspace no longer lists is still named.
  expect(workspaceName({ repository: 'local:/home/me/notes', folder: '' }, repositories)).toBe('notes');
});
