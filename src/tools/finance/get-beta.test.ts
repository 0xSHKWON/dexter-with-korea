import { describe, it, expect, afterEach } from 'bun:test';
import { getBeta, isKrTicker, mapWithConcurrency, monthsSince, toBetaRecord } from './get-beta.js';
import { BackpackUnsupportedTickerError, fetchBackpackStock, rateLimitWaitMs } from './backpack-api.js';

const NOW = new Date('2026-10-05T12:00:00Z');

function stock(stats: Record<string, unknown>, info: Record<string, unknown> = {}) {
  return { stats, info };
}

describe('monthsSince', () => {
  it('counts whole months, not rounding up a partial one', () => {
    expect(monthsSince('2021-10-05', NOW)).toBe(60);
    expect(monthsSince('2021-10-06', NOW)).toBe(59);
    expect(monthsSince('2025-03-28', NOW)).toBe(18);
  });

  it('returns null for missing or malformed dates', () => {
    expect(monthsSince(null, NOW)).toBeNull();
    expect(monthsSince('n/a', NOW)).toBeNull();
  });
});

describe('isKrTicker', () => {
  it('matches bare, Yahoo-suffixed and alphanumeric Korean codes', () => {
    for (const t of ['005930', '005930.KS', '035720.KQ', '00104K', '0126Z0']) expect(isKrTicker(t)).toBe(true);
  });

  it('leaves US tickers alone', () => {
    for (const t of ['AAPL', 'BRK.B', 'TSM', 'GOOGL', 'ABCDEF']) expect(isKrTicker(t)).toBe(false);
  });
});

describe('mapWithConcurrency', () => {
  it('preserves input order and never exceeds the limit', async () => {
    let inFlight = 0;
    let peak = 0;
    const out = await mapWithConcurrency([5, 1, 4, 2, 3, 0], 2, async (ms) => {
      peak = Math.max(peak, ++inFlight);
      await new Promise((r) => setTimeout(r, ms));
      inFlight--;
      return ms * 10;
    });
    expect(out).toEqual([50, 10, 40, 20, 30, 0]);
    expect(peak).toBe(2);
  });
});

describe('rateLimitWaitMs', () => {
  it('honours Retry-After seconds, else backs off exponentially', () => {
    expect(rateLimitWaitMs('3', 0)).toBe(3000);
    expect(rateLimitWaitMs(null, 0)).toBe(1000);
    expect(rateLimitWaitMs(null, 1)).toBe(2000);
    expect(rateLimitWaitMs('soon', 1)).toBe(2000);
  });
});

describe('toBetaRecord', () => {
  it('Blume-adjusts the raw beta and passes peer fields through', () => {
    const r = toBetaRecord(
      'AAPL',
      stock(
        { ticker: 'AAPL', beta: 1.085, marketCap: 4.87e12, sector: 'Technology', industry: 'Consumer Electronics' },
        { name: 'Apple Inc.', type: 'CS', listDate: '1980-12-12' },
      ),
      NOW,
    );
    expect(r.rawBeta).toBe(1.085);
    expect(r.adjustedBeta).toBe(1.0567); // 2/3·1.085 + 1/3
    expect(r.marketCapUsd).toBe(4.87e12);
    expect(r.sector).toBe('Technology');
    expect(r._dataQualityWarning).toBeUndefined();
  });

  it('lets a sub-0.33 raw beta through unclamped (it is raw, not adjusted)', () => {
    const r = toBetaRecord('JNJ', stock({ ticker: 'JNJ', beta: 0.235 }, { listDate: '1944-09-25', type: 'CS' }), NOW);
    expect(r.adjustedBeta).toBe(0.49);
  });

  it('flags a listing younger than the 5y monthly window', () => {
    const r = toBetaRecord('CRWV', stock({ ticker: 'CRWV', beta: 7.322 }, { listDate: '2025-03-28', type: 'CS' }), NOW);
    expect(r.historyMonths).toBe(18);
    expect(r._dataQualityWarning).toContain('상장 18개월');
    expect(r._dataQualityWarning).toContain('극단값');
  });

  it('flags negative betas and ETFs', () => {
    const neg = toBetaRecord('X', stock({ beta: -0.2 }, { listDate: '2000-01-01', type: 'CS' }), NOW);
    expect(neg._dataQualityWarning).toContain('극단값');
    const etf = toBetaRecord('SPY', stock({ beta: 1.009 }, { listDate: '1993-01-22', type: 'ETF' }), NOW);
    expect(etf._dataQualityWarning).toContain('ETF');
  });

  it('returns null betas with a warning when Backpack omits beta', () => {
    const r = toBetaRecord('NEW', stock({ ticker: 'NEW' }, { listDate: '2000-01-01' }), NOW);
    expect(r.rawBeta).toBeNull();
    expect(r.adjustedBeta).toBeNull();
    expect(r._dataQualityWarning).toContain('β가 없습니다');
  });
});

