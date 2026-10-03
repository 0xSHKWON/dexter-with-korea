/**
 * Persisted subscription-login credentials: `<DEXTER_DIR>/auth.json` (mode 0600).
 *
 * The path is resolved per call, not at module load, so the desktop sidecar's
 * DEXTER_DIR override and tests' temp dirs both take effect.
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { dexterPath } from '../utils/paths.js';
import { loginCodexBrowser, loginCodexDevice, refreshCodexToken } from './openai-codex.js';
import { readCodexCliCredentials, writeCodexCliCredentials } from './codex-cli.js';
import type { OAuthCredentials, OAuthLoginCallbacks, OAuthProviderId } from './types.js';

/** A login linked to Codex CLI stores no tokens here — only a pointer plus cached identity. */
interface LinkedEntry {
  source: 'codex-cli';
  email?: string;
  plan?: string;
}

type AuthFile = Partial<Record<OAuthProviderId, OAuthCredentials | LinkedEntry>>;

/** Refresh this long before the real expiry so a long agent turn doesn't straddle it. */
const REFRESH_SKEW_MS = 5 * 60 * 1000;

function authFilePath(): string {
  return dexterPath('auth.json');
}

function readAuthFile(): AuthFile {
  const path = authFilePath();
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as AuthFile;
  } catch {
    return {};
  }
}

function writeAuthFile(data: AuthFile): void {
  const path = authFilePath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2), { mode: 0o600 });
  // writeFileSync's mode only applies on create; tighten a pre-existing file too.
  chmodSync(path, 0o600);
}

export function getStoredCredentials(provider: OAuthProviderId): OAuthCredentials | undefined {
  const entry = readAuthFile()[provider];
  if (entry?.source === 'codex-cli') {
    const shared = readCodexCliCredentials();
    return shared ? { ...shared, source: 'codex-cli' } : undefined;
  }
  const creds = entry as OAuthCredentials | undefined;
  return creds?.access && creds.refresh ? creds : undefined;
}

export function saveCredentials(provider: OAuthProviderId, creds: OAuthCredentials): void {
  writeAuthFile({ ...readAuthFile(), [provider]: creds });
}

export function isLoggedIn(provider: OAuthProviderId): boolean {
  return getStoredCredentials(provider) !== undefined;
}

export function logout(provider: OAuthProviderId): boolean {
  const data = readAuthFile();
  if (!data[provider]) return false;
  delete data[provider];
  writeAuthFile(data);
  return true;
}

const inflightRefresh = new Map<OAuthProviderId, Promise<OAuthCredentials>>();

/**
 * Credentials with a usable access token, refreshing (and persisting) when close
 * to expiry. Concurrent callers share one refresh — OpenAI rotates refresh
 * tokens, so two parallel refreshes would invalidate each other.
 */
export async function getValidCredentials(provider: OAuthProviderId): Promise<OAuthCredentials> {
  const creds = getStoredCredentials(provider);
  if (!creds) {
    throw new Error(`Not logged in to ${provider}. Run /login in the CLI or log in from the desktop settings.`);
  }
  if (creds.expires - REFRESH_SKEW_MS > Date.now()) return creds;

  let pending = inflightRefresh.get(provider);
  if (!pending) {
    pending = (async () => {
      if (creds.source === 'codex-cli') {
        // Codex CLI may have refreshed the shared file since we read it.
        const latest = readCodexCliCredentials();
        if (latest && latest.expires - REFRESH_SKEW_MS > Date.now()) return { ...latest, source: 'codex-cli' as const };
      }
      const refreshed = await refreshCodexToken(creds.refresh);
      const merged: OAuthCredentials = { ...creds, ...stripUndefined(refreshed) };
      if (creds.source === 'codex-cli') writeCodexCliCredentials(merged);
      else saveCredentials(provider, merged);
      return merged;
    })().finally(() => inflightRefresh.delete(provider));
    inflightRefresh.set(provider, pending);
  }
  return pending;
}

function stripUndefined<T extends object>(obj: T): Partial<T> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as Partial<T>;
}

/**
 * Use the existing Codex CLI login (`codex login`, ChatGPT mode) instead of a
 * separate Dexter login. Logging out of Dexter later only unlinks — Codex CLI
 * stays logged in.
 */
export function linkCodexCli(provider: OAuthProviderId = 'openai-codex'): OAuthCredentials {
  const shared = readCodexCliCredentials();
  if (!shared) {
    throw new Error('No Codex CLI ChatGPT login found. Run `codex login` first (or log in to ChatGPT here).');
  }
  const entry: LinkedEntry = { source: 'codex-cli', email: shared.email, plan: shared.plan };
  writeAuthFile({ ...readAuthFile(), [provider]: entry });
  return { ...shared, source: 'codex-cli' };
}

export type LoginMode = 'browser' | 'device';

/** Run the login flow and persist the result. */
export async function login(
  provider: OAuthProviderId,
  callbacks: OAuthLoginCallbacks,
  mode: LoginMode = 'browser',
): Promise<OAuthCredentials> {
  const creds = mode === 'device' ? await loginCodexDevice(callbacks) : await loginCodexBrowser(callbacks);
  saveCredentials(provider, creds);
  return creds;
}
