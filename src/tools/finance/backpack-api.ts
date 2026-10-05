/**
 * Minimal client for Backpack's public US-stock JSON endpoints — the data behind
 * backpack.exchange/stocks/{TICKER}. Keyless.
 *
 * `/stats` carries the beta (plus market cap / sector); `/{TICKER}` carries the
 * listing date and security type, which the beta needs for context: Backpack does
 * not disclose the regression window or observation count, and a recent listing
 * yields a short-sample beta (CRWV ~7, ARM ~3.8) with no outward sign otherwise.
 */
import { readCache, writeCache } from '../../utils/cache.js';
import { logger } from '../../utils/logger.js';

const BASE_URL = 'https://api.backpack.exchange/wapi/v1/stocks';

/** The ticker is not in Backpack's universe (HTTP 400 "Unsupported stock ticker"). */
export class BackpackUnsupportedTickerError extends Error {
  constructor(ticker: string) {
    super(`Backpack does not cover ${ticker} (unsupported ticker — US-listed stocks/ETFs only)`);
    this.name = 'BackpackUnsupportedTickerError';
  }
}

export interface BackpackStock {
  stats: Record<string, unknown>;
  info: Record<string, unknown>;
  url: string;
}

async function fetchBackpackJson(url: string, ticker: string): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetch(url, { headers: { Accept: 'application/json' } });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`[Backpack API] network error: ${ticker} — ${message}`);
    throw new Error(`[Backpack API] request failed for ${ticker}: ${message}`);
  }
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    if (response.status === 400 && body.includes('Unsupported stock ticker')) {
      throw new BackpackUnsupportedTickerError(ticker);
    }
    throw new Error(`[Backpack API] request failed for ${ticker}: ${response.status} ${response.statusText}`);
  }
  const json: unknown = await response.json().catch(() => null);
  if (!json || typeof json !== 'object' || Array.isArray(json)) {
    throw new Error(`[Backpack API] invalid JSON for ${ticker}`);
  }
  return json as Record<string, unknown>;
}

/** Fetch the stats + listing info for one US ticker (e.g. AAPL, BRK.B). */
export async function fetchBackpackStock(
  ticker: string,
  options?: { cacheable?: boolean; ttlMs?: number },
): Promise<BackpackStock> {
  const endpoint = '/backpack/stock';
  const params = { ticker };

  if (options?.cacheable) {
    const cached = readCache(endpoint, params, options.ttlMs);
    if (cached) {
      const { stats, info } = cached.data;
      if (stats && typeof stats === 'object' && info && typeof info === 'object') {
        return { stats: stats as Record<string, unknown>, info: info as Record<string, unknown>, url: cached.url };
      }
    }
  }

  const symbol = encodeURIComponent(ticker);
  const url = `${BASE_URL}/${symbol}/stats`;
  // The info request only adds context (listDate/type); losing it must not throw
  // away a beta that /stats already returned.
  const [stats, info] = await Promise.all([
    fetchBackpackJson(url, ticker),
    fetchBackpackJson(`${BASE_URL}/${symbol}`, ticker).catch(() => null),
  ]);

  // Don't cache a partial result — the next call should retry the info request.
  if (options?.cacheable && info) {
    writeCache(endpoint, params, { stats, info }, url);
  }
  return { stats, info: info ?? {}, url };
}
