/**
 * Minimal client for Naver Finance's mobile JSON API.
 *
 * KRX no longer serves foreign-ownership data without a member login, and
 * there is no clean official open API for it. Naver's mobile endpoint exposes
 * the daily foreign holding ratio (and investor net-buy quantities) keyed by
 * the 6-digit ticker as plain JSON — no key, no HTML scraping.
 */
import { readCache, writeCache } from '../../utils/cache.js';
import { logger } from '../../utils/logger.js';

const BASE_URL = 'https://m.stock.naver.com/api/stock';
const USER_AGENT =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Safari/604.1';

export interface NaverTrendResult {
  rows: Record<string, unknown>[];
  url: string;
}

/**
 * Fetch the investor/foreign daily trend for a 6-digit ticker. The endpoint
 * returns a bare JSON array of daily rows (most recent first).
 */
export async function fetchNaverTrend(
  ticker: string,
  options?: { cacheable?: boolean; ttlMs?: number },
): Promise<NaverTrendResult> {
  const endpoint = '/naver/trend';
  const params = { ticker };

  if (options?.cacheable) {
    const cached = readCache(endpoint, params, options.ttlMs);
    if (cached) {
      const rows = cached.data.rows;
      return { rows: Array.isArray(rows) ? (rows as Record<string, unknown>[]) : [], url: cached.url };
    }
  }

  const url = `${BASE_URL}/${ticker}/trend`;
  let response: Response;
  try {
    response = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' } });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`[Naver API] network error: ${ticker} — ${message}`);
    throw new Error(`[Naver API] request failed for ${ticker}: ${message}`);
  }

  if (!response.ok) {
    throw new Error(`[Naver API] request failed: ${response.status} ${response.statusText}`);
  }

  const json = (await response.json().catch(() => {
    throw new Error(`[Naver API] request failed: invalid JSON for ${ticker}`);
  })) as unknown;
  const rows = Array.isArray(json) ? (json as Record<string, unknown>[]) : [];

  if (options?.cacheable) {
    writeCache(endpoint, params, { rows }, url);
  }
  return { rows, url };
}
