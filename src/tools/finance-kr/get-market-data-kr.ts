import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { fetchNaverIntegration, fetchNaverBasic, isNaverNoDataError } from './naver-api.js';
import { resolveKrSecurity } from './resolve-kr.js';
import { parseNaverMetric, toIsoDate, nullFields, round2 } from './utils.js';
import { formatToolResult } from '../types.js';
import { TTL_1H } from '../finance/utils.js';

export const GET_MARKET_DATA_KR_DESCRIPTION = `Retrieves a market-data + valuation snapshot for a Korean (KOSPI/KOSDAQ) listed company — the Korean equivalent of get_market_data, which does NOT resolve 6-digit tickers. Returns: LIVE price with daily change plus quote timestamp (quote.asOf), market open/closed state (quote.marketStatus) and trading-halt state (quote.tradingStatus); 52-week range and session OHLC; market cap (시가총액) and derived shares outstanding; valuation multiples PER/PBR/EPS/BPS plus forward 추정PER/추정EPS; dividend yield and dividend per share; analyst consensus (목표주가 priceTargetMean + mean recommendation, higher = more bullish) with implied upside; listed preferred-share classes of the same issuer (preferredListings — 우선주 ticker/name/price/marketCap; empty when none); and a short same-industry peer list (ticker, price, market cap) for quick comparables.

Use this for current price, market cap, shares outstanding, PER/PBR/EV multiples, or 컨센서스/목표주가 on a Korean stock — including as the price + share-count source for a DCF on a 6-digit ticker. Accepts a 6-digit ticker (e.g. 005930 for Samsung Electronics). All amounts in KRW. Source: Naver Finance (keyless). Notes: (1) shares outstanding is DERIVED as market cap ÷ close from the SAME valuation snapshot, for THIS listing only (common shares when called on the common ticker — preferred classes are separate listings, see preferredListings), and is approximate (~1-2%); when per-share precision matters (e.g. DCF), prefer get_short_balance_kr's listedShares for the exact 상장주식수. (2) quote.priceSource tells you what "price" is: 'live' (real-time, timestamp in quote.asOf) or 'snapshotClose' (live fetch unavailable — a possibly-lagging close; do NOT present as the current price without that caveat); if quote.tradingStatus is not TRADING the price is a last trade before a halt. (3) valuation figures (marketCap, multiples, OHLC, peers) are as of valuation.snapshotAsOf (up to 1h cached), not quote.asOf. (4) valuation.basis carries each multiple's 기준시점 (e.g. PER/EPS '2026.03.' = TTM through that quarter, dividend '2025.12.' = that fiscal year's DPS) — cite it when quoting the metric; these are NOT same-day figures. (5) preferredListings covers NUMERIC-code preferred classes only (끝자리 5/7/9 규칙): alphanumeric 신형우선주 codes (e.g. 00104K CJ4우(전환)) are NOT detectable here, so an empty array means "no numeric-code preferred found", not a guarantee the issuer has no preferred stock — heed any probe-failure warning before treating it as absent.`;

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
    /**
     * Latest COMPLETED session date from the daily series — lags intraday (the
     * live quote's timestamp is asOf). OHLC/volume come from the /integration
     * snapshot's session when a live quote is present (see valuation.snapshotAsOf
     * for that snapshot's time), and from this completed session otherwise.
     */
    date: string | null;
    price: number | null;
    change: number | null;
    changePct: number | null;
    direction: string | null;
    /**
     * Where `price` came from: 'live' = the /basic real-time quote; 'snapshotClose' =
     * the /integration payload's close (live fetch failed or unparseable — may lag a
     * session); null = no price at all. Staleness handling MUST key off this field.
     */
    priceSource: 'live' | 'snapshotClose' | null;
    /** Quote timestamp of `price` (ISO) — set only when priceSource is 'live' and /basic supplied localTradedAt. */
    asOf: string | null;
    /** OPEN / CLOSE — whether the market session is live for this quote. */
    marketStatus: string | null;
    /** TRADING when the stock trades normally; any other value (halt/suspension) means `price` is a last trade, not a live market price. */
    tradingStatus: string | null;
    open: number | null;
    high: number | null;
    low: number | null;
    high52w: number | null;
    low52w: number | null;
    volume: number | null;
  };
  valuation: {
    /**
     * When the /integration snapshot behind marketCap/OHLC/multiples/peers was
     * obtained (ISO; cache write time when served from the 1h cache). These fields
     * are as of THIS moment, not quote.asOf — cite it when the distinction matters.
     */
    snapshotAsOf: string | null;
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
    /**
     * 기준시점 of each multiple, straight from Naver's valueDesc (e.g. PER/EPS
     * '2026.03.' = TTM through that quarter; dividend '2025.12.' = that fiscal
     * year's DPS). Without this the metrics read as "current" indefinitely.
     * Keys present only when Naver supplied a valueDesc.
     */
    basis: Record<string, string>;
  };
  consensus: {
    date: string | null;
    targetPrice: number | null;
    recommendationMean: number | null;
    upsidePct: number | null;
  };
  peers: { ticker: string; name: string | null; price: number | null; changePct: number | null; marketCap: number | null }[];
  /**
   * Listed preferred-share classes of the same issuer (우선주 — separate listings,
   * e.g. 005935 삼성전자우 alongside 005930). Their market cap is NOT in this
   * listing's marketCap/sharesOutstanding: an equity-value-per-share calc must
   * subtract the preferred classes' market cap before dividing by common shares.
   * Empty array = no numeric-code preferred listing found.
   */
  preferredListings: { ticker: string; name: string | null; price: number | null; marketCap: number | null }[];
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
  opts?: { hasLiveQuote?: boolean },
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
  // Irrelevant when the live /basic quote supplied the price — the daily row isn't
  // the price source then, so its absence is not a masked staleness.
  const deal = Array.isArray(raw?.dealTrendInfos) ? (raw!.dealTrendInfos as Record<string, unknown>[]) : [];
  if (!opts?.hasLiveQuote && deal.length > 0 && parseNaverMetric(deal[0].closePrice) === null && m.quote.price !== null) {
    missing.push('현재가(closePrice 미갱신 — 전일 종가로 대체)');
  }

  if (missing.length === 0) return null;
  return `핵심 시장데이터 필드 누락/이상: ${missing.join(', ')}. Naver 응답 구조 변경(필드 rename) 가능성이 있어, 이 종목 수치를 신뢰하기 전 확인이 필요합니다.`;
}