describe('fetchBackpackStock', () => {
  const realFetch = globalThis.fetch;
  const realSetTimeout = globalThis.setTimeout;
  afterEach(() => {
    globalThis.fetch = realFetch;
    globalThis.setTimeout = realSetTimeout;
  });

  function skipWaits() {
    // @ts-expect-error - test stub: resolve backoff sleeps instantly
    globalThis.setTimeout = (fn: () => void) => {
      fn();
      return 0;
    };
  }

  it('retries a 429 and returns the beta once Backpack recovers', async () => {
    skipWaits();
    let statsCalls = 0;
    globalThis.fetch = (async (url: string) => {
      if (!url.endsWith('/stats')) return respond(200, '{}');
      return ++statsCalls === 1 ? respond(429, 'slow down') : respond(200, JSON.stringify({ beta: 1.2 }));
    }) as unknown as typeof fetch;
    const s = await fetchBackpackStock('MSFT');
    expect(s.stats.beta).toBe(1.2);
    expect(statsCalls).toBe(2);
  });

  it('gives up after bounded 429 retries with a rate-limit error', async () => {
    skipWaits();
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      return respond(429, 'slow down');
    }) as unknown as typeof fetch;
    const err = await fetchBackpackStock('MSFT').catch((e: unknown) => e);
    expect((err as Error).message).toContain('rate limited');
    expect(calls).toBeLessThanOrEqual(6); // 3 attempts × 2 endpoints
  });

  function respond(status: number, body: string): Response {
    return new Response(body, { status });
  }

  it('maps the 400 "Unsupported stock ticker" response to BackpackUnsupportedTickerError', async () => {
    globalThis.fetch = (async () =>
      respond(400, 'failed to parse "StockTicker": Unsupported stock ticker `ZZZZQ`')) as unknown as typeof fetch;
    await expect(fetchBackpackStock('ZZZZQ')).rejects.toBeInstanceOf(BackpackUnsupportedTickerError);
  });

  it('surfaces other HTTP failures as generic errors', async () => {
    globalThis.fetch = (async () => respond(503, 'down')) as unknown as typeof fetch;
    const err = await fetchBackpackStock('AAPL').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(BackpackUnsupportedTickerError);
    expect((err as Error).message).toContain('503');
  });

  it('keeps the beta when only the listing-info request fails', async () => {
    globalThis.fetch = (async (url: string) =>
      url.endsWith('/stats') ? respond(200, JSON.stringify({ beta: 1.085 })) : respond(503, 'down')) as unknown as typeof fetch;
    const s = await fetchBackpackStock('AAPL');
    expect(s.stats.beta).toBe(1.085);
    expect(s.info).toEqual({});
    expect(toBetaRecord('AAPL', s, NOW)._dataQualityWarning).toContain('상장일을 확인하지 못해');
  });

  it('fetches /stats and the listing info for the ticker', async () => {
    const seen: string[] = [];
    globalThis.fetch = (async (url: string) => {
      seen.push(url);
      return respond(200, JSON.stringify(url.endsWith('/stats') ? { beta: 0.601 } : { listDate: '1996-05-09' }));
    }) as unknown as typeof fetch;
    const s = await fetchBackpackStock('BRK.B');
    expect(s.stats.beta).toBe(0.601);
    expect(s.info.listDate).toBe('1996-05-09');
    expect(seen.sort()).toEqual([
      'https://api.backpack.exchange/wapi/v1/stocks/BRK.B',
      'https://api.backpack.exchange/wapi/v1/stocks/BRK.B/stats',
    ]);
  });
});

describe('get_beta tool', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it('routes Korean 6-digit tickers to get_beta_kr without calling Backpack', async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      return new Response('{}');
    }) as unknown as typeof fetch;
    const out = JSON.parse(await getBeta.invoke({ tickers: ['005930', '035720.kq'] }));
    expect(calls).toBe(0);
    expect(out.data.betas[0]._error).toContain('get_beta_kr');
    expect(out.data.betas[1]._error).toContain('get_beta_kr with 035720');
  });
});
