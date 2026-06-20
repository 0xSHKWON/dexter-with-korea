import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { dartApi } from './api.js';
import { toDartDate, isNoDataError } from './utils.js';
import { resolveKrSecurity } from './resolve-kr.js';
import { formatToolResult } from '../types.js';
import { TTL_1H } from '../finance/utils.js';

export const GET_FILINGS_KR_DESCRIPTION = `Retrieves disclosure (공시) metadata for a Korean (KOSPI/KOSDAQ) listed company from DART's 공시검색 (filing search). Returns a list of filings with report name (report_nm), receipt number (rcept_no), receipt date (rcept_dt), filer (flr_nm), and remarks (rm). This is metadata only — the Korean equivalent of get_filings for US stocks.

Use this for "what has company X disclosed recently", regulatory filing history, or to find a specific 보고서. Accepts a 6-digit ticker (e.g. 005930 for Samsung Electronics). Optionally filter by filing_type and a date range. For financial statement line items use get_financials_kr instead.`;

/** DART 공시유형 (pblntf_ty) single-char codes. */
const PBLNTF_TY: Record<string, string> = {
  periodic: 'A', // 정기공시 (사업·반기·분기보고서)
  material: 'B', // 주요사항보고
  issuance: 'C', // 발행공시
  ownership: 'D', // 지분공시 (5%룰, 임원·주요주주)
  audit: 'F', // 외부감사관련
  exchange: 'I', // 거래소공시
};

const InputSchema = z.object({
  ticker: z
    .string()
    .min(1)
    .describe('6-digit Korean stock ticker (e.g. 005930) OR the company name (e.g. 삼성전자) — a name is resolved to its DART listing automatically.'),
  filing_type: z
    .enum(['periodic', 'material', 'issuance', 'ownership', 'audit', 'exchange'])
    .optional()
    .describe(
      "Optional DART disclosure category: 'periodic' (정기공시), 'material' (주요사항보고), " +
        "'issuance' (발행공시), 'ownership' (지분공시), 'audit' (외부감사관련), 'exchange' (거래소공시). " +
        'Omit to return filings of any type.',
    ),
  start_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD.')
    .optional()
    .describe('Search start date (YYYY-MM-DD). Defaults to ~1 year ago.'),
  end_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD.')
    .optional()
    .describe('Search end date (YYYY-MM-DD). Defaults to today.'),
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .default(20)
    .describe('Maximum number of filings to return (default 20, max 100). Returns the most recent first.'),
});

function defaultRange(): { bgn_de: string; end_de: string } {
  const today = new Date();
  const oneYearAgo = new Date(today);
  oneYearAgo.setUTCFullYear(today.getUTCFullYear() - 1);
  const fmt = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, '');
  return { bgn_de: fmt(oneYearAgo), end_de: fmt(today) };
}

export const getFilingsKr = new DynamicStructuredTool({
  name: 'get_filings_kr',
  description: GET_FILINGS_KR_DESCRIPTION,
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

    const range = defaultRange();
    const params = {
      corp_code: resolved.corp_code,
      bgn_de: input.start_date ? toDartDate(input.start_date) : range.bgn_de,
      end_de: input.end_date ? toDartDate(input.end_date) : range.end_de,
      pblntf_ty: input.filing_type ? PBLNTF_TY[input.filing_type] : undefined,
      page_count: input.limit,
      page_no: 1,
      // Don't rely on DART's implicit default ordering — promise most-recent-first explicitly.
      sort: 'date',
      sort_mth: 'desc',
    };

    try {
      const { data, url } = await dartApi.get('/list.json', params, {
        cacheable: true,
        ttlMs: TTL_1H,
      });
      return formatToolResult(
        {
          ticker,
          corp_code: resolved.corp_code,
          corp_name: resolved.corp_name,
          filings: Array.isArray(data.list) ? data.list : [],
        },
        [url],
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const base = {
        ticker,
        corp_code: resolved.corp_code,
        corp_name: resolved.corp_name,
        filings: [],
      };
      return formatToolResult(isNoDataError(message) ? base : { ...base, _error: message }, []);
    }
  },
});
