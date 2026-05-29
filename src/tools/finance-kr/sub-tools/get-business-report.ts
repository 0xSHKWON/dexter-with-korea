import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { dartApi } from '../api.js';
import { resolveTicker } from '../../../data/ticker-registry.js';
import { formatToolResult } from '../../types.js';
import { TTL_24H } from '../../finance/utils.js';

const REPORT_TYPE_CODES = {
  annual: '11011',       // 사업보고서
  semiannual: '11012',   // 반기보고서
  quarterly_1: '11013',  // 1분기보고서
  quarterly_3: '11014',  // 3분기보고서
} as const;

type ReportType = keyof typeof REPORT_TYPE_CODES;

const InputSchema = z.object({
  ticker: z
    .string()
    .regex(/^\d{6}$/, 'Korean ticker must be a 6-digit string (e.g. 005930 for Samsung).')
    .describe('6-digit Korean stock ticker (e.g. 005930 for Samsung Electronics).'),
  report_type: z
    .enum(['annual', 'semiannual', 'quarterly_1', 'quarterly_3'])
    .default('annual')
    .describe(
      "Report type: 'annual' (사업보고서, ~Mar following year), 'semiannual' (반기보고서, ~Aug), " +
      "'quarterly_1' (1분기, ~May), 'quarterly_3' (3분기, ~Nov)."
    ),
  year: z
    .number()
    .int()
    .min(2015)
    .optional()
    .describe('Business year (bsns_year) for the report. Defaults to the most recent completed year.'),
  period_count: z
    .number()
    .int()
    .min(1)
    .max(5)
    .default(1)
    .describe('Number of consecutive years to fetch ending at `year` (default 1).'),
  fs_div: z
    .enum(['CFS', 'OFS'])
    .default('CFS')
    .describe("Financial statement scope: 'CFS' (연결, consolidated) or 'OFS' (개별, separate)."),
});

function defaultYear(): number {
  // DART typically publishes annual reports in March of the following year.
  // Default to last year so requests don't 404 in January–March.
  return new Date().getUTCFullYear() - 1;
}

export const getBusinessReport = new DynamicStructuredTool({
  name: 'get_business_report_kr',
  description:
    'Fetches a Korean listed company\'s 사업/반기/분기보고서 (annual/semiannual/quarterly statements) from DART. ' +
    'Returns full income statement, balance sheet, and cash flow line items as reported under K-IFRS.',
  schema: InputSchema,
  func: async (input) => {
    const ticker = input.ticker.trim();
    const resolved = await resolveTicker(ticker);
    if (!resolved) {
      return formatToolResult({
        error: `Ticker ${ticker} not found in DART corp registry`,
      }, []);
    }

    const endYear = input.year ?? defaultYear();
    const years = Array.from({ length: input.period_count }, (_, i) => endYear - i);
    const reprt_code = REPORT_TYPE_CODES[input.report_type as ReportType];

    const results = await Promise.all(
      years.map(async (bsns_year) => {
        try {
          const { data, url } = await dartApi.get(
            '/fnlttSinglAcntAll.json',
            {
              corp_code: resolved.corp_code,
              bsns_year,
              reprt_code,
              fs_div: input.fs_div,
            },
            { cacheable: true, ttlMs: TTL_24H },
          );
          return { year: bsns_year, list: data.list ?? [], url, error: null as string | null };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return { year: bsns_year, list: [], url: '', error: message };
        }
      }),
    );

    const urls = results.map((r) => r.url).filter(Boolean);
    const successful = results.filter((r) => r.error === null);
    const failed = results.filter((r) => r.error !== null);

    return formatToolResult(
      {
        ticker,
        corp_code: resolved.corp_code,
        corp_name: resolved.corp_name,
        report_type: input.report_type,
        fs_div: input.fs_div,
        periods: successful.map((r) => ({ bsns_year: r.year, list: r.list })),
        ...(failed.length > 0 ? { _errors: failed.map((r) => ({ year: r.year, error: r.error })) } : {}),
      },
      urls,
    );
  },
});
