/**
 * ChatGPT (Codex) login for the desktop shell.
 *
 * The OAuth flow itself runs in the core sidecar (src/auth/store.ts) so there is
 * one implementation; main only opens the browser and relays the result. Status
 * and logout read/write the core's auth.json directly so the Settings screen
 * doesn't spawn the sidecar just to draw a status dot. Token values never leave
 * the main process.
 */
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { shell } from 'electron';
import { coreDataDir, sidecar } from './sidecar';
import type { AuthLoginResult, OAuthStatus } from '../shared/types';

const PROVIDER = 'openai-codex';

interface StoredCreds {
  access?: string;
  refresh?: string;
  email?: string;
  plan?: string;
}

function authFile(): string {
  return join(coreDataDir(), 'auth.json');
}

function readAuth(): Record<string, StoredCreds> {
  try {
    return existsSync(authFile()) ? (JSON.parse(readFileSync(authFile(), 'utf-8')) as Record<string, StoredCreds>) : {};
  } catch {
    return {};
  }
}

export function codexStatus(): OAuthStatus {
  const creds = readAuth()[PROVIDER];
  if (!creds?.access || !creds.refresh) return { loggedIn: false };
  return { loggedIn: true, email: creds.email, plan: creds.plan };
}

export function codexLogout(): void {
  const data = readAuth();
  if (!data[PROVIDER]) return;
  delete data[PROVIDER];
  writeFileSync(authFile(), JSON.stringify(data, null, 2), { mode: 0o600 });
}

let currentLogin: string | null = null;

export function codexLogin(mode: 'browser' | 'device'): Promise<AuthLoginResult> {
  if (currentLogin) sidecar.send({ type: 'auth_cancel', id: currentLogin });
  const id = randomUUID();
  currentLogin = id;

  return new Promise((resolve) => {
    const off = sidecar.subscribe((msg) => {
      if (!('id' in msg) || msg.id !== id) return;
      if (msg.type === 'auth_prompt') {
        // Device flow: the renderer shows the code (it gets this message via chat:event)
        // and the user opens the page from there.
        if (!msg.userCode) void shell.openExternal(msg.url);
        return;
      }
      if (msg.type === 'auth_result' || msg.type === 'error') {
        off();
        if (currentLogin === id) currentLogin = null;
        if (msg.type === 'error') resolve({ ok: false, error: msg.message });
        else if (msg.ok) resolve({ ok: true, email: msg.email, plan: msg.plan });
        else resolve({ ok: false, error: msg.error });
      }
    });
    sidecar.send({ type: 'auth_login', id, provider: PROVIDER, mode });
  });
}

export function codexCancelLogin(): void {
  if (currentLogin) sidecar.send({ type: 'auth_cancel', id: currentLogin });
}
