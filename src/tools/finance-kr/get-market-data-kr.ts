import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { fetchNaverIntegration } from './naver-api.js';
import { resolveKrSecurity } from './resolve-kr.js';
import { parseNaverMetric, toIsoDate, nullFields } from './utils.js';
import { formatToolResult } from '../types.js';
import { TTL_1H } from '../finance/utils.js';

export const GET_MARKET_DATA_KR_DESCRIPTION = `Retrieves a market-data + valuation snapshot for a Korean (KOSPI/KOSDAQ) listed company — the Korean equivalent of get_market_data, which does NOT resolve 6-digit tickers. Returns: latest close price with daily change, 52-week range and session OHLC; market cap (시가총액) and derived shares outstanding; valuation multiples PER/PBR/EPS/BPS plus forward 추정PER/추정EPS; dividend yield and dividend per share; analyst consensus (목표주가 priceTargetMean + mean recommendation, higher = more bullish) with implied upside; and a short same-industry peer list (ticker, price, market cap) for quick comparables.

Use this for current price, market cap, shares outstanding, PER/PBR/EV multiples, or 컨센서스/목표주가 on a Korean stock — including as the price + share-count source for a DCF on a 6-digit ticker. Accepts a 6-digit ticker (e.g. 005930 for Samsung Electronics). All amounts in KRW. Source: Naver Finance (keyless). Note: shares outstanding is DERIVED as market cap ÷ price, so it is approximate (typically within ~1-2% of the true float, since Naver's market cap is not an exact shares×close product); when per-share precision matters (e.g. DCF), prefer get_short_balance_kr's listedShares for the exact 상장주식수.`;

const InputSchema = z.object({
  ticker: z
    .string()
    .min(1)
    .describe('6-digit Korean stock ticker (e.g. 005930) OR the company name (e.g. 삼성전자) — a name is resolved to its listing automatically.'),
});

export interface MarketDataKr {
  ticker: string;
  name: string | null;
  quote: {
    date: string | null;
    price: number | null;
    change: number | null;
    changePct: number | null;
    direction: string | null;
    open: number | null;
    high: number | null;
    low: number | null;
    high52w: number | null;
    low52w: number | null;
    volume: number | null;
  };
  valuation: {
    marketCap: number | null;
    marketCapDisplay: string | null;
    sharesOutstanding: number | null;
    per: number | null;
    pbr: number | null;
    eps: number | null;
    bps: number | null;
    forwardPer: number | null;
    forwardEps: number | null;
    dividendYieldPct: number | null;
    dividendPerShare: number | null;
  };
  consensus: {
    date: string | null;
    targetPrice: number | null;
    recommendationMean: number | null;
    upsidePct: number | null;
  };
  peers: { ticker: string; name: string | null; price: number | null; changePct: number | null; marketCap: number | null }[];
}

/**
 * Parse Naver's 조/억-formatted market cap (e.g. "2,075조 4,289억") to a KRW
 * number. The subject company's marketValue is always rendered in 조/억; peers
 * use a plain 백만(million)-KRW number instead (handled separately). Returns
 * null if no 조/억/만 token is present, so a bare number is never misscaled.
 */
