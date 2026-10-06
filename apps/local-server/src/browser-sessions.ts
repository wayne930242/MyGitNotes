import type { WorkspaceRequest } from '@mygitnotes/core';
import type { Request, Response } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { random, type RecordStore, seal, type StoredRecord, unseal } from './record-store/index.js';

export const sessionCookie = 'gh_notes_session';
/** The repository a visitor chose, where the deployment lets them choose (see workspace-choice.ts). */
export const workspaceChoiceCookie = 'mygitnotes_workspace';
const signInCookie = 'gh_notes_oauth';
const signInLifetime = 600;
const opaqueId = /^[A-Za-z0-9_-]{43}$/;

/** OAuth state and PKCE verifier kept between the provider redirect and its callback. */
export interface PendingSignIn {
  realm: string;
  verifier: string;
}

/**
 * Where a browser's sign-in lives. `stored` keeps an opaque cookie id and the session in the record store;
 * `cookie` (the lightweight mode) seals the whole session into the cookie and keeps nothing on the server.
 */
export interface BrowserSessions {
  readonly kind: 'stored' | 'cookie';
  /** The session record of the request, or null when it carries none or one that cannot be read; only its headers are read. */
  read(req: WorkspaceRequest): Promise<StoredRecord | null>;
  /** Replaces the request's session with `session` for `ttlSeconds` and sets its cookie. */
  write(req: Request, res: Response, session: StoredRecord, ttlSeconds: number): Promise<void>;
  clear(req: Request, res: Response): Promise<void>;
  /** Starts a sign-in and returns the OAuth state to send to the provider. */
  beginSignIn(res: Response, pending: PendingSignIn): Promise<string>;
  /** The pending sign-in matching the callback's state, consumed; null when it is missing, expired or forged. */
  finishSignIn(req: Request, res: Response, state: string): Promise<PendingSignIn | null>;
}

export function requestCookies(req: WorkspaceRequest): Record<string, string> {
  const header = req.headers.cookie;
  return Object.fromEntries((Array.isArray(header) ? header.join(';') : header || '').split(';').map(p => p.trim().split('=')).filter(p => p.length === 2));
}
export function cookieOptions() {
  return { httpOnly: true, secure: process.env.APP_URL?.startsWith('https://') || Boolean(process.env.VERCEL), sameSite: 'lax' as const, path: '/' };
}
const sameState = (a: string, b: string) => opaqueId.test(a) && a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** Sessions as records in the store, addressed by an opaque cookie id: the behavior every deployment had before the lightweight mode. */
export function storedSessions(store: RecordStore): BrowserSessions {
  return {
    kind: 'stored',
    async read(req) {
      const id = requestCookies(req)[sessionCookie];
      return id ? await store.get(id) : null;
    },
    async write(req, res, session, ttl) {
      const old = requestCookies(req)[sessionCookie];
      if (old) await store.delete(old);
      const id = random();
      await store.set(id, session, ttl);
      res.cookie(sessionCookie, id, { ...cookieOptions(), maxAge: ttl * 1000 });
    },
    async clear(req, res) {
      const id = requestCookies(req)[sessionCookie];
      if (id) await store.delete(id);
      res.clearCookie(sessionCookie, cookieOptions());
    },
    async beginSignIn(res, pending) {
      const state = random();
      await store.set(state, { kind: 'oauth', ...pending }, signInLifetime);
      res.cookie(signInCookie, state, { ...cookieOptions(), maxAge: signInLifetime * 1000 });
      return state;
    },
    async finishSignIn(req, res, state) {
      if (!sameState(state, requestCookies(req)[signInCookie] || '')) return null;
      const pending = await store.get(state);
      await store.delete(state);
      res.clearCookie(signInCookie, cookieOptions());
      return pending?.kind === 'oauth' ? { realm: pending.realm, verifier: pending.verifier } : null;
    },
  };
}

/** A sealed cookie value, or null when it is absent, tampered with, sealed under another secret or expired. */
function readSealed(value: string | undefined): StoredRecord | null {
  if (!value) return null;
  try {
    const record = unseal(value);
    return typeof record?.expires === 'number' && record.expires > Date.now() ? record.value : null;
  } catch {
    return null;
  }
}
const sealFor = (value: unknown, ttl: number) => seal({ value, expires: Date.now() + ttl * 1000 });

/** The lightweight mode: the session, provider token included, rides sealed in an HttpOnly cookie. */
export function cookieSessions(): BrowserSessions {
  return {
    kind: 'cookie',
    async read(req) {
      return readSealed(requestCookies(req)[sessionCookie]);
    },
    async write(_req, res, session, ttl) {
      res.cookie(sessionCookie, sealFor(session, ttl), { ...cookieOptions(), maxAge: ttl * 1000 });
    },
    async clear(_req, res) {
      res.clearCookie(sessionCookie, cookieOptions());
    },
    async beginSignIn(res, pending) {
      const state = random();
      res.cookie(signInCookie, sealFor({ state, ...pending }, signInLifetime), { ...cookieOptions(), maxAge: signInLifetime * 1000 });
      return state;
    },
    async finishSignIn(req, res, state) {
      const pending = readSealed(requestCookies(req)[signInCookie]);
      res.clearCookie(signInCookie, cookieOptions());
      return pending && typeof pending.state === 'string' && sameState(state, pending.state) ? { realm: pending.realm, verifier: pending.verifier } : null;
    },
  };
}
