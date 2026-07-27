import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { fetchNaverPriceHistory, type PriceBar, type NaverIndexCode } from '../../data/fetchers/naver-price-history.js';
import { weekKey } from '../../data/compute-beta-kr.js';
import { resolveKrSecurity } from './resolve-kr.js';
import { round2 } from './utils.js';
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

/** Objective window stats from the DAILY close series. Pure (testable). */
export function computeSummary(bars: PriceBar[]): PriceSummary | null {
  // A close of 0 is bogus source data (e.g. padding rows for a suspended listing),
  // and dividing by it turns the whole summary into Infinity/NaN — skip such bars.
  const valid = bars.filter((b) => b.close > 0);
  if (valid.length === 0) return null;
  const first = valid[0];
  const last = valid[valid.length - 1];
  let high = first;
  let low = first;
  let peak = first.close;
  let maxDrawdown = 0;
  for (const b of valid) {
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

/**
 * Parse ISO `YYYY-MM-DD` as LOCAL midnight. The chart fetcher formats dates with
 * local getters (`ymd` in naver-price-history.ts), so a UTC-midnight Date would
 * shift the whole requested window one calendar day earlier on UTC-negative hosts.
 * Local-midnight parsing makes the formatted window reproduce the requested
 * calendar days on any host timezone.
 */
export function parseIsoDateLocal(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** Local `YYYYMMDD` — same calendar-day semantics the chart fetcher sends to Naver. */
export function localYmd(d: Date): string {
  const m = d.getMonth() + 1;
  const day = d.getDate();
  return `${d.getFullYear()}${m < 10 ? '0' : ''}${m}${day < 10 ? '0' : ''}${day}`;
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

// Korean aliases included: '코스피' misses Naver autocomplete entirely (returns []),
// so without them a natural-Korean index request dead-ends in a resolver error.
const INDEX_CODES: Record<string, NaverIndexCode> = {
  KOSPI: 'KOSPI',
  KOSDAQ: 'KOSDAQ',
  코스피: 'KOSPI',
  코스닥: 'KOSDAQ',
};

/**
 * Cap returned bars so the tool result stays under the agent's 50KB tool-result
 * cap (an over-cap payload is persisted to a file and the model only sees a
 * 2,000-char preview). The summary is computed from the FULL daily series before
 * this cap, so nothing is lost analytically — the cap only trims the bar list.
 */
export const MAX_RETURNED_BARS = 400;

export const getPriceHistoryKr = new DynamicStructuredTool({
  name: 'get_price_history_kr',
  description: GET_PRICE_HISTORY_KR_DESCRIPTION,
  schema: InputSchema,
  func: async (input) => {
    const end = input.endDate ? parseIsoDateLocal(input.endDate) : new Date();
    const start = input.startDate
      ? parseIsoDateLocal(input.startDate)
      : new Date(new Date(end).setFullYear(end.getFullYear() - 1));
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
      // Cache only when the window is fully closed (bars are final) — same rule as
      // the US get_stock_prices tool. A today-inclusive window may carry an
      // in-progress session bar; caching it would serve an intraday provisional
      // close as the day's final close for the whole TTL.
      const windowClosed = localYmd(end) < localYmd(new Date());
      const { bars: daily, url } = await fetchNaverPriceHistory(
        indexCode ? 'index' : 'item',
        code,
        start,
        end,
        windowClosed ? { cacheable: true, ttlMs: TTL_6H } : undefined,
      );
      const summary = computeSummary(daily);
      const granularity = resolveGranularity(input.granularity, daily.length);
      const allBars = granularity === 'daily' ? daily : aggregateBars(daily, granularity);
      const bars = allBars.length > MAX_RETURNED_BARS ? allBars.slice(-MAX_RETURNED_BARS) : allBars;
      const notes: string[] = [];
      if (!summary) {
        notes.push('해당 기간에 거래 데이터가 없습니다 — 상장 전 구간이거나 잘못된 기간일 수 있습니다.');
      } else if (!windowClosed) {
        notes.push('기간에 오늘이 포함됩니다 — 장중에는 마지막 bar가 진행 중(잠정) 값일 수 있습니다. 확정 실시간 현재가는 get_market_data_kr 기준으로 인용하세요.');
      }
      if (bars.length < allBars.length) {
        notes.push(
          `bar 목록은 가장 최근 ${MAX_RETURNED_BARS}개만 반환합니다 (전체 ${allBars.length}개 중 앞 ${allBars.length - bars.length}개 생략 — summary는 전체 일별 시계열 기준). 더 긴 구간은 weekly/monthly granularity를 쓰세요.`,
        );
      }
      return formatToolResult(
        {
          ...base,
          granularity,
          dailyBarCount: daily.length,
          summary,
          bars,
          ...(notes.length > 0 ? { _note: notes.join(' ') } : {}),
        },
        [url],
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return formatToolResult({ ...base, _error: message }, []);
    }
  },
});
