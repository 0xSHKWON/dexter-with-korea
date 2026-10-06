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

const MAX_RATE_LIMIT_RETRIES = 2;
const MAX_RATE_LIMIT_WAIT_MS = 10_000;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Wait before retrying a 429: Retry-After (seconds) when given, else exponential backoff. */
export function rateLimitWaitMs(retryAfter: string | null, attempt: number): number {
  const sec = retryAfter === null ? NaN : Number(retryAfter);
  return Number.isFinite(sec) && sec >= 0 ? sec * 1000 : 1000 * 2 ** attempt;
}

async function fetchBackpackJson(url: string, ticker: string, attempt = 0): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetch(url, { headers: { Accept: 'application/json' } });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`[Backpack API] network error: ${ticker} — ${message}`);
    throw new Error(`[Backpack API] request failed for ${ticker}: ${message}`);
  }
  if (response.status === 429) {
    // A peer-set call fans out across many tickers on a keyless API; one 429
    // shouldn't drop a peer and push the set below the 3-peer minimum.
    const waitMs = rateLimitWaitMs(response.headers.get('retry-after'), attempt);
    if (attempt < MAX_RATE_LIMIT_RETRIES && waitMs <= MAX_RATE_LIMIT_WAIT_MS) {
      await sleep(waitMs);
      return fetchBackpackJson(url, ticker, attempt + 1);
    }
    throw new Error(`[Backpack API] rate limited for ${ticker} (429) — retry later`);
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
