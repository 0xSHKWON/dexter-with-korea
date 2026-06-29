import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { formatToolResult } from '../types.js';
import { ECOS_SERIES, fetchEcosSeries, type EcosSeriesKey } from '../../data/fetchers/ecos.js';

const SERIES_KEYS = Object.keys(ECOS_SERIES) as [EcosSeriesKey, ...EcosSeriesKey[]];

export const GET_MACRO_RATE_KR_DESCRIPTION = `Retrieves authoritative Korean macro reference rates from 한국은행 ECOS (Bank of Korea Economic Statistics System) — the official source, with a dated value. Use this INSTEAD of web_search for these numbers.

Series:
- treasury_10y / treasury_5y / treasury_3y / treasury_1y — 국고채 수익률 (KTB yields). **treasury_10y is the DCF risk-free rate (Rf)** — use it for WACC instead of guessing/searching.
- corporate_aa3y — 회사채(3년, AA-) 수익률, a proxy for investment-grade cost of debt.
- usdkrw — 원/달러 환율 (매매기준율), for export-heavy names' FX strand.
- base_rate — 한국은행 기준금리 (BOK policy rate).

Returns the latest observation (with its as-of date) plus a short recent history. Always cite the returned date. Daily series; the latest print may lag 1 business day.`;

const InputSchema = z.object({
  series: z
    .enum(SERIES_KEYS)
    .default('treasury_10y')
    .describe('Which BOK series to fetch. Default treasury_10y (the DCF risk-free rate).'),
  recent: z
    .number()
    .int()
    .min(1)
    .max(60)
    .default(5)
    .describe('How many recent observations to include alongside the latest (default 5).'),
});

export const getMacroRateKr = new DynamicStructuredTool({
  name: 'get_macro_rate_kr',
  description: GET_MACRO_RATE_KR_DESCRIPTION,
  schema: InputSchema,
  func: async (input) => {
    try {
      const res = await fetchEcosSeries(input.series);
      const latest = res.rows.length > 0 ? res.rows[res.rows.length - 1] : null;
      const recent = res.rows.slice(-input.recent);
      return formatToolResult({
        source: '한국은행 ECOS (Bank of Korea Economic Statistics System)',
        series: res.series,
        label: res.label,
        statCode: res.statCode,
        itemName: res.itemName,
        unit: res.unit,
        cycle: res.cycle,
        latest,
        recent,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return formatToolResult({ series: input.series, latest: null, _error: message });
    }
  },
});
