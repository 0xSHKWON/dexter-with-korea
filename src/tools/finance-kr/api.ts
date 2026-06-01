import { readCache, writeCache, describeRequest } from '../../utils/cache.js';
import { logger } from '../../utils/logger.js';

const BASE_URL = 'https://opendart.fss.or.kr/api';

export interface DartApiResponse {
  data: Record<string, unknown>;
  url: string;
}

function getApiKey(): string {
  return process.env.DART_API_KEY || '';
}

/**
 * DART returns HTTP 200 with a `status` field in the body for app-level
 * outcomes. Codes other than '000' are not real data; surface them as errors.
 *
 * Reference: https://opendart.fss.or.kr/guide/main.do?apiGrpCd=
 *   000=정상, 013=조회된 데이타가 없습니다, 020=사용한도초과, etc.
 */
function assertDartOk(label: string, data: Record<string, unknown>): void {
  const status = typeof data.status === 'string' ? data.status : undefined;
  if (status && status !== '000') {
    const message = typeof data.message === 'string' ? data.message : 'unknown';
    throw new Error(`[DART API] ${label} — status=${status} (${message})`);
  }
}

export const dartApi = {
  async get(
    endpoint: string,
    params: Record<string, string | number | undefined>,
    options?: { cacheable?: boolean; ttlMs?: number },
  ): Promise<DartApiResponse> {
    const label = describeRequest(endpoint, params);

    if (options?.cacheable) {
      const cached = readCache(endpoint, params, options.ttlMs);
      if (cached) return cached;
    }

    const apiKey = getApiKey();
    if (!apiKey) {
      throw new Error('[DART API] DART_API_KEY not set');
    }

    const url = new URL(`${BASE_URL}${endpoint}`);
    url.searchParams.set('crtfc_key', apiKey);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null) {
        url.searchParams.set(key, String(value));
      }
    }

    let response: Response;
    try {
      response = await fetch(url.toString());
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(`[DART API] network error: ${label} — ${message}`);
      throw new Error(`[DART API] request failed for ${label}: ${message}`);
    }

    if (!response.ok) {
      const detail = `${response.status} ${response.statusText}`;
      logger.error(`[DART API] HTTP error: ${label} — ${detail}`);
      throw new Error(`[DART API] request failed: ${detail}`);
    }

    const data = (await response.json().catch(() => {
      const detail = `invalid JSON (${response.status} ${response.statusText})`;
      logger.error(`[DART API] parse error: ${label} — ${detail}`);
      throw new Error(`[DART API] request failed: ${detail}`);
    })) as Record<string, unknown>;

    assertDartOk(label, data);

    // Strip the crtfc_key from the cached/logged URL to avoid leaking the secret
    const safeUrl = new URL(url.toString());
    safeUrl.searchParams.delete('crtfc_key');
    const safeUrlString = safeUrl.toString();

    if (options?.cacheable) {
      writeCache(endpoint, params, data, safeUrlString);
    }

    return { data, url: safeUrlString };
  },

  /**
   * Fetch a binary DART payload (the `/document.xml` ZIP — original filing body).
   * `get()` is JSON-only; this returns the raw bytes. Like `corpCode.xml`, DART
   * returns an XML/text status payload (not a ZIP) when the key is bad or the
   * document is missing — surface that as an error instead of a corrupt ZIP.
   * Not cached: binary doesn't fit the JSON cache; callers cache the parsed text.
   */
  async getBinary(
    endpoint: string,
    params: Record<string, string | number | undefined>,
  ): Promise<{ bytes: Uint8Array; url: string }> {
    const label = describeRequest(endpoint, params);
    const apiKey = getApiKey();
    if (!apiKey) {
      throw new Error('[DART API] DART_API_KEY not set');
    }

    const url = new URL(`${BASE_URL}${endpoint}`);
    url.searchParams.set('crtfc_key', apiKey);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null) {
        url.searchParams.set(key, String(value));
      }
    }

    let response: Response;
    try {
      response = await fetch(url.toString());
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(`[DART API] network error: ${label} — ${message}`);
      throw new Error(`[DART API] request failed for ${label}: ${message}`);
    }

    if (!response.ok) {
      const detail = `${response.status} ${response.statusText}`;
      logger.error(`[DART API] HTTP error: ${label} — ${detail}`);
      throw new Error(`[DART API] request failed: ${detail}`);
    }

    const contentType = response.headers.get('content-type') ?? '';
    if (contentType.includes('xml') || contentType.includes('json') || contentType.includes('text')) {
      const body = await response.text().catch(() => '');
      const detail = body.slice(0, 200);
      logger.error(`[DART API] expected binary: ${label} — got ${contentType}: ${detail}`);
      throw new Error(`[DART API] ${label}: expected document ZIP, got ${contentType}: ${detail}`);
    }

    const bytes = new Uint8Array(await response.arrayBuffer());

    const safeUrl = new URL(url.toString());
    safeUrl.searchParams.delete('crtfc_key');
    return { bytes, url: safeUrl.toString() };
  },
};
