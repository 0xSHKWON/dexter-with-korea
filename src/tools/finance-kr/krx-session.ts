/**
 * KRX Data Marketplace authenticated session.
 *
 * As of a 2024–2025 anti-crawling change, `data.krx.co.kr` rejects anonymous
 * statistical queries (responds with the literal body "LOGOUT"). A logged-in
 * member session is required. This module replicates the login flow used by
 * the `pykrx` library:
 *
 *   1. GET  MDCCOMS001.cmd            → seed initial JSESSIONID
 *   2. GET  view/login.jsp?site=mdc   → iframe session init
 *   3. POST MDCCOMS001D1.cmd          → actual login ({mbrId, pw})
 *      └─ _error_code: CD001=ok, CD010=password change required,
 *         CD011=duplicate login → retry with skipDup=Y
 *
 * Credentials come from `KRX_ID` / `KRX_PW`. Bun's `fetch` does not manage
 * cookies, so we keep a small in-process cookie jar and resend it. Sessions
 * expire after ~1h on KRX's side, so we refresh well before that.
 */
import { logger } from '../../utils/logger.js';

const LOGIN_PAGE = 'https://data.krx.co.kr/contents/MDC/COMS/client/MDCCOMS001.cmd';
const LOGIN_JSP = 'https://data.krx.co.kr/contents/MDC/COMS/client/view/login.jsp?site=mdc';
const LOGIN_URL = 'https://data.krx.co.kr/contents/MDC/COMS/client/MDCCOMS001D1.cmd';

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

/** Refresh ahead of KRX's ~1h server-side expiry. */
const SESSION_TTL_MS = 55 * 60 * 1000;

export interface KrxSession {
  /** name=value cookie jar (JSESSIONID, etc.) */
  cookies: Map<string, string>;
  loginAt: number;
}

let memorySession: KrxSession | null = null;
let inflight: Promise<KrxSession | null> | null = null;

function getCredentials(): { id: string; pw: string } | null {
  const id = process.env.KRX_ID ?? '';
  const pw = process.env.KRX_PW ?? '';
  if (!id || !pw || id.startsWith('your-') || pw.startsWith('your-')) return null;
  return { id, pw };
}

/**
 * Manual session-cookie override (KRX_COOKIE) for accounts that log in via a
 * social provider (Naver/Kakao) and thus have no native ID/PW to POST. Paste
 * the `Cookie` header from a logged-in browser session on data.krx.co.kr.
 * Cannot auto-refresh — the user re-pastes when it expires.
 */
function getCookieOverride(): string | null {
  const cookie = process.env.KRX_COOKIE ?? '';
  return cookie && !cookie.startsWith('your-') ? cookie : null;
}

export function sessionFromCookie(cookie: string): KrxSession {
  const cookies = new Map<string, string>();
  for (const segment of cookie.split(';')) {
    const part = segment.trim();
    const eq = part.indexOf('=');
    if (eq <= 0) continue;
    cookies.set(part.slice(0, eq).trim(), part.slice(eq + 1).trim());
  }
  return { cookies, loginAt: Date.now() };
}

/** Merge a response's Set-Cookie headers into the jar (name=value only). */
function absorbCookies(jar: Map<string, string>, response: Response): void {
  // Bun/undici expose getSetCookie(); fall back to the single-header form.
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  const setCookies = headers.getSetCookie?.() ?? [];
  const lines = setCookies.length > 0 ? setCookies : [response.headers.get('set-cookie') ?? ''];
  for (const line of lines) {
    if (!line) continue;
    const pair = line.split(';', 1)[0];
    const eq = pair.indexOf('=');
    if (eq <= 0) continue;
    jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
  }
}

export function cookieHeader(session: KrxSession): string {
  return [...session.cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
}

async function warmup(jar: Map<string, string>): Promise<void> {
  const init1 = await fetch(LOGIN_PAGE, { headers: { 'User-Agent': USER_AGENT } });
  absorbCookies(jar, init1);
  const init2 = await fetch(LOGIN_JSP, {
    headers: {
      'User-Agent': USER_AGENT,
      Referer: LOGIN_PAGE,
      Cookie: [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; '),
    },
  });
  absorbCookies(jar, init2);
}

async function postLogin(
  jar: Map<string, string>,
  id: string,
  pw: string,
): Promise<string> {
  const payload: Record<string, string> = {
    mbrNm: '',
    telNo: '',
    di: '',
    certType: '',
    mbrId: id,
    pw,
  };

  const send = async (): Promise<Record<string, unknown>> => {
    const resp = await fetch(LOGIN_URL, {
      method: 'POST',
      headers: {
        'User-Agent': USER_AGENT,
        Referer: LOGIN_PAGE,
        Cookie: [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; '),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams(payload),
    });
    absorbCookies(jar, resp);
    return (await resp.json().catch(() => ({}))) as Record<string, unknown>;
  };

  let data = await send();
  let code = typeof data._error_code === 'string' ? data._error_code : '';
  // CD011: duplicate login — retry forcing the other session out.
  if (code === 'CD011') {
    payload.skipDup = 'Y';
    data = await send();
    code = typeof data._error_code === 'string' ? data._error_code : '';
  }
  return code;
}

async function login(): Promise<KrxSession | null> {
  const creds = getCredentials();
  if (!creds) return null;

  const jar = new Map<string, string>();
  try {
    await warmup(jar);
    const code = await postLogin(jar, creds.id, creds.pw);
    if (code !== 'CD001') {
      logger.error(`[KRX session] login failed — _error_code=${code || 'unknown'}`);
      return null;
    }
    return { cookies: jar, loginAt: Date.now() };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`[KRX session] login error — ${message}`);
    return null;
  }
}

/**
 * Return a valid logged-in session, reusing the in-memory one until it nears
 * expiry. Returns null when credentials are unset or login fails (callers
 * surface this as a graceful tool error). Concurrent calls share one login.
 */
export async function getKrxSession(options?: { forceRefresh?: boolean }): Promise<KrxSession | null> {
  // A manually-supplied cookie takes precedence (social-login accounts). It
  // can't be refreshed server-side, so we just (re)wrap it as-is.
  const cookieOverride = getCookieOverride();
  if (cookieOverride) {
    if (!memorySession || options?.forceRefresh) {
      memorySession = sessionFromCookie(cookieOverride);
    }
    return memorySession;
  }

  const now = Date.now();
  if (
    !options?.forceRefresh &&
    memorySession &&
    now - memorySession.loginAt < SESSION_TTL_MS
  ) {
    return memorySession;
  }
  if (inflight) return inflight;

  inflight = (async () => {
    try {
      const session = await login();
      memorySession = session;
      return session;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

export function _resetKrxSessionForTests(): void {
  memorySession = null;
  inflight = null;
}

export { USER_AGENT };
