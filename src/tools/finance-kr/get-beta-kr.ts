import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { formatToolResult } from '../types.js';
import { resolveKrSecurity } from './resolve-kr.js';
import { fetchNaverAutocomplete } from './naver-api.js';
import { fetchNaverPriceHistory, type NaverIndexCode } from '../../data/fetchers/naver-price-history.js';
import { computeBetaKr } from '../../data/compute-beta-kr.js';
import { TTL_1H } from '../finance/utils.js';

export const GET_BETA_KR_DESCRIPTION = `Computes an equity beta (β) for a Korean (KOSPI/KOSDAQ) listing by regressing the stock's historical returns on its home index — the authoritative, sourced replacement for a web_search-inferred or sector-proxy beta in a DCF cost of equity (Ke = Rf + β × ERP).

Method (defaults): 2-year WEEKLY returns regressed on KOSPI/KOSDAQ (the listing market, auto-detected, keyless via Naver), Blume-adjusted (0.67·raw + 0.33) — the Bloomberg-standard convention; override with the years/frequency/index params. Returns rawBeta and adjustedBeta (the WACC input) plus the FACTS needed to judge it yourself: R², observation count, and the regression window (requested vs actually-covered). Prices from Naver Finance (keyless).

Use this for the β in a Korean DCF/WACC instead of guessing or web_search. Accepts a 6-digit ticker (e.g. 005930) or a company name (삼성전자). This tool does NOT bake in a reliability verdict — it reports R²/observations/window and leaves interpretation to you: a low R² (weak index fit — defensive/idiosyncratic names) or a window shorter than requested (newly listed) is a cue to disclose that and cross-check a sector proxy.`;

const InputSchema = z.object({
  ticker: z
    .string()
    .min(1)
    .describe('6-digit Korean ticker (e.g. 005930) or company name (e.g. 삼성전자).'),
  years: z
    .number()
    .min(1)
    .max(5)
    .default(2)
    .describe('Lookback length in years for the regression window (default 2 — Bloomberg-standard window).'),
  frequency: z
    .enum(['daily', 'weekly', 'monthly'])
    .default('weekly')
    .describe('Return sampling frequency (default weekly — the Bloomberg-standard convention for beta).'),
  index: z
    .enum(['auto', 'KOSPI', 'KOSDAQ'])
    .default('auto')
    .describe('Benchmark index. Default auto = match the listing market.'),
});

/** ISO YYYY-MM-DD for a Date (the requested window start, for coverage disclosure). */
function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function marketToIndex(market: string | null): NaverIndexCode {
  return market && market.toUpperCase().includes('KOSDAQ') ? 'KOSDAQ' : 'KOSPI';
}

export const getBetaKr = new DynamicStructuredTool({
  name: 'get_beta_kr',
  description: GET_BETA_KR_DESCRIPTION,
  schema: InputSchema,
  func: async (input) => {
    const resolved = await resolveKrSecurity(input.ticker);
    if (!resolved) {
      return formatToolResult({
        ticker: input.ticker,
        _error: `Could not resolve "${input.ticker}" to a Korean listing — pass a 6-digit ticker or an exact company name`,
      });
    }
    const ticker = resolved.stockCode;

    // Pick the benchmark. Auto = match the listing market; resolve it keylessly via
    // Naver autocomplete when the resolver didn't already carry it (6-digit passthrough).
    let market = resolved.market;
    if (input.index === 'auto' && !market) {
      const hit = await fetchNaverAutocomplete(ticker);
      market = hit?.market ?? null;
    }
    const indexCode: NaverIndexCode = input.index === 'auto' ? marketToIndex(market) : input.index;
    // Auto mode with an unresolved market silently defaults to KOSPI — that is a
    // FALLBACK, not a detection, and must be visible (a KOSDAQ name regressed on
    // KOSPI is a different beta with no outward sign otherwise).
    const indexFallback = input.index === 'auto' && !market;

    // Window: years back from today, padded so the first weekly bucket is complete.
    const end = new Date();
    const start = new Date(end.getTime() - (input.years * 366 + 10) * 24 * 60 * 60 * 1000);

    try {
      const [stock, idx] = await Promise.all([
        fetchNaverPriceHistory('item', ticker, start, end, { cacheable: true, ttlMs: TTL_1H }),
        fetchNaverPriceHistory('index', indexCode, start, end, { cacheable: true, ttlMs: TTL_1H }),
      ]);

      if (stock.bars.length === 0) {
        return formatToolResult(
          { ticker, _error: `No price history for ${ticker} — check the 6-digit ticker` },
          [stock.url],
        );
      }

      const beta = computeBetaKr(stock.bars, idx.bars, input.frequency);
      if (!beta) {
        return formatToolResult(
          { ticker, _error: `Too few overlapping returns to estimate beta for ${ticker}` },
          [stock.url, idx.url],
        );
      }

      // No baked reliability verdict: report the regression FACTS (R², observations,
      // requested-vs-covered window) and let the caller judge. A low R² or a covered
      // window shorter than requested is visible here, interpreted in the DCF skill.
      // Data-quality flags (small sample, benchmark fallback) are stated as facts —
      // a 10-observation regression can print R²≈1 and look MORE reliable, so the
      // sample-size caveat cannot be left to the reader.
      const MIN_OBS: Record<typeof input.frequency, number> = { daily: 60, weekly: 24, monthly: 12 };
      const warnings: string[] = [];
      if (beta.observations < MIN_OBS[input.frequency]) {
        warnings.push(
          `관측치 n=${beta.observations} (${input.frequency} 기준 권장 최소 ${MIN_OBS[input.frequency]} 미만) — 소표본 회귀는 R²가 과대(≈1)될 수 있어 이 β를 단독으로 신뢰하지 말고 섹터 대용치와 교차하십시오.`,
        );
      }
      if (indexFallback) {
        warnings.push(
          '상장시장(KOSPI/KOSDAQ) 자동 판별 실패로 KOSPI에 회귀했습니다(폴백). KOSDAQ 종목이면 index: "KOSDAQ"로 재호출하십시오.',
        );
      }
      if (beta.excludedZeroVolumeBars > 0) {
        warnings.push(
          `거래정지(거래량 0) ${beta.excludedZeroVolumeBars}일을 회귀에서 제외했습니다 — 정지 이력이 긴 종목은 측정창 대표성이 떨어질 수 있습니다.`,
        );
      }
      return formatToolResult(
        {
          ticker,
          name: resolved.name,
          index: indexCode,
          indexFallback,
          market: market ?? null,
          rawBeta: beta.rawBeta,
          adjustedBeta: beta.adjustedBeta,
          rSquared: beta.rSquared,
          observations: beta.observations,
          excludedZeroVolumeBars: beta.excludedZeroVolumeBars,
          frequency: beta.frequency,
          window: {
            years: input.years,
            requestedFrom: isoDate(start),
            coveredFrom: beta.startDate,
            asOf: beta.asOf,
          },
          method: `${input.years}y ${input.frequency} returns regressed on ${indexCode}, Blume-adjusted (0.67·raw + 0.33; Bloomberg-standard default)`,
          source: 'Naver Finance 차트(일별 시세) — keyless',
          ...(warnings.length > 0 ? { _dataQualityWarning: warnings.join(' ') } : {}),
        },
        [stock.url, idx.url],
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return formatToolResult({ ticker, _error: message });
    }
  },
});
