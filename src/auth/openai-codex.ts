/**
 * ChatGPT (Codex) subscription login — OAuth 2.0 + PKCE against auth.openai.com,
 * the same public client the Codex CLI uses. Two flows:
 *   - browser: local callback on the fixed port 1455 (the only registered redirect)
 *   - device:  user-code entry at auth.openai.com/codex/device (headless / port busy)
 */
import { startCallbackServer } from './callback-server.js';
import { generatePkce, randomState } from './pkce.js';
import type { OAuthCredentials, OAuthLoginCallbacks } from './types.js';

const CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
const AUTHORIZE_URL = 'https://auth.openai.com/oauth/authorize';
const TOKEN_URL = 'https://auth.openai.com/oauth/token';
const CALLBACK_PORT = 1455;
const CALLBACK_PATH = '/auth/callback';
const REDIRECT_URI = `http://localhost:${CALLBACK_PORT}${CALLBACK_PATH}`;
const SCOPE = 'openid profile email offline_access';
const ORIGINATOR = 'dexter';

const DEVICE_USERCODE_URL = 'https://auth.openai.com/api/accounts/deviceauth/usercode';
const DEVICE_TOKEN_URL = 'https://auth.openai.com/api/accounts/deviceauth/token';
const DEVICE_REDIRECT_URI = 'https://auth.openai.com/deviceauth/callback';
const DEVICE_AUTH_URL = 'https://auth.openai.com/codex/device';
const DEVICE_MAX_WAIT_MS = 15 * 60 * 1000;

const REQUEST_TIMEOUT_MS = 15_000;

const JWT_AUTH_CLAIM = 'https://api.openai.com/auth';
const JWT_PROFILE_CLAIM = 'https://api.openai.com/profile';

interface CodexJwtPayload {
  [JWT_AUTH_CLAIM]?: { chatgpt_account_id?: string; chatgpt_plan_type?: string };
  [JWT_PROFILE_CLAIM]?: { email?: string };
}

export function decodeJwtPayload<T>(token: string): T | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf-8')) as T;
  } catch {
    return null;
  }
}

/** The ChatGPT account id is required on every backend call (chatgpt-account-id header). */
export function getCodexAccountId(accessToken: string): string | undefined {
  const id = decodeJwtPayload<CodexJwtPayload>(accessToken)?.[JWT_AUTH_CLAIM]?.chatgpt_account_id;
  return typeof id === 'string' && id ? id : undefined;
}

function profileFromToken(accessToken: string): Pick<OAuthCredentials, 'accountId' | 'email' | 'plan'> {
  const payload = decodeJwtPayload<CodexJwtPayload>(accessToken);
  const email = payload?.[JWT_PROFILE_CLAIM]?.email?.trim().toLowerCase();
  const plan = payload?.[JWT_AUTH_CLAIM]?.chatgpt_plan_type;
  return {
    accountId: getCodexAccountId(accessToken),
    email: email || undefined,
    plan: typeof plan === 'string' && plan ? plan : undefined,
  };
}

async function postToken(body: Record<string, string>): Promise<OAuthCredentials> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) {
    let detail = String(res.status);
    try {
      const err = (await res.json()) as { error?: string; error_description?: string };
      if (err.error) detail += ` ${err.error}${err.error_description ? `: ${err.error_description}` : ''}`;
    } catch {
      // non-JSON error body
    }
    throw new Error(`OpenAI token request failed: ${detail}`);
  }
  const data = (await res.json()) as { access_token?: string; refresh_token?: string; expires_in?: number };
  if (!data.access_token || typeof data.expires_in !== 'number') {
    throw new Error('OpenAI token response missing required fields');
  }
  const refresh = data.refresh_token ?? body.refresh_token;
  if (!refresh) throw new Error('OpenAI token response missing refresh_token');
  return {
    access: data.access_token,
    refresh,
    expires: Date.now() + data.expires_in * 1000,
    ...profileFromToken(data.access_token),
  };
}

function exchangeCode(code: string, verifier: string, redirectUri: string): Promise<OAuthCredentials> {
  return postToken({
    grant_type: 'authorization_code',
    client_id: CLIENT_ID,
    code,
    code_verifier: verifier,
    redirect_uri: redirectUri,
  });
}

export function refreshCodexToken(refreshToken: string): Promise<OAuthCredentials> {
  return postToken({ grant_type: 'refresh_token', client_id: CLIENT_ID, refresh_token: refreshToken });
}

export function buildCodexAuthorizeUrl(challenge: string, state: string): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope: SCOPE,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
    id_token_add_organizations: 'true',
    codex_cli_simplified_flow: 'true',
    originator: ORIGINATOR,
  });
  return `${AUTHORIZE_URL}?${params.toString()}`;
}

export async function loginCodexBrowser(cb: OAuthLoginCallbacks): Promise<OAuthCredentials> {
  const pkce = generatePkce();
  const state = randomState();
  const server = await startCallbackServer({
    port: CALLBACK_PORT,
    path: CALLBACK_PATH,
    state,
    signal: cb.signal,
  });
  try {
    cb.onAuth({
      url: buildCodexAuthorizeUrl(pkce.challenge, state),
      instructions: 'Complete the ChatGPT login in your browser.',
    });
    const code = await server.code;
    cb.onProgress?.('Exchanging authorization code…');
    const creds = await exchangeCode(code, pkce.verifier, REDIRECT_URI);
    if (!creds.accountId) throw new Error('ChatGPT account id missing from token — is this a ChatGPT plan account?');
    return creds;
  } finally {
    server.close();
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error('Login cancelled'));
    const t = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(new Error('Login cancelled'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export async function loginCodexDevice(cb: OAuthLoginCallbacks): Promise<OAuthCredentials> {
  const init = await fetch(DEVICE_USERCODE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: CLIENT_ID }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!init.ok) throw new Error(`Device authorization failed to start: ${init.status}`);
  const data = (await init.json()) as { device_auth_id?: string; user_code?: string; interval?: string | number };
  if (!data.device_auth_id || !data.user_code) throw new Error('Device authorization response missing fields');

  const intervalMs = (Number(data.interval) || 5) * 1000 + 1000;
  cb.onAuth({ url: DEVICE_AUTH_URL, userCode: data.user_code, instructions: `Enter code: ${data.user_code}` });

  const deadline = Date.now() + DEVICE_MAX_WAIT_MS;
  while (Date.now() < deadline) {
    await sleep(intervalMs, cb.signal);
    const poll = await fetch(DEVICE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ device_auth_id: data.device_auth_id, user_code: data.user_code }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    // 403/404 = the user hasn't approved yet.
    if (poll.status === 403 || poll.status === 404) continue;
    if (!poll.ok) throw new Error(`Device authorization polling failed: ${poll.status}`);
    const grant = (await poll.json()) as { authorization_code?: string; code_verifier?: string };
    if (!grant.authorization_code || !grant.code_verifier) {
      throw new Error('Device authorization response missing authorization_code');
    }
    cb.onProgress?.('Exchanging authorization code…');
    return exchangeCode(grant.authorization_code, grant.code_verifier, DEVICE_REDIRECT_URI);
  }
  throw new Error('Device authorization timed out');
}
