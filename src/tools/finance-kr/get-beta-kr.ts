import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { formatToolResult } from '../types.js';
import { resolveKrSecurity } from './resolve-kr.js';
import { fetchNaverAutocomplete } from './naver-api.js';
import { fetchNaverPriceHistory, type NaverIndexCode } from '../../data/fetchers/naver-price-history.js';
import { computeBetaKr, type BetaFrequency } from '../../data/compute-beta-kr.js';
import { TTL_1H } from '../finance/utils.js';

export const GET_BETA_KR_DESCRIPTION = `Computes an equity beta (β) for a Korean (KOSPI/KOSDAQ) listing by regressing the stock's historical returns on its home index — the authoritative, sourced replacement for a web_search-inferred or sector-proxy beta in a DCF cost of equity (Ke = Rf + β × ERP).

Method (defaults): 2-year WEEKLY returns, regressed on KOSPI for KOSPI-listed names / KOSDAQ for KOSDAQ-listed names (auto-detected, keyless via Naver). Returns rawBeta and Blume-adjusted beta (0.67·raw + 0.33, the WACC input), plus R², observation count, and the regression window — so the number is auditable. Prices from Naver Finance (keyless).

Use this for the β in a Korean DCF/WACC instead of guessing or web_search. Accepts a 6-digit ticker (e.g. 005930) or a company name (삼성전자). Note the quality fields: if observations are few (newly listed) or R² is very low (idiosyncratic small cap), treat the figure with care and consider a sector proxy — the tool reports this rather than hiding it.`;

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
    .describe('Lookback length in years for the regression window (default 2).'),
  frequency: z
    .enum(['daily', 'weekly', 'monthly'])
    .default('weekly')
    .describe('Return sampling frequency (default weekly — the standard for beta).'),
  index: z
    .enum(['auto', 'KOSPI', 'KOSDAQ'])
    .default('auto')
    .describe('Benchmark index. Default auto = match the listing market.'),
});

/** Minimum aligned returns for the regression to be considered reliable, by frequency. */
const MIN_RELIABLE_OBS: Record<BetaFrequency, number> = { daily: 200, weekly: 52, monthly: 24 };

function marketToIndex(market: string | null): NaverIndexCode {
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

      const minObs = MIN_RELIABLE_OBS[input.frequency];
      const reliable = beta.observations >= minObs && beta.rSquared >= 0.05;
      const notes: string[] = [];
      if (beta.observations < minObs)
        notes.push(
          `관측치 ${beta.observations}개 < 권장 ${minObs}개(${input.years}년 ${input.frequency}) — 상장 이력이 짧아 β 신뢰도가 낮다. 섹터 대용치 병행 검토.`,
        );
      if (beta.rSquared < 0.05)
        notes.push(
          `R²=${beta.rSquared} 로 매우 낮음 — 지수와의 설명력이 약한 개별주(idiosyncratic). β를 그대로 쓰기보다 섹터 대용치와 교차확인.`,
        );

      return formatToolResult(
        {
          ticker,
          name: resolved.name,
          index: indexCode,
          market: market ?? null,
          rawBeta: beta.rawBeta,
          adjustedBeta: beta.adjustedBeta,
          rSquared: beta.rSquared,
          observations: beta.observations,
          frequency: beta.frequency,
          window: { years: input.years, startDate: beta.startDate, asOf: beta.asOf },
          reliable,
          method: `${input.years}y ${input.frequency} returns regressed on ${indexCode}, Blume-adjusted (0.67·raw + 0.33)`,
          source: 'Naver Finance 차트(일별 시세) — keyless',
          ...(notes.length ? { _dataQualityWarning: notes.join(' ') } : {}),
        },
        [stock.url, idx.url],
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return formatToolResult({ ticker, _error: message });
    }
  },
});
