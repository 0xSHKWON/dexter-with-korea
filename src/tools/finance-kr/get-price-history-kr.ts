import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { fetchNaverPriceHistory, type PriceBar, type NaverIndexCode } from '../../data/fetchers/naver-price-history.js';
import { resolveKrSecurity } from './resolve-kr.js';
import { formatToolResult } from '../types.js';
import { TTL_6H } from '../finance/utils.js';

export const GET_PRICE_HISTORY_KR_DESCRIPTION = `Retrieves the daily OHLCV price series for a Korean (KOSPI/KOSDAQ) listed company OR a market index, over an arbitrary date range — keyless (Naver chart API).

Returns bars (date, open, high, low, close, volume, in 원) plus an objective summary computed from the DAILY series: totalReturnPct over the window, period high/low with dates, and maxDrawdownPct (worst peak-to-trough decline). Use it for 기간수익률, 고점 대비 낙폭, 변동성/추세 확인, 상대성과 (call once for the stock and once with ticker "KOSPI" or "KOSDAQ" for the benchmark — calls run concurrently), 우선주-보통주 괴리 추이, and event studies around a disclosure date.

Long windows are auto-downsampled (daily → weekly → monthly) to keep output readable; the summary is always computed from daily closes before downsampling, and the response says which granularity was returned. Accepts a 6-digit ticker (e.g. 005930), a company name, or an index name (KOSPI / KOSDAQ).`;

const InputSchema = z.object({
  ticker: z
    .string()
    .min(1)
    .describe('6-digit Korean stock ticker (e.g. 005930), a company name (e.g. 삼성전자), or an index: KOSPI / KOSDAQ.'),
  startDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .describe('Window start, ISO YYYY-MM-DD. Defaults to 1 year before endDate.'),
  endDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .describe('Window end, ISO YYYY-MM-DD. Defaults to today.'),
  granularity: z
    .enum(['auto', 'daily', 'weekly', 'monthly'])
    .default('auto')
    .describe("Bar granularity. 'auto' (default) picks daily/weekly/monthly by window size."),
});

export interface PriceSummary {
  firstDate: string;
  lastDate: string;
  firstClose: number;
  lastClose: number;
  /** (lastClose/firstClose − 1) × 100, rounded to 2dp. */
  totalReturnPct: number;
  high: number;
  highDate: string;
  low: number;
  lowDate: string;
  /** Worst peak-to-trough close decline within the window, ≤ 0, rounded to 2dp. */
  maxDrawdownPct: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Objective window stats from the DAILY close series. Pure (testable). */
export function computeSummary(bars: PriceBar[]): PriceSummary | null {
  if (bars.length === 0) return null;
  const first = bars[0];
  const last = bars[bars.length - 1];
  let high = first;
  let low = first;
  let peak = first.close;
  let maxDrawdown = 0;
  for (const b of bars) {
    if (b.close > high.close) high = b;
    if (b.close < low.close) low = b;
    if (b.close > peak) peak = b.close;
    const drawdown = (b.close / peak - 1) * 100;
    if (drawdown < maxDrawdown) maxDrawdown = drawdown;
  }
  return {
    firstDate: first.date,
    lastDate: last.date,
    firstClose: first.close,
    lastClose: last.close,
    totalReturnPct: round2((last.close / first.close - 1) * 100),
    high: high.close,
    highDate: high.date,
    low: low.close,
    lowDate: low.date,
    maxDrawdownPct: round2(maxDrawdown),
  };
}

/** Monday of the ISO date's week, as the weekly grouping key. */
export function weekKey(isoDate: string): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  const daysSinceMonday = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - daysSinceMonday);
  return d.toISOString().slice(0, 10);
}

/**
 * Downsample daily bars to weekly/monthly: open = first open, high/low = extremes
 * (falling back to close where OHLC is missing), close = last close, volume = sum,
 * date = last trading day of the bucket. Pure (testable).
 */
