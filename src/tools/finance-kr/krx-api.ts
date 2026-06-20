/**
 * Authenticated client for KRX Data Marketplace `getJsonData.cmd`.
 *
 * Mirrors the shape of `dartApi` (./api.ts) but: POST form-encoded, no API key
 * (auth is the logged-in session cookie from ./krx-session.ts), and a missing
 * `OutBlock_1` is the legitimate "no data" outcome rather than a status code.
 *
 * KRX answers an unauthenticated/expired request with the literal body
 * "LOGOUT" (HTTP 400); we detect that, refresh the session once, and retry.
 */
import { readCache, writeCache, describeRequest } from '../../utils/cache.js';
import { logger } from '../../utils/logger.js';
import { getKrxSession, cookieHeader, USER_AGENT, type KrxSession } from './krx-session.js';

const DATA_URL = 'https://data.krx.co.kr/comm/bldAttendant/getJsonData.cmd';
const DATA_REFERER = 'https://data.krx.co.kr/contents/MDC/MDI/outerLoader/index.cmd';

export interface KrxApiResponse {
  data: Record<string, unknown>;
  url: string;
}

export function isLogoutBody(body: string): boolean {
  const trimmed = body.trim();
  return trimmed === 'LOGOUT' || trimmed.startsWith('<');
}

async function postJsonData(
  session: KrxSession,
  bld: string,
  params: Record<string, string | number | undefined>,
): Promise<string> {
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) body.set(key, String(value));
  }
  body.set('bld', bld);

  const response = await fetch(DATA_URL, {
    method: 'POST',
    headers: {
      'User-Agent': USER_AGENT,
      Referer: DATA_REFERER,
      'X-Requested-With': 'XMLHttpRequest',
      Cookie: cookieHeader(session),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });
  if (!response.ok && response.status !== 400) {
    throw new Error(`[KRX API] request failed: ${response.status} ${response.statusText}`);
  }
  return response.text();
}

export const krxApi = {
  /**
   * Fetch a KRX statistical block by `bld`. `endpoint` defaults to `bld`, which
   * also serves as the cache namespace (cache.ts turns "/" into "_").
   */
  async get(
    bld: string,
    params: Record<string, string | number | undefined>,
    options?: { cacheable?: boolean; ttlMs?: number },
  ): Promise<KrxApiResponse> {
    const label = describeRequest(bld, params);

    if (options?.cacheable) {
      const cached = readCache(bld, params, options.ttlMs);
      if (cached) return cached;
    }

    let session = await getKrxSession();
    if (!session) {
      throw new Error('[KRX API] KRX_ID/KRX_PW not set or login failed');
    }

    let raw: string;
    try {
      raw = await postJsonData(session, bld, params);
      if (isLogoutBody(raw)) {
        // Session likely expired/invalid — re-login once and retry.
        session = await getKrxSession({ forceRefresh: true });
        if (!session) {
          throw new Error('[KRX API] KRX_ID/KRX_PW not set or login failed');
        }
        raw = await postJsonData(session, bld, params);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(`[KRX API] network error: ${label} — ${message}`);
      throw new Error(`[KRX API] request failed for ${label}: ${message}`);
    }

    if (isLogoutBody(raw)) {
      throw new Error(
        `[KRX API] not authenticated (LOGOUT) for ${label} — check KRX_ID/KRX_PW, or refresh KRX_COOKIE if using a social-login session`,
      );
    }

    let data: Record<string, unknown>;
    try {
      data = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      throw new Error(`[KRX API] request failed: invalid JSON for ${label}`);
    }

    // Display/cache URL carries no secret (auth is the session cookie).
    const url = `${DATA_URL}?bld=${encodeURIComponent(bld)}`;
    if (options?.cacheable) {
      writeCache(bld, params, data, url);
    }
    return { data, url };
  },
};
