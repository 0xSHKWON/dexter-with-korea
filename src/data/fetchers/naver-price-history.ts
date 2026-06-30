/**
 * Keyless daily price-history client for Naver Finance's chart API.
 *
 * `get_market_data_kr` only exposes today's snapshot (OHLC + 52w range), so a DCF
 * could not source the historical return series a beta regression needs. Naver's
 * mobile chart endpoint returns a full daily OHLC series — for both an individual
 * 6-digit listing AND the KOSPI/KOSDAQ index — as plain JSON, no key:
 *
 *   https://api.stock.naver.com/chart/domestic/item/{code}/day
 *   https://api.stock.naver.com/chart/domestic/index/{KOSPI|KOSDAQ}/day
 *
 * Each returns a bare JSON array ascending by date:
 *   { localDate: "YYYYMMDD", closePrice, openPrice, highPrice, lowPrice,
 *     accumulatedTradingVolume, foreignRetentionRate }
 *
 * This is the price-series source behind compute-beta-kr / get_beta_kr.
 */
import { readCache, writeCache } from '../../utils/cache.js';
import { logger } from '../../utils/logger.js';
import { toIsoDate, parseKrxNumber } from '../../tools/finance-kr/utils.js';

const CHART_BASE = 'https://api.stock.naver.com/chart/domestic';
const USER_AGENT =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Safari/604.1';

export type NaverChartKind = 'item' | 'index';
/** Index codes the chart endpoint accepts. */
export type NaverIndexCode = 'KOSPI' | 'KOSDAQ';

export interface PriceBar {
  /** ISO YYYY-MM-DD. */
  date: string;
  close: number;
  open: number | null;
  high: number | null;
  low: number | null;
  volume: number | null;
}

export interface PriceHistoryResult {
  /** Ascending by date. */
  bars: PriceBar[];
  url: string;
}

/** `YYYYMMDD` for a Date (UTC-agnostic; the endpoint ignores the time portion). */
function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  const day = d.getDate();
  return `${y}${m < 10 ? '0' : ''}${m}${day < 10 ? '0' : ''}${day}`;
}

/** Map one raw Naver chart row to a {@link PriceBar}; null close drops the row. */
export function mapChartRow(raw: Record<string, unknown>): PriceBar | null {
  const date = toIsoDate(raw.localDate);
  const close = parseKrxNumber(raw.closePrice);
  if (!date || close === null) return null;
  return {
    date,
    close,
    open: parseKrxNumber(raw.openPrice),
    high: parseKrxNumber(raw.highPrice),
    low: parseKrxNumber(raw.lowPrice),
    volume: parseKrxNumber(raw.accumulatedTradingVolume),
  };
}

/** Parse a bare Naver chart array into ascending {@link PriceBar}s. Pure (testable). */
export function parseChartRows(json: unknown): PriceBar[] {
  const rows = Array.isArray(json) ? (json as Record<string, unknown>[]) : [];
  return rows
    .map(mapChartRow)
    .filter((b): b is PriceBar => b !== null)
    .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Fetch a daily OHLC series for a listing (`item`) or an index. `code` is the
 * 6-digit ticker for items, or 'KOSPI'/'KOSDAQ' for an index. The window is
 * [start, end] inclusive (Date objects). Throws on network/HTTP error.
 */
export async function fetchNaverPriceHistory(
  kind: NaverChartKind,
  code: string,
  start: Date,
  end: Date,
  options?: { cacheable?: boolean; ttlMs?: number },
): Promise<PriceHistoryResult> {
  const startStr = ymd(start);
  const endStr = ymd(end);
  const endpoint = '/naver/chart';
  const params = { kind, code, start: startStr, end: endStr };

  if (options?.cacheable) {
    const cached = readCache(endpoint, params, options.ttlMs);
    if (cached) {
      const bars = cached.data.bars;
      return { bars: Array.isArray(bars) ? (bars as PriceBar[]) : [], url: cached.url };
    }
  }

  const url = `${CHART_BASE}/${kind}/${code}/day?startDateTime=${startStr}0000&endDateTime=${endStr}0000`;
  let response: Response;
  try {
    response = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' } });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`[Naver chart] network error: ${kind}/${code} — ${message}`);
    throw new Error(`[Naver chart] request failed for ${kind}/${code}: ${message}`);
  }
  if (!response.ok) {
    throw new Error(`[Naver chart] request failed: ${response.status} ${response.statusText}`);
  }
  const json = (await response.json().catch(() => {
    throw new Error(`[Naver chart] request failed: invalid JSON for ${kind}/${code}`);
  })) as unknown;
  const bars = parseChartRows(json);

  if (options?.cacheable) {
    writeCache(endpoint, params, { bars }, url);
  }
  return { bars, url };
}
