import type { WorkspacePerson } from '@mygitnotes/core';
import type { Request, Response } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceChoices } from './repository-choice.js';

/** What a {@link WorkspaceChoices} implementation needs to tell two visitors apart. */
export interface WorkspaceChoicesFixture {
  choices: WorkspaceChoices;
  /** Request cookies that make the n-th visitor (1 or 2) a signed-in person; the cookie implementation needs none. */
  visitor(n: number): Promise<Record<string, string>>;
  /**
   * The person `/mcp` names on the request for the n-th visitor's grant (`request.person`). Omit it when choices are not
   * kept per person, as the cookie implementation's are not; a request naming a person then carries no cookie at all.
   */
  person?(n: number): Promise<WorkspacePerson>;
}

/** A browser for one visitor: it sends its cookies and keeps those a response sets or clears. */
function browser(initial: Record<string, string>) {
  const jar = { ...initial };
  const headers = () => ({ cookie: Object.entries(jar).map(([name, value]) => `${name}=${value}`).join('; ') });
  const exchange = () => {
    const res = {
      cookie: (name: string, value: string) => {
        jar[name] = value;
        return res;
      },
      clearCookie: (name: string) => {
        delete jar[name];
        return res;
      },
    };
    return { req: { headers: headers() } as unknown as Request, res: res as unknown as Response };
  };
  return { headers, exchange };
}

/**
 * The behavior every {@link WorkspaceChoices} must keep. An edition runs it against its own implementation:
 * `workspaceChoicesContract('postgres', async () => ({ choices: postgresChoices(sql), visitor: signIn }))`.
 * `makeFixture` is called once per test, after SESSION_SECRET is set, and should start with no choices.
 */
export function workspaceChoicesContract(name: string, makeFixture: () => WorkspaceChoicesFixture | Promise<WorkspaceChoicesFixture>) {
  describe(`${name} workspace choices contract`, () => {
    let fixture: WorkspaceChoicesFixture;
    beforeEach(async () => {
      vi.stubEnv('SESSION_SECRET', 'contract-secret'.repeat(4));
      fixture = await makeFixture();
    });
    afterEach(() => vi.unstubAllEnvs());
    const visit = async (n: number) => browser(await fixture.visitor(n));

    it('has no choice for a visitor who has not chosen', async () => {
      const visitor = await visit(1);
      expect(await fixture.choices.read({ headers: visitor.headers() })).toBeNull();
    });

    it('reads back the latest choice with its branch', async () => {
      const visitor = await visit(1);
      let { req, res } = visitor.exchange();
      await fixture.choices.write(req, res, { repository: 'octo/notes', branch: 'main' });
      expect(await fixture.choices.read({ headers: visitor.headers() })).toEqual({ repository: 'octo/notes', branch: 'main' });
      ({ req, res } = visitor.exchange());
      await fixture.choices.write(req, res, { repository: 'octo/journal', branch: 'drafts' });
      expect(await fixture.choices.read({ headers: visitor.headers() })).toEqual({ repository: 'octo/journal', branch: 'drafts' });
    });

    it("keeps each visitor's choice apart", async () => {
      const first = await visit(1), second = await visit(2);
      const one = first.exchange();
      await fixture.choices.write(one.req, one.res, { repository: 'octo/notes', branch: 'main' });
      const two = second.exchange();
      await fixture.choices.write(two.req, two.res, { repository: 'hubot/wiki', branch: 'trunk' });
      expect(await fixture.choices.read({ headers: first.headers() })).toEqual({ repository: 'octo/notes', branch: 'main' });
      expect(await fixture.choices.read({ headers: second.headers() })).toEqual({ repository: 'hubot/wiki', branch: 'trunk' });
    });

    it('reads the choice of the person a grant names, from a request without any browser cookie', async () => {
      if (!fixture.person) return;
      const visitor = await visit(1);
      const { req, res } = visitor.exchange();
      await fixture.choices.write(req, res, { repository: 'octo/notes', branch: 'main' });
      expect(await fixture.choices.read({ headers: {}, person: await fixture.person(1) })).toEqual({ repository: 'octo/notes', branch: 'main' });
    });

    it("reads the choice of the person a grant names even beside another visitor's browser cookie", async () => {
      if (!fixture.person) return;
      const first = await visit(1), second = await visit(2);
      const one = first.exchange();
      await fixture.choices.write(one.req, one.res, { repository: 'octo/notes', branch: 'main' });
      const two = second.exchange();
      await fixture.choices.write(two.req, two.res, { repository: 'hubot/wiki', branch: 'trunk' });
      expect(await fixture.choices.read({ headers: second.headers(), person: await fixture.person(1) })).toEqual({ repository: 'octo/notes', branch: 'main' });
    });

    it('forgets a cleared choice', async () => {
      const visitor = await visit(1);
      const write = visitor.exchange();
      await fixture.choices.write(write.req, write.res, { repository: 'octo/notes', branch: 'main' });
      const clear = visitor.exchange();
      await fixture.choices.clear(clear.req, clear.res);
      expect(await fixture.choices.read({ headers: visitor.headers() })).toBeNull();
    });
  });
}
