import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { dartApi } from './api.js';
import { isNoDataError, parseKrxNumber, toIsoDate } from './utils.js';
import { resolveKrSecurity } from './resolve-kr.js';
import { defaultYear } from './sub-tools/get-business-report.js';
import { formatToolResult } from '../types.js';
import { TTL_24H } from '../finance/utils.js';

export const GET_EQUITY_INVESTMENTS_KR_DESCRIPTION = `Retrieves 타법인 출자현황 (equity stakes a Korean listed company holds in OTHER corporations) from the DART 정기보고서 상세표. This is the authoritative year-end snapshot of every subsidiary/affiliate stake — listed AND unlisted — with term-end share count, ownership ratio, and book value.

Call this with the PARENT/investor company (e.g. a 지주사 like LG 003550) to map its subsidiary stakes for SOTP/NAV analysis. Direction matters: get_large_holders_kr answers "who owns X" (investee side, and only reports 5%-rule CHANGES — stakes that haven't moved in years don't appear); this tool answers "what does X own" and is a complete snapshot regardless of recent activity.

Each row: investee name, purpose (경영참여/단순투자), term-end shares + ownership % + book value, share change during the year, and the investee's own total assets / net income (useful for valuing unlisted subsidiaries). Caveat: the disclosed ratio is often rounded to whole percent in the filing — for a precise ratio divide the exact share count by the investee's total listed shares.`;

const REPORT_TYPE_CODES = {
  annual: '11011',
  semiannual: '11012',
  quarterly_1: '11013',
  quarterly_3: '11014',
} as const;

const InputSchema = z.object({
  ticker: z
    .string()
    .min(1)
    .describe('6-digit Korean stock ticker (e.g. 003550) OR the company name (e.g. LG) of the INVESTOR/parent company — a name is resolved to its DART listing automatically.'),
  year: z
    .number()
    .int()
    .min(2015)
    .optional()
    .describe('Business year of the 정기보고서 (e.g. 2025 = the report covering FY2025). Defaults to the latest filed annual report; auto-falls back one year if not yet filed.'),
  report_type: z
    .enum(['annual', 'semiannual', 'quarterly_1', 'quarterly_3'])
    .default('annual')
    .describe('Which 정기보고서 to read (default annual — the 타법인출자현황 detail table is most complete there).'),
  limit: z
    .number()
    .int()
    .min(1)
    .max(200)
    .default(100)
    .describe('Maximum rows to return (default 100). Rows are sorted by term-end book value descending, so truncation keeps the largest stakes.'),
});

interface InvestmentRow {
  name: string;
  purpose: string | null;
  shares: number | null;
  ratioPct: number | null;
  bookValue: number | null;
  sharesChange: number | null;
  investee: { totalAssets: number | null; netIncome: number | null; fiscalDate: string | null };
}

/**
 * Normalize raw otrCprInvstmntSttus rows: comma-string numbers → numbers
 * ("-" → null), sort by term-end book value descending (nulls last) so a
 * truncated list keeps the largest stakes, then cap to `limit`.
 */
export function normalizeInvestments(
  list: Record<string, unknown>[],
  limit: number,
): { rows: InvestmentRow[]; totalCount: number } {
  const rows = list
    .map((r): InvestmentRow => ({
      name: String(r.inv_prm ?? '').trim(),
      purpose: String(r.invstmnt_purps ?? '').trim() || null,
      shares: parseKrxNumber(r.trmend_blce_qy),
      ratioPct: parseKrxNumber(r.trmend_blce_qota_rt),
      bookValue: parseKrxNumber(r.trmend_blce_acntbk_amount),
      sharesChange: parseKrxNumber(r.incrs_dcrs_acqs_dsps_qy),
      investee: {
        totalAssets: parseKrxNumber(r.recent_bsns_year_fnnr_sttus_tot_assets),
        netIncome: parseKrxNumber(r.recent_bsns_year_fnnr_sttus_thstrm_ntpf),
        fiscalDate: toIsoDate(r.stlm_dt) || null,
      },
    }))
    // Some filings append a "합 계" total row — drop it so sums aren't double-counted.
    .filter((r) => r.name !== '' && !/^합\s*계$/.test(r.name))
    .sort((a, b) => (b.bookValue ?? -1) - (a.bookValue ?? -1));
  return { rows: rows.slice(0, limit), totalCount: rows.length };
}

export const getEquityInvestmentsKr = new DynamicStructuredTool({
  name: 'get_equity_investments_kr',
  description: GET_EQUITY_INVESTMENTS_KR_DESCRIPTION,
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
    const corp = { corp_code: sec.corpCode, corp_name: sec.name ?? '' };
    const reprt_code = REPORT_TYPE_CODES[input.report_type];

    const fetchYear = (bsns_year: number) =>
      dartApi.get(
        '/otrCprInvstmntSttus.json',
        { corp_code: corp.corp_code, bsns_year, reprt_code },
        { cacheable: true, ttlMs: TTL_24H },
      );

    let year = input.year ?? defaultYear(input.report_type);
    let fellBack = false;
    try {
      let res: Awaited<ReturnType<typeof fetchYear>>;
      try {
        res = await fetchYear(year);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        // No explicit year + default-year report not filed yet → try one year back.
        if (input.year === undefined && isNoDataError(message)) {
          year -= 1;
          fellBack = true;
          res = await fetchYear(year);
        } else {
          throw error;
        }
      }

      const list = Array.isArray(res.data.list) ? (res.data.list as Record<string, unknown>[]) : [];
      const { rows, totalCount } = normalizeInvestments(list, input.limit);
      const rceptNo = list.length > 0 ? String(list[0].rcept_no ?? '') : null;
      return formatToolResult(
        {
          ticker,
          ...corp,
          year,
          report_type: input.report_type,
          rcept_no: rceptNo,
          basis: `${year} ${input.report_type} 보고서의 기말 잔액 스냅샷${fellBack ? ` (당초 조회연도 미공시 → ${year}년으로 폴백)` : ''}`,
          note: '지분율(ratioPct)은 공시 원문에서 정수 %로 반올림된 경우가 많다 — 정밀값이 필요하면 shares(정확한 주식수)를 대상회사 총주식수로 나눠 재계산하라. bookValue는 취득원가/장부금액(원)이며 시가가 아니다.',
          investments: rows,
          totalCount,
          ...(totalCount > rows.length ? { truncated: `showing top ${rows.length} of ${totalCount} by book value` } : {}),
        },
        [res.url],
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const base = { ticker, ...corp, year, report_type: input.report_type, investments: [], totalCount: 0 };
      return formatToolResult(isNoDataError(message) ? base : { ...base, _error: message }, []);
    }
  },
});