export function parseKoreanMarketCapToKRW(value: unknown): number | null {
  const s = String(value ?? '').replace(/,/g, '').trim();
  if (!s) return null;
  const jo = /(\d+(?:\.\d+)?)\s*조/.exec(s);
  const eok = /(\d+(?:\.\d+)?)\s*억/.exec(s);
  const man = /(\d+(?:\.\d+)?)\s*만/.exec(s);
  if (!jo && !eok && !man) return null;
  let krw = 0;
  if (jo) krw += parseFloat(jo[1]) * 1e12;
  if (eok) krw += parseFloat(eok[1]) * 1e8;
  if (man) krw += parseFloat(man[1]) * 1e4;
  return krw > 0 ? Math.round(krw) : null;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * A valid ticker's `/integration` always carries at least `stockName`; an empty
 * or garbage 200 payload yields nulls across the board. Use this to surface a
 * "not found" error instead of a snapshot of nulls. (Invalid codes return 409,
 * which `fetchNaverIntegration` already throws on — this is the 200 fallback.)
 */
export function hasNoMarketData(m: MarketDataKr): boolean {
  return m.name === null && m.quote.price === null && m.valuation.marketCap === null;
}

/**
 * Partial-drift canary. Naver has no API contract: a renamed `totalInfos` code maps
 * to null while sibling fields still populate, slipping past hasNoMarketData (which
 * only fires when name+price+marketCap are ALL null). We flag three drift shapes on
 * a valid payload (name present):
 *  - a CRITICAL field (현재가 or 시총) null — every tradable listing, equity OR fund,
 *    must carry these;
 *  - PBR and BPS BOTH null on an EQUITY (PER or EPS present) — book-value multiples
 *    are universal for equities, so both vanishing is drift. Funds/notes (ETN/ETF/
 *    REIT) and day-1 IPOs legitimately lack book value AND report no earnings, so the
 *    PER/EPS gate keeps them quiet (no false positive);
 *  - the daily close (dealTrendInfos[0].closePrice) renamed away while the stale 전일
 *    lastClosePrice fallback masks it — the worst case, since price stays non-null and
 *    the model would otherwise treat yesterday's close as today's with no signal.
 * PER/EPS/배당/추정치 are excluded as drift signals: legitimately null for loss-makers,
 * non-payers, and uncovered small caps, so they'd false-positive.
 */
export function marketDataQualityWarning(
  m: MarketDataKr,
  raw?: Record<string, unknown> | null,
): string | null {
  if (m.name === null) return null; // truly-empty payload is hasNoMarketData's job

  // ETF/ETN/fund schema check FIRST. Naver serves funds a different totalInfos shape
  // (nav/fundPay/etfBaseIdx, no marketValue/PER/PBR), so 시총·multiples are absent by
  // construction, not drift. get_market_data_kr is an equity tool; a fund legitimately
  // maps to price-only, so skip the equity canary rather than cry "schema drift".
  const ti = Array.isArray(raw?.totalInfos) ? (raw!.totalInfos as Record<string, unknown>[]) : [];
  const isFund = ti.some((x) => {
    const code = x && typeof x === 'object' ? (x as Record<string, unknown>).code : undefined;
    return code === 'nav' || code === 'etfBaseIdx' || code === 'fundPay';
  });
  if (isFund) return null;

  const v = m.valuation;
  const missing = nullFields({ price: m.quote.price, marketCap: v.marketCap });

  // Book-value pair is a drift signal ONLY for an earnings-reporting equity — funds
  // (ETN/ETF/REIT) and day-1 IPOs legitimately have neither earnings nor book value.
  const reportsEarnings = v.per !== null || v.eps !== null;
  if (reportsEarnings && v.pbr === null && v.bps === null) missing.push('pbr', 'bps');

  // Daily-close rename masked by the stale 전일 종가 fallback (price stays non-null).
  const deal = Array.isArray(raw?.dealTrendInfos) ? (raw!.dealTrendInfos as Record<string, unknown>[]) : [];
  if (deal.length > 0 && parseNaverMetric(deal[0].closePrice) === null && m.quote.price !== null) {
    missing.push('현재가(closePrice 미갱신 — 전일 종가로 대체)');
  }

  if (missing.length === 0) return null;
  return `핵심 시장데이터 필드 누락/이상: ${missing.join(', ')}. Naver 응답 구조 변경(필드 rename) 가능성이 있어, 이 종목 수치를 신뢰하기 전 확인이 필요합니다.`;
}

/** `totalInfos` is an array of `{ code, key, value }`; look up a value by code. */
function totalInfo(totalInfos: unknown, code: string): unknown {
  if (!Array.isArray(totalInfos)) return undefined;
  const hit = totalInfos.find(
    (it) => it && typeof it === 'object' && (it as Record<string, unknown>).code === code,
  );
  return hit ? (hit as Record<string, unknown>).value : undefined;
}

/** Map a raw Naver `/integration` payload to the friendly market-data shape. */
export function mapMarketData(ticker: string, raw: Record<string, unknown> | null): MarketDataKr {
  const ti = raw?.totalInfos;
  const deal = Array.isArray(raw?.dealTrendInfos)
    ? (raw!.dealTrendInfos as Record<string, unknown>[])
    : [];
  const latest = deal[0] ?? {};
  const cons = (raw?.consensusInfo ?? null) as Record<string, unknown> | null;
  const compare = Array.isArray(raw?.industryCompareInfo)
    ? (raw!.industryCompareInfo as Record<string, unknown>[])
    : [];

  const price = parseNaverMetric(latest.closePrice) ?? parseNaverMetric(totalInfo(ti, 'lastClosePrice'));
  const change = parseNaverMetric(latest.compareToPreviousClosePrice);
  const prevClose = price !== null && change !== null ? price - change : null;
  const changePct =
    prevClose !== null && prevClose !== 0 && change !== null ? round2((change / prevClose) * 100) : null;
  const dir = latest.compareToPreviousPrice;
  const direction =
    dir && typeof dir === 'object' ? ((dir as Record<string, unknown>).text as string) ?? null : null;

  const marketCapRaw = totalInfo(ti, 'marketValue');
  const marketCap = parseKoreanMarketCapToKRW(marketCapRaw);
  const sharesOutstanding = marketCap !== null && price ? Math.round(marketCap / price) : null;

  const targetPrice = parseNaverMetric(cons?.priceTargetMean);
  const recommendationMean = parseNaverMetric(cons?.recommMean);
  const upsidePct =
    targetPrice !== null && price ? round2(((targetPrice - price) / price) * 100) : null;

  return {
    ticker,
    name: (raw?.stockName as string) ?? null,
    quote: {
      date: latest.bizdate ? toIsoDate(latest.bizdate) : null,
      price,
      change,
      changePct,
      direction,
      open: parseNaverMetric(totalInfo(ti, 'openPrice')),
      high: parseNaverMetric(totalInfo(ti, 'highPrice')),
      low: parseNaverMetric(totalInfo(ti, 'lowPrice')),
      high52w: parseNaverMetric(totalInfo(ti, 'highPriceOf52Weeks')),
      low52w: parseNaverMetric(totalInfo(ti, 'lowPriceOf52Weeks')),
      volume:
        parseNaverMetric(latest.accumulatedTradingVolume) ??
        parseNaverMetric(totalInfo(ti, 'accumulatedTradingVolume')),
    },
    valuation: {
      marketCap,
      marketCapDisplay: marketCapRaw === undefined || marketCapRaw === null ? null : String(marketCapRaw),
      sharesOutstanding,
      per: parseNaverMetric(totalInfo(ti, 'per')),
      pbr: parseNaverMetric(totalInfo(ti, 'pbr')),
      eps: parseNaverMetric(totalInfo(ti, 'eps')),
      bps: parseNaverMetric(totalInfo(ti, 'bps')),
      forwardPer: parseNaverMetric(totalInfo(ti, 'cnsPer')),
      forwardEps: parseNaverMetric(totalInfo(ti, 'cnsEps')),
      dividendYieldPct: parseNaverMetric(totalInfo(ti, 'dividendYieldRatio')),
      dividendPerShare: parseNaverMetric(totalInfo(ti, 'dividend')),
    },
    consensus: {
      date: cons?.createDate ? toIsoDate(cons.createDate) : null,
      targetPrice,
      recommendationMean,
      upsidePct,
    },
    peers: compare.slice(0, 6).map((p) => {
      // Peer marketValue is a plain 백만(million)-KRW number, not a 조/억 string.
      const mv = parseNaverMetric(p.marketValue);
      return {
        ticker: String(p.itemCode ?? ''),
        name: (p.stockName as string) ?? null,
        price: parseNaverMetric(p.closePrice),
        changePct: parseNaverMetric(p.fluctuationsRatio),
        marketCap: mv !== null ? mv * 1e6 : null,
      };
    }),
  };
}

export const getMarketDataKr = new DynamicStructuredTool({
  name: 'get_market_data_kr',
  description: GET_MARKET_DATA_KR_DESCRIPTION,
  schema: InputSchema,
  func: async (input) => {
    const resolved = await resolveKrSecurity(input.ticker);
    if (!resolved) {
      return formatToolResult(
        { ticker: input.ticker, _error: `Could not resolve "${input.ticker}" to a Korean listing — pass a 6-digit ticker or an exact company name` },
        [],
      );
    }
    const ticker = resolved.stockCode;
    try {
      const { data, url } = await fetchNaverIntegration(ticker, { cacheable: true, ttlMs: TTL_1H });
      const mapped = data ? mapMarketData(ticker, data) : null;
      if (!mapped || hasNoMarketData(mapped)) {
        return formatToolResult(
          { ticker, _error: `No market data found for ${ticker} — check the 6-digit ticker` },
          [url],
        );
      }
      const warning = marketDataQualityWarning(mapped, data);
      return formatToolResult(warning ? { ...mapped, _dataQualityWarning: warning } : mapped, [url]);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return formatToolResult({ ticker, _error: message }, []);
    }
  },
});
