import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { fetchNaverTrend } from './naver-api.js';
import { parseKrxNumber } from './utils.js';
import { formatToolResult } from '../types.js';
import { TTL_6H } from '../finance/utils.js';

export const GET_FOREIGN_OWNERSHIP_KR_DESCRIPTION = `Retrieves 외국인 지분율 (foreign ownership ratio) for a Korean (KOSPI/KOSDAQ) listed company. Foreign holding is a closely watched flow signal in Korea; there is no direct US equivalent.

Each daily row includes the foreign holding ratio as a % of shares (foreignHoldRatio), and the day's net-buy quantities for foreigners, institutions, and individuals (foreignNetBuyQty, orgNetBuyQty, individualNetBuyQty), plus close price and volume. Use this for "foreign ownership of X" or to track foreign accumulation/distribution. Accepts a 6-digit ticker (e.g. 005930 for Samsung Electronics). Returns the most recent day first (about a month of history).`;

const InputSchema = z.object({
  ticker: z
    .string()
    .regex(/^\d{6}$/, 'Korean ticker must be a 6-digit string (e.g. 005930 for Samsung).')
    .describe('6-digit Korean stock ticker (e.g. 005930 for Samsung Electronics).'),
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .default(20)
    .describe('Maximum number of days to return (default 20). Returns the most recent first.'),
});

export interface ForeignOwnershipRow {
  date: string;
  foreignHoldRatio: number | null;
  foreignNetBuyQty: number | null;
  orgNetBuyQty: number | null;
  individualNetBuyQty: number | null;
  closePrice: number | null;
  tradingVolume: number | null;
}

/** Map a raw Naver mobile-trend row to a friendly, numeric-parsed shape. */
export function mapForeignRow(raw: Record<string, unknown>): ForeignOwnershipRow {
  return {
    date: String(raw.bizdate ?? '').trim(),
    foreignHoldRatio: parseKrxNumber(raw.foreignerHoldRatio),
    foreignNetBuyQty: parseKrxNumber(raw.foreignerPureBuyQuant),
    orgNetBuyQty: parseKrxNumber(raw.organPureBuyQuant),
    individualNetBuyQty: parseKrxNumber(raw.individualPureBuyQuant),
    closePrice: parseKrxNumber(raw.closePrice),
    tradingVolume: parseKrxNumber(raw.accumulatedTradingVolume),
  };
}

export const getForeignOwnershipKr = new DynamicStructuredTool({
  name: 'get_foreign_ownership_kr',
  description: GET_FOREIGN_OWNERSHIP_KR_DESCRIPTION,
  schema: InputSchema,
  func: async (input) => {
    const ticker = input.ticker.trim();
    const base = { ticker, ownership: [] as ForeignOwnershipRow[] };
    try {
      const { rows, url } = await fetchNaverTrend(ticker, { cacheable: true, ttlMs: TTL_6H });
      const ownership = rows
        .map(mapForeignRow)
        .sort((a, b) => b.date.localeCompare(a.date))
        .slice(0, input.limit);
      return formatToolResult({ ...base, ownership }, [url]);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return formatToolResult({ ...base, _error: message }, []);
    }
  },
});
