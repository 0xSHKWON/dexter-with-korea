/**
 * Reuse an existing Codex CLI login (`codex login`) instead of logging in again.
 *
 * The tokens are shared, not copied: Dexter reads `$CODEX_HOME/auth.json` on
 * every call and writes refreshed tokens back into that same file. OpenAI
 * rotates the refresh token on each refresh, so a copied token pair would
 * break whichever of Dexter / Codex CLI refreshed second.
 */
import { chmodSync, existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { decodeJwtPayload, getCodexAccountId } from './openai-codex.js';
import type { OAuthCredentials } from './types.js';

/** Shape of Codex CLI's auth.json (only the fields Dexter touches; the rest is preserved). */
interface CodexCliAuthFile {
  OPENAI_API_KEY?: string | null;
  tokens?: {
    id_token?: string;
    access_token?: string;
    refresh_token?: string;
    account_id?: string;
  };
  last_refresh?: string;
  [key: string]: unknown;
}

interface JwtClaims {
  exp?: number;
  email?: string;
  'https://api.openai.com/auth'?: { chatgpt_plan_type?: string };
  'https://api.openai.com/profile'?: { email?: string };
}

export function codexCliAuthPath(): string {
  return join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'auth.json');
}

function readFile(): CodexCliAuthFile | null {
  const path = codexCliAuthPath();
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as CodexCliAuthFile;
  } catch {
    return null;
  }
}

/** The ChatGPT-login tokens in Codex CLI's auth.json, or null if there is no such login. */
export function readCodexCliCredentials(): OAuthCredentials | null {
  const tokens = readFile()?.tokens;
  if (!tokens?.access_token || !tokens.refresh_token) return null;
  const access = decodeJwtPayload<JwtClaims>(tokens.access_token);
  const id = tokens.id_token ? decodeJwtPayload<JwtClaims>(tokens.id_token) : null;
  const email =
    id?.email ?? access?.['https://api.openai.com/profile']?.email ?? access?.email ?? undefined;
  const plan =
    id?.['https://api.openai.com/auth']?.chatgpt_plan_type ??
    access?.['https://api.openai.com/auth']?.chatgpt_plan_type;
  return {
    access: tokens.access_token,
    refresh: tokens.refresh_token,
    // No exp claim → treat as expired so the first call refreshes it.
    expires: access?.exp ? access.exp * 1000 : 0,
    accountId: tokens.account_id || getCodexAccountId(tokens.access_token),
    email: email?.toLowerCase(),
    plan: plan || undefined,
  };
}

/** Write refreshed tokens back into Codex CLI's file, preserving everything else in it. */
export function writeCodexCliCredentials(creds: OAuthCredentials): void {
  const path = codexCliAuthPath();
  const current = readFile() ?? {};
  const next: CodexCliAuthFile = {
    ...current,
    tokens: {
      ...current.tokens,
      access_token: creds.access,
      refresh_token: creds.refresh,
      ...(creds.accountId ? { account_id: creds.accountId } : {}),
    },
    last_refresh: new Date().toISOString(),
  };
  // Atomic replace: Codex CLI may be reading this file at the same moment.
  const tmp = `${path}.dexter-${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(next, null, 2), { mode: 0o600 });
  chmodSync(tmp, 0o600);
  renameSync(tmp, path);
}