/** `totalInfos` is an array of `{ code, key, value, valueDesc? }`; look up a value by code. */
function totalInfo(totalInfos: unknown, code: string): unknown {
  if (!Array.isArray(totalInfos)) return undefined;
  const hit = totalInfos.find(
    (it) => it && typeof it === 'object' && (it as Record<string, unknown>).code === code,
  );
  return hit ? (hit as Record<string, unknown>).value : undefined;
}

/**
 * Collect each metric's 기준시점 (valueDesc, e.g. '2026.03.') so a TTM multiple
 * or last-FY dividend is never presented as an undated "current" figure.
 */
function collectBasis(totalInfos: unknown, codes: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  if (!Array.isArray(totalInfos)) return out;
  for (const it of totalInfos) {
    if (!it || typeof it !== 'object') continue;
    const rec = it as Record<string, unknown>;
    const name = codes[String(rec.code)];
    if (name && typeof rec.valueDesc === 'string' && rec.valueDesc.trim()) {
      out[name] = rec.valueDesc.trim();
    }
  }
  return out;
}

/**
 * Naver's change fields can come back unsigned with the sign carried in the
 * direction object instead (code 4=하한, 5=하락). Force the sign from the
 * direction code so a falling day never shows a positive change.
 */
function signedByDirection(value: number | null, dir: unknown): number | null {
  if (value === null) return null;
  const code = dir && typeof dir === 'object' ? String((dir as Record<string, unknown>).code ?? '') : '';
  return code === '4' || code === '5' ? -Math.abs(value) : value;
}

