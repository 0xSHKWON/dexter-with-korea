import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { krxApi } from './krx-api.js';
import { toDartDate, toIsoDate, parseKrxNumber } from './utils.js';
import { resolveIsin } from '../../data/krx-instrument-registry.js';
import { resolveKrSecurity } from './resolve-kr.js';
import { formatToolResult } from '../types.js';
import { TTL_6H } from '../finance/utils.js';

export const GET_SHORT_BALANCE_KR_DESCRIPTION = `Retrieves 공매도 순보유잔고 (short-selling net balance) for a Korean (KOSPI/KOSDAQ) listed company from the Korea Exchange (KRX). This is the Korean equivalent of US short interest.

Each daily row includes the short balance quantity (balanceQty), the listed shares (listedShares), the short balance amount in KRW (balanceAmount), market cap (marketCap), and the balance ratio as a % of listed shares (balanceRatio). Use this to gauge short pressure or crowding on a name. Accepts a 6-digit ticker (e.g. 005930 for Samsung Electronics) and an optional date range (defaults to the last ~30 days). Returns the most recent day first.

Note: investors below the 0.01% reporting threshold are not aggregated here, so this reflects reported balances. Requires KRX_ID/KRX_PW credentials.`;

const InputSchema = z.object({
  ticker: z
    .string()
    .min(1)
    .describe('6-digit Korean stock ticker (e.g. 005930) OR the company name (e.g. 삼성전자) — a name is resolved to its listing automatically.'),
  startDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use ISO YYYY-MM-DD.')
    .optional()
    .describe('ISO start date (YYYY-MM-DD). Defaults to ~30 days before the end date.'),
  endDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use ISO YYYY-MM-DD.')
    .optional()
    .describe('ISO end date (YYYY-MM-DD). Defaults to today.'),
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .default(20)
    .describe('Maximum number of days to return (default 20). Returns the most recent first.'),
});

export interface ShortBalanceRow {
  date: string;
  balanceQty: number | null;
  listedShares: number | null;
  balanceAmount: number | null;
  marketCap: number | null;
  balanceRatio: number | null;
}

/** Map a raw MDCSTAT30502 row to a friendly, numeric-parsed shape. */
export function mapShortBalanceRow(raw: Record<string, unknown>): ShortBalanceRow {
  return {
    date: toIsoDate(raw.RPT_DUTY_OCCR_DD),
    balanceQty: parseKrxNumber(raw.BAL_QTY),
    listedShares: parseKrxNumber(raw.LIST_SHRS),
    balanceAmount: parseKrxNumber(raw.BAL_AMT),
    marketCap: parseKrxNumber(raw.MKTCAP),
    balanceRatio: parseKrxNumber(raw.BAL_RTO),
  };
}

/** Default to a ~30-day window ending today (ISO strings). */
export function defaultRange(start?: string, end?: string): { startDate: string; endDate: string } {
  const endDate = end ?? new Date().toISOString().slice(0, 10);
  if (start) return { startDate: start, endDate };
  const startMs = Date.parse(endDate) - 30 * 24 * 60 * 60 * 1000;
  return { startDate: new Date(startMs).toISOString().slice(0, 10), endDate };
}

export const getShortBalanceKr = new DynamicStructuredTool({
  name: 'get_short_balance_kr',
  description: GET_SHORT_BALANCE_KR_DESCRIPTION,
  schema: InputSchema,
  func: async (input) => {
    const sec = await resolveKrSecurity(input.ticker);
    if (!sec) {
      return formatToolResult(
        { ticker: input.ticker, short: [] as ShortBalanceRow[], _error: `Could not resolve "${input.ticker}" to a Korean listing — pass a 6-digit ticker or an exact company name` },
        [],
      );
    }
    const ticker = sec.stockCode;
    const { startDate, endDate } = defaultRange(input.startDate, input.endDate);

    try {
      const resolved = await resolveIsin(ticker);
      if (!resolved) {
        return formatToolResult({ error: `Ticker ${ticker} not found in KRX instrument registry` }, []);
      }
      const { data, url } = await krxApi.get(
        'dbms/MDC/STAT/srt/MDCSTAT30502',
        { isuCd: resolved.isin, strtDd: toDartDate(startDate), endDd: toDartDate(endDate) },
        { cacheable: true, ttlMs: TTL_6H },
      );
      const rows = Array.isArray(data.OutBlock_1) ? (data.OutBlock_1 as Record<string, unknown>[]) : [];
      const short = rows
        .map(mapShortBalanceRow)
        .sort((a, b) => b.date.localeCompare(a.date))
        .slice(0, input.limit);
      return formatToolResult({ ticker, isin: resolved.isin, name: resolved.name, short }, [url]);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return formatToolResult({ ticker, short: [] as ShortBalanceRow[], _error: message }, []);
    }
  },
});
