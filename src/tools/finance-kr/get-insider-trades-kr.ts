import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { dartApi } from './api.js';
import { sortByRceptDtDesc, isNoDataError } from './utils.js';
import { resolveKrSecurity } from './resolve-kr.js';
import { formatToolResult } from '../types.js';
import { TTL_24H } from '../finance/utils.js';

export const GET_INSIDER_TRADES_KR_DESCRIPTION = `Retrieves 임원·주요주주 소유보고 (executives' and major shareholders' ownership reports) for a Korean (KOSPI/KOSDAQ) listed company from DART. Korean executives, directors, and 10%+ shareholders must report their holdings and any changes — the closest equivalent of US insider trades (SEC Form 4).

Each report includes the reporter (repror), relationship to the company (isu_exctv_rgist_at / isu_exctv_ofcps), shares held (sp_stock_lmp_cnt), change in shares (sp_stock_lmp_irds_cnt), and receipt date (rcept_dt). Use this for "what are insiders at X doing" or to track executive/major-shareholder buying and selling. Accepts a 6-digit ticker (e.g. 005930 for Samsung Electronics). Returns the most recent reports first.`;

const InputSchema = z.object({
  ticker: z
    .string()
    .min(1)
    .describe('6-digit Korean stock ticker (e.g. 005930) OR the company name (e.g. 삼성전자) — a name is resolved to its DART listing automatically.'),
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .default(20)
    .describe('Maximum number of reports to return (default 20). Returns the most recent first.'),
});

export const getInsiderTradesKr = new DynamicStructuredTool({
  name: 'get_insider_trades_kr',
  description: GET_INSIDER_TRADES_KR_DESCRIPTION,
  schema: InputSchema,
  func: async (input) => {
    const sec = await resolveKrSecurity(input.ticker);
    if (!sec?.corpCode) {
      return formatToolResult(
        { ticker: input.ticker, _error: `Could not resolve "${input.ticker}" to a DART corp_code — pass a 6-digit ticker or an exact company name` },
        [],
      );
    }
    const ticker = sec.stockCode;
    const resolved = { corp_code: sec.corpCode, corp_name: sec.name ?? '' };

    try {
      // elestock.json has no date filter — returns full history; sort + cap client-side.
      const { data, url } = await dartApi.get(
        '/elestock.json',
        { corp_code: resolved.corp_code },
        { cacheable: true, ttlMs: TTL_24H },
      );
      const list = Array.isArray(data.list) ? data.list : [];
      return formatToolResult(
        {
          ticker,
          corp_code: resolved.corp_code,
          corp_name: resolved.corp_name,
          trades: sortByRceptDtDesc(list, input.limit),
        },
        [url],
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const base = {
        ticker,
        corp_code: resolved.corp_code,
        corp_name: resolved.corp_name,
        trades: [],
      };
      return formatToolResult(isNoDataError(message) ? base : { ...base, _error: message }, []);
    }
  },
});
