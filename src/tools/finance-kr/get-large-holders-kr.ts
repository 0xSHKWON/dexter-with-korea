import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { dartApi } from './api.js';
import { sortByRceptDtDesc, isNoDataError } from './utils.js';
import { resolveKrSecurity } from './resolve-kr.js';
import { formatToolResult } from '../types.js';
import { TTL_24H } from '../finance/utils.js';

export const GET_LARGE_HOLDERS_KR_DESCRIPTION = `Retrieves 대량보유 상황보고 (5%-rule large shareholding reports) for a Korean (KOSPI/KOSDAQ) listed company from DART. Under Korean law, any party crossing 5% beneficial ownership (or changing a held stake by ≥1%) must disclose. This is the closest Korean equivalent of US 13F / large-holder data.

Each report includes the filer (repror), shares held (stkqy), ownership ratio (stkrt), change in ratio (stkrt_irds), reason for filing (report_resn), and receipt date (rcept_dt). Use this for "who are the major shareholders of X" or to track stake-building. Accepts a 6-digit ticker (e.g. 005930 for Samsung Electronics). Returns the most recent reports first.`;

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

export const getLargeHoldersKr = new DynamicStructuredTool({
  name: 'get_large_holders_kr',
  description: GET_LARGE_HOLDERS_KR_DESCRIPTION,
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
      // majorstock.json has no date filter — returns full history; sort + cap client-side.
      const { data, url } = await dartApi.get(
        '/majorstock.json',
        { corp_code: resolved.corp_code },
        { cacheable: true, ttlMs: TTL_24H },
      );
      const list = Array.isArray(data.list) ? data.list : [];
      return formatToolResult(
        {
          ticker,
          corp_code: resolved.corp_code,
          corp_name: resolved.corp_name,
          holders: sortByRceptDtDesc(list, input.limit),
        },
        [url],
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const base = {
        ticker,
        corp_code: resolved.corp_code,
        corp_name: resolved.corp_name,
        holders: [],
      };
      return formatToolResult(isNoDataError(message) ? base : { ...base, _error: message }, []);
    }
  },
});
