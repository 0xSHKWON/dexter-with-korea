import { afterAll, afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync, statSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { getStoredCredentials, getValidCredentials, isLoggedIn, logout, saveCredentials } from './store';

const dir = mkdtempSync(join(tmpdir(), 'dexter-auth-test-'));
const realDir = process.env.DEXTER_DIR;
const realFetch = globalThis.fetch;

beforeEach(() => {
  process.env.DEXTER_DIR = dir;
  rmSync(join(dir, 'auth.json'), { force: true });
});
afterEach(() => {
  globalThis.fetch = realFetch;
});
afterAll(() => {
  process.env.DEXTER_DIR = realDir;
  rmSync(dir, { recursive: true, force: true });
});

describe('auth store', () => {
  it('persists credentials owner-only and logs out', () => {
    expect(isLoggedIn('openai-codex')).toBe(false);
    saveCredentials('openai-codex', { access: 'a', refresh: 'r', expires: Date.now() + 3600_000 });
    expect(isLoggedIn('openai-codex')).toBe(true);
    if (process.platform !== 'win32') {
      expect(statSync(join(dir, 'auth.json')).mode & 0o777).toBe(0o600);
    }
    expect(logout('openai-codex')).toBe(true);
    expect(isLoggedIn('openai-codex')).toBe(false);
    expect(logout('openai-codex')).toBe(false);
  });

  it('returns a fresh token without hitting the network', async () => {
    saveCredentials('openai-codex', { access: 'a', refresh: 'r', expires: Date.now() + 3600_000 });
    globalThis.fetch = (() => {
      throw new Error('should not refresh');
    }) as unknown as typeof fetch;
    expect((await getValidCredentials('openai-codex')).access).toBe('a');
  });

  it('refreshes once for concurrent callers and keeps profile fields', async () => {
    saveCredentials('openai-codex', {
      access: 'old',
      refresh: 'r1',
      expires: Date.now() - 1000,
      accountId: 'acct_1',
      email: 'me@example.com',
    });
    let calls = 0;
    globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
      calls++;
      expect(String(init?.body)).toContain('refresh_token=r1');
      // A non-JWT access token: no profile claims, so stored accountId/email must survive.
      return Response.json({ access_token: 'new', refresh_token: 'r2', expires_in: 3600 });
    }) as typeof fetch;

    const [a, b] = await Promise.all([getValidCredentials('openai-codex'), getValidCredentials('openai-codex')]);
    expect(calls).toBe(1);
    expect(a.access).toBe('new');
    expect(b.access).toBe('new');
    expect(getStoredCredentials('openai-codex')).toMatchObject({
      access: 'new',
      refresh: 'r2',
      accountId: 'acct_1',
      email: 'me@example.com',
    });
  });

  it('tells the user how to log in when there are no credentials', async () => {
    await expect(getValidCredentials('openai-codex')).rejects.toThrow('/login');
  });
});
