import { afterAll, afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { getStoredCredentials, getValidCredentials, isLoggedIn, linkCodexCli, logout, saveCredentials } from './store';

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
  // Bun ≥1.4 stores `= undefined` as the string "undefined" — delete instead.
  if (realDir === undefined) delete process.env.DEXTER_DIR;
  else process.env.DEXTER_DIR = realDir;
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

describe('linked Codex CLI login', () => {
  const codexHome = mkdtempSync(join(tmpdir(), 'dexter-codex-home-'));
  const codexAuth = join(codexHome, 'auth.json');
  const realCodexHome = process.env.CODEX_HOME;
  const jwt = (payload: object) =>
    `${Buffer.from('{}').toString('base64url')}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.sig`;
  const claims = (exp: number) => ({
    exp,
    'https://api.openai.com/auth': { chatgpt_account_id: 'acct_cli', chatgpt_plan_type: 'pro' },
  });

  function writeCodexAuth(accessExp: number, refresh = 'cli-r1') {
    writeFileSync(
      codexAuth,
      JSON.stringify({
        OPENAI_API_KEY: null,
        auth_mode: 'chatgpt',
        tokens: {
          id_token: jwt({ email: 'Me@Example.com' }),
          access_token: jwt(claims(accessExp)),
          refresh_token: refresh,
          account_id: 'acct_cli',
        },
        last_refresh: '2026-01-01T00:00:00Z',
      }),
    );
  }

  beforeEach(() => {
    process.env.CODEX_HOME = codexHome;
    rmSync(codexAuth, { force: true });
  });
  afterAll(() => {
    if (realCodexHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = realCodexHome;
    rmSync(codexHome, { recursive: true, force: true });
  });

  it('refuses to link when Codex CLI has no ChatGPT login', () => {
    expect(() => linkCodexCli()).toThrow('codex login');
    expect(isLoggedIn('openai-codex')).toBe(false);
  });

  it('links without copying tokens and reads them live from Codex CLI', () => {
    writeCodexAuth(Math.floor(Date.now() / 1000) + 3600);
    const linked = linkCodexCli();
    expect(linked).toMatchObject({ email: 'me@example.com', plan: 'pro', accountId: 'acct_cli', source: 'codex-cli' });

    const stored = JSON.parse(readFileSync(join(dir, 'auth.json'), 'utf-8'));
    expect(stored['openai-codex']).toEqual({ source: 'codex-cli', email: 'me@example.com', plan: 'pro' });

    // Codex CLI re-logs in → Dexter sees the new token without doing anything.
    writeCodexAuth(Math.floor(Date.now() / 1000) + 7200, 'cli-r2');
    expect(getStoredCredentials('openai-codex')?.refresh).toBe('cli-r2');
  });

  it('refreshes into Codex CLI’s file (shared rotation), preserving its other fields', async () => {
    writeCodexAuth(Math.floor(Date.now() / 1000) - 60);
    linkCodexCli();
    const newAccess = jwt(claims(Math.floor(Date.now() / 1000) + 3600));
    globalThis.fetch = (async (_u: RequestInfo | URL, init?: RequestInit) => {
      expect(String(init?.body)).toContain('refresh_token=cli-r1');
      return Response.json({ access_token: newAccess, refresh_token: 'cli-r2', expires_in: 3600 });
    }) as typeof fetch;

    const creds = await getValidCredentials('openai-codex');
    expect(creds.access).toBe(newAccess);

    const file = JSON.parse(readFileSync(codexAuth, 'utf-8'));
    expect(file.tokens.access_token).toBe(newAccess);
    expect(file.tokens.refresh_token).toBe('cli-r2');
    expect(file.tokens.id_token).toBeTruthy();
    expect(file.auth_mode).toBe('chatgpt');
    expect(file.last_refresh).not.toBe('2026-01-01T00:00:00Z');
    // Dexter's own file still holds only the pointer.
    expect(JSON.parse(readFileSync(join(dir, 'auth.json'), 'utf-8'))['openai-codex'].access).toBeUndefined();
  });

  it('logout only unlinks — Codex CLI stays logged in', () => {
    writeCodexAuth(Math.floor(Date.now() / 1000) + 3600);
    linkCodexCli();
    expect(logout('openai-codex')).toBe(true);
    expect(isLoggedIn('openai-codex')).toBe(false);
    expect(JSON.parse(readFileSync(codexAuth, 'utf-8')).tokens.refresh_token).toBe('cli-r1');
  });
});
