import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { fetchNaverIntegration } from './naver-api.js';
import { parseNaverMetric, toIsoDate } from './utils.js';
import { formatToolResult } from '../types.js';
import { TTL_1H } from '../finance/utils.js';

export const GET_MARKET_DATA_KR_DESCRIPTION = `Retrieves a market-data + valuation snapshot for a Korean (KOSPI/KOSDAQ) listed company — the Korean equivalent of get_market_data, which does NOT resolve 6-digit tickers. Returns: latest close price with daily change, 52-week range and session OHLC; market cap (시가총액) and derived shares outstanding; valuation multiples PER/PBR/EPS/BPS plus forward 추정PER/추정EPS; dividend yield and dividend per share; analyst consensus (목표주가 priceTargetMean + mean recommendation, higher = more bullish) with implied upside; and a short same-industry peer list (ticker, price, market cap) for quick comparables.

Use this for current price, market cap, shares outstanding, PER/PBR/EV multiples, or 컨센서스/목표주가 on a Korean stock — including as the price + share-count source for a DCF on a 6-digit ticker. Accepts a 6-digit ticker (e.g. 005930 for Samsung Electronics). All amounts in KRW. Source: Naver Finance (keyless). Note: shares outstanding is DERIVED as market cap ÷ price, so it is approximate (typically within ~1-2% of the true float, since Naver's market cap is not an exact shares×close product); when per-share precision matters (e.g. DCF), prefer get_short_balance_kr's listedShares for the exact 상장주식수.`;

const InputSchema = z.object({
  ticker: z
    .string()
    .regex(/^\d{6}$/, 'Korean ticker must be a 6-digit string (e.g. 005930 for Samsung).')
    .describe('6-digit Korean stock ticker (e.g. 005930 for Samsung Electronics).'),
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

  const marketCap = parseKoreanMarketCapToKRW(totalInfo(ti, 'marketValue'));
  const marketCapRaw = totalInfo(ti, 'marketValue');
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
    const ticker = input.ticker.trim();
    try {
      const { data, url } = await fetchNaverIntegration(ticker, { cacheable: true, ttlMs: TTL_1H });
      if (!data) {
        return formatToolResult({ ticker, _error: `No market data found for ${ticker}` }, [url]);
      }
      return formatToolResult(mapMarketData(ticker, data), [url]);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return formatToolResult({ ticker, _error: message }, []);
    }
  },
});