export function aggregateBars(bars: PriceBar[], granularity: 'weekly' | 'monthly'): PriceBar[] {
  const buckets = new Map<string, PriceBar[]>();
  for (const b of bars) {
    const key = granularity === 'weekly' ? weekKey(b.date) : b.date.slice(0, 7);
    const bucket = buckets.get(key);
    if (bucket) bucket.push(b);
    else buckets.set(key, [b]);
  }
  return [...buckets.values()]
    .map((group) => {
      const first = group[0];
      const last = group[group.length - 1];
      const highs = group.map((g) => g.high ?? g.close);
      const lows = group.map((g) => g.low ?? g.close);
      const volumes = group.map((g) => g.volume).filter((v): v is number => v !== null);
      return {
        date: last.date,
        close: last.close,
        open: first.open ?? first.close,
        high: Math.max(...highs),
        low: Math.min(...lows),
        volume: volumes.length > 0 ? volumes.reduce((a, v) => a + v, 0) : null,
      };
    })
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** 'auto' → the coarsest granularity that keeps the series readable. Pure. */
export function resolveGranularity(
  requested: 'auto' | 'daily' | 'weekly' | 'monthly',
  dailyBarCount: number,
): 'daily' | 'weekly' | 'monthly' {
  if (requested !== 'auto') return requested;
  if (dailyBarCount <= 190) return 'daily'; // ~9 months of trading days
  if (dailyBarCount <= 900) return 'weekly'; // ~3.5 years
  return 'monthly';
}

const INDEX_CODES: Record<string, NaverIndexCode> = { KOSPI: 'KOSPI', KOSDAQ: 'KOSDAQ' };

export const getPriceHistoryKr = new DynamicStructuredTool({
  name: 'get_price_history_kr',
  description: GET_PRICE_HISTORY_KR_DESCRIPTION,
  schema: InputSchema,
  func: async (input) => {
    const end = input.endDate ? new Date(`${input.endDate}T00:00:00Z`) : new Date();
    const start = input.startDate
      ? new Date(`${input.startDate}T00:00:00Z`)
      : new Date(new Date(end).setUTCFullYear(end.getUTCFullYear() - 1));
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) {
      return formatToolResult(
        { ticker: input.ticker, _error: `Invalid date window ${input.startDate ?? '(default)'} → ${input.endDate ?? '(today)'}` },
        [],
      );
    }

    const indexCode = INDEX_CODES[input.ticker.trim().toUpperCase()];
    let code: string;
    let name: string | null;
    if (indexCode) {
      code = indexCode;
      name = indexCode;
    } else {
      const resolved = await resolveKrSecurity(input.ticker);
      if (!resolved) {
        return formatToolResult(
          { ticker: input.ticker, _error: `Could not resolve "${input.ticker}" to a Korean listing — pass a 6-digit ticker, an exact company name, or KOSPI/KOSDAQ` },
          [],
        );
      }
      code = resolved.stockCode;
      name = resolved.name;
    }

    const base = { ticker: code, name, kind: indexCode ? 'index' : 'stock' };
    try {
      const { bars: daily, url } = await fetchNaverPriceHistory(indexCode ? 'index' : 'item', code, start, end, {
        cacheable: true,
        ttlMs: TTL_6H,
      });
      const summary = computeSummary(daily);
      const granularity = resolveGranularity(input.granularity, daily.length);
      const bars = granularity === 'daily' ? daily : aggregateBars(daily, granularity);
      return formatToolResult(
        {
          ...base,
          granularity,
          dailyBarCount: daily.length,
          summary,
          bars,
          ...(summary
            ? {}
            : { _note: '해당 기간에 거래 데이터가 없습니다 — 상장 전 구간이거나 잘못된 기간일 수 있습니다.' }),
        },
        [url],
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return formatToolResult({ ...base, _error: message }, []);
    }
  },
});