/**
 * Map raw Naver payloads to the friendly market-data shape.
 *
 * `raw` (/integration) carries valuation·consensus·peers plus DAILY rows that lag
 * intraday — its latest closePrice is yesterday's close until the session ends.
 * `basic` (/basic) is the LIVE quote (closePrice, localTradedAt, marketStatus,
 * tradeStopType); when present it supplies price/change/asOf so an intraday call
 * never reports yesterday's close as the current price. Derived shares pair
 * marketCap with the SAME /integration snapshot's close (never the live price —
 * the snapshot may be up to 1h cached and the intraday move would corrupt the
 * share count).
 */
export function mapMarketData(
  ticker: string,
  raw: Record<string, unknown> | null,
  basic?: Record<string, unknown> | null,
): MarketDataKr {
  const ti = raw?.totalInfos;
  const deal = Array.isArray(raw?.dealTrendInfos)
    ? (raw!.dealTrendInfos as Record<string, unknown>[])
    : [];
  const latest = deal[0] ?? {};
  const cons = (raw?.consensusInfo ?? null) as Record<string, unknown> | null;
  const compare = Array.isArray(raw?.industryCompareInfo)
    ? (raw!.industryCompareInfo as Record<string, unknown>[])
    : [];

  const integPrice =
    parseNaverMetric(latest.closePrice) ?? parseNaverMetric(totalInfo(ti, 'lastClosePrice'));
  const livePrice = parseNaverMetric(basic?.closePrice);
  const price = livePrice ?? integPrice;
  // Staleness signals key off THIS, never off asOf: /basic can return a timestamp
  // with an unparseable closePrice (halt placeholder, field rename) — keying off the
  // timestamp would then ship a stale price labeled as live with warnings suppressed.
  const priceSource: 'live' | 'snapshotClose' | null =
    livePrice !== null ? 'live' : integPrice !== null ? 'snapshotClose' : null;

  const liveDir = basic?.compareToPreviousPrice;
  const integDir = latest.compareToPreviousPrice;
  const dir = livePrice !== null ? liveDir : integDir;
  const change =
    livePrice !== null
      ? signedByDirection(parseNaverMetric(basic?.compareToPreviousClosePrice), liveDir)
      : signedByDirection(parseNaverMetric(latest.compareToPreviousClosePrice), integDir);
  const liveChangePct = livePrice !== null ? signedByDirection(parseNaverMetric(basic?.fluctuationsRatio), liveDir) : null;
  const prevClose = price !== null && change !== null ? price - change : null;
  const changePct =
    liveChangePct ??
    (prevClose !== null && prevClose !== 0 && change !== null ? round2((change / prevClose) * 100) : null);
  const direction =
    dir && typeof dir === 'object' ? ((dir as Record<string, unknown>).text as string) ?? null : null;
  const tradeStop = basic?.tradeStopType;
  const tradingStatus =
    tradeStop && typeof tradeStop === 'object'
      ? ((tradeStop as Record<string, unknown>).name as string) ?? null
      : null;

  const marketCapRaw = totalInfo(ti, 'marketValue');
  const marketCap = parseKoreanMarketCapToKRW(marketCapRaw);
  // Derive shares from the SAME /integration snapshot pair (marketCap ÷ its own
  // close): mixing the possibly-cached marketCap with the live /basic price would
  // put the intraday move into the share count (~% error on a volatile day).
  const sharesOutstanding =
    marketCap !== null && (integPrice ?? livePrice) ? Math.round(marketCap / (integPrice ?? livePrice)!) : null;

  const targetPrice = parseNaverMetric(cons?.priceTargetMean);
  const recommendationMean = parseNaverMetric(cons?.recommMean);
  const upsidePct =
    targetPrice !== null && price ? round2(((targetPrice - price) / price) * 100) : null;

  return {
    ticker,
    name: ((raw?.stockName ?? basic?.stockName) as string) ?? null,
    quote: {
      date: latest.bizdate ? toIsoDate(latest.bizdate) : null,
      price,
      change,
      changePct,
      direction,
      priceSource,
      // asOf describes `price` — only meaningful when the price actually came from
      // the live quote (a /basic timestamp alongside a fallback price would label
      // yesterday's close with today's time).
      asOf:
        priceSource === 'live' && typeof basic?.localTradedAt === 'string' ? basic.localTradedAt : null,
      marketStatus: typeof basic?.marketStatus === 'string' ? basic.marketStatus : null,
      tradingStatus,
      open: parseNaverMetric(totalInfo(ti, 'openPrice')),
      high: parseNaverMetric(totalInfo(ti, 'highPrice')),
      low: parseNaverMetric(totalInfo(ti, 'lowPrice')),
      high52w: parseNaverMetric(totalInfo(ti, 'highPriceOf52Weeks')),
      low52w: parseNaverMetric(totalInfo(ti, 'lowPriceOf52Weeks')),
      // With a live quote, keep volume on the same /integration snapshot as the
      // OHLC above (totalInfos) so open/high/low/volume describe ONE session —
      // that session is the snapshot's (see valuation.snapshotAsOf), which lags
      // when served from cache. Without a live quote, the daily row (quote.date's
      // completed session) is the consistent pair.
      volume:
        livePrice !== null
          ? parseNaverMetric(totalInfo(ti, 'accumulatedTradingVolume')) ??
            parseNaverMetric(latest.accumulatedTradingVolume)
          : parseNaverMetric(latest.accumulatedTradingVolume) ??
            parseNaverMetric(totalInfo(ti, 'accumulatedTradingVolume')),
    },
    valuation: {
      snapshotAsOf: null, // stamped by the caller from the /integration fetch metadata
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
      basis: collectBasis(ti, {
        per: 'per',
        eps: 'eps',
        pbr: 'pbr',
        bps: 'bps',
        cnsPer: 'forwardPer',
        cnsEps: 'forwardEps',
        dividendYieldRatio: 'dividendYieldPct',
        dividend: 'dividendPerShare',
      }),
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
    preferredListings: [],
  };
}

/**
 * KRX share-class code convention: the common stock (보통주) ends in 0 and the
 * preferred classes reuse the same 5-digit base with last digit 5 (구형 1우선주),
 * 7 (2우선주B), 9 (3우선주B) — e.g. 005930 삼성전자 → 005935 삼성전자우; 005380
 * 현대차 → 005385/005387/005389. Alphanumeric new-preferred codes (e.g. 00104K
 * CJ4우(전환)) are outside the 6-digit numeric ticker system and are not probed.
 */
export function preferredCandidateCodes(ticker: string): string[] {
  if (!/^\d{6}$/.test(ticker) || !ticker.endsWith('0')) return [];
  const base = ticker.slice(0, 5);
  return [`${base}5`, `${base}7`, `${base}9`];
}

/**
 * True when `candidateName` is a preferred-share listing of `commonName`:
 * the common name plus a 우선주 class suffix — 우 / 우B / 2우B / 3우B / 우(전환).
 * A code-convention hit that belongs to a DIFFERENT issuer fails this check,
 * so a wrong company's data can never be attributed as someone's 우선주.
 */
export function isPreferredNameOf(commonName: string, candidateName: string): boolean {
  const common = commonName.replace(/\s+/g, '');
  const cand = candidateName.replace(/\s+/g, '');
  if (!common || !cand.startsWith(common)) return false;
  const suffix = cand.slice(common.length);
  return /^\d?우[A-C]?(\(전환\))?$/.test(suffix);
}

/**
 * Probe the issuer's preferred-share listings via the code convention above.
 *
 * Negative caching is DEFINITIVE-ONLY: a code is remembered as a miss for the
 * process lifetime only when Naver said the code does not exist (409/404) or the
 * code resolved to a different issuer's listing. Transient failures (network,
 * 5xx, empty payload) are NOT latched — they are returned in `failedProbes` so
 * the caller can warn that the list may be incomplete, instead of a one-off
 * hiccup silently reading as "이 회사는 우선주 없음" for the rest of the session.
 */
const preferredProbeMisses = new Set<string>();

async function probePreferredListings(
  ticker: string,
  commonName: string | null,
): Promise<{ listings: MarketDataKr['preferredListings']; failedProbes: string[] }> {
  if (!commonName) return { listings: [], failedProbes: [] };
  const candidates = preferredCandidateCodes(ticker).filter((c) => !preferredProbeMisses.has(c));
  if (candidates.length === 0) return { listings: [], failedProbes: [] };
  const found: MarketDataKr['preferredListings'] = [];
  const failedProbes: string[] = [];
  await Promise.all(
    candidates.map(async (code) => {
      try {
        const { data } = await fetchNaverIntegration(code, { cacheable: true, ttlMs: TTL_1H });
        const name = (data?.stockName as string) ?? null;
        if (!name) {
          // Empty 200 payload — ambiguous, could be transient. Don't latch.
          failedProbes.push(code);
          return;
        }
        if (!isPreferredNameOf(commonName, name)) {
          // Definitive: the code exists but belongs to another issuer / isn't preferred.
          preferredProbeMisses.add(code);
          return;
        }
        const sub = mapMarketData(code, data);
        found.push({ ticker: code, name, price: sub.quote.price, marketCap: sub.valuation.marketCap });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (isNaverNoDataError(message)) {
          preferredProbeMisses.add(code); // definitive 409/404: no such code
        } else {
          failedProbes.push(code); // transient: retry next call, warn this call
        }
      }
    }),
  );
  return { listings: found.sort((a, b) => a.ticker.localeCompare(b.ticker)), failedProbes };
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
      // /integration (valuation·consensus·peers — cacheable, slow-moving) + /basic
      // (live quote — never cached; intraday, /integration's daily rows still show
      // yesterday's close, so without /basic the tool mixes yesterday's price with
      // today's OHLC/시총).
      const [integ, basic] = await Promise.all([
        fetchNaverIntegration(ticker, { cacheable: true, ttlMs: TTL_1H }),
        fetchNaverBasic(ticker),
      ]);
      const { data, url } = integ;
      const mapped = data ? mapMarketData(ticker, data, basic.data) : null;
      if (!mapped || hasNoMarketData(mapped)) {
        return formatToolResult(
          { ticker, _error: `No market data found for ${ticker} — check the 6-digit ticker` },
          [url],
        );
      }
      mapped.valuation.snapshotAsOf = integ.fetchedAt;
      const probe = await probePreferredListings(ticker, mapped.name);
      mapped.preferredListings = probe.listings;

      const warnings: string[] = [];
      const drift = marketDataQualityWarning(mapped, data, {
        hasLiveQuote: mapped.quote.priceSource === 'live',
      });
      if (drift) warnings.push(drift);
      if (mapped.quote.tradingStatus !== null && mapped.quote.tradingStatus !== 'TRADING') {
        warnings.push(
          `거래상태 ${mapped.quote.tradingStatus} — 매매정지/규제 상태입니다. price는 정지 전 마지막 체결가이지 살아있는 시세가 아니며, 밸류에이션·현재가 분석에 그대로 쓰면 안 됩니다.`,
        );
      }
      if (mapped.quote.priceSource === 'snapshotClose') {
        warnings.push(
          '실시간 시세(/basic) 사용 불가 — price는 밸류에이션 스냅샷의 종가(valuation.snapshotAsOf 시점) 기준이라 장중 변동이 반영되지 않았을 수 있습니다. 시각 표기 없이 "현재가"로 서술하지 마세요.',
        );
      }
      if (probe.failedProbes.length > 0) {
        warnings.push(
          `우선주 프로브 일시 실패(${probe.failedProbes.join(', ')}) — preferredListings가 불완전할 수 있으므로 이번 응답의 빈/부분 목록을 "우선주 없음"으로 단정하지 마세요.`,
        );
      }
      return formatToolResult(
        warnings.length > 0 ? { ...mapped, _dataQualityWarning: warnings.join(' ') } : mapped,
        [url, basic.url],
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return formatToolResult({ ticker, _error: message }, []);
    }
  },
});
