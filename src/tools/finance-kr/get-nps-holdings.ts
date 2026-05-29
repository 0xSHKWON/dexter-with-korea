import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { getNpsHoldings } from '../../data/nps-registry.js';
import { resolveTicker } from '../../data/ticker-registry.js';
import { formatToolResult } from '../types.js';
import type { NpsHoldingEntry } from '../../data/fetchers/nps-holdings.js';

export const GET_NPS_HOLDINGS_DESCRIPTION = `Retrieves 국민연금공단 (National Pension Service, NPS) domestic-equity holdings — Korea's largest institutional investor. There is no direct US equivalent; this is the canonical "what does the national pension fund own" dataset.

Data is the NPS year-end disclosure (most recent published): per stock, the evaluation amount in 억원 (evalAmount), the weight within the domestic-equity book in % (weightPct), and the stake as a % of the company's shares (shareRatioPct). Provide a Korean stock name (e.g. "삼성전자") or a 6-digit ticker to look up a specific holding, or omit both to get the largest holdings by value. Note: this is a periodic year-end snapshot, not real-time.`;

const InputSchema = z.object({
  name: z
    .string()
    .optional()
    .describe('Korean stock name to look up (e.g. 삼성전자). Preferred when known.'),
  ticker: z
    .string()
    .regex(/^\d{6}$/, 'Korean ticker must be a 6-digit string (e.g. 005930 for Samsung).')
    .optional()
    .describe('6-digit Korean ticker (e.g. 005930). Resolved to a name when possible.'),
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .default(20)
    .describe('Max holdings to return (default 20). For the no-query case, the largest by value.'),
});

function normalizeName(value: string): string {
  return value.replace(/\s+/g, '').toLowerCase();
}

/** Match NPS rows to a target name (whitespace-insensitive, either-contains). */
export function matchByName(entries: NpsHoldingEntry[], target: string): NpsHoldingEntry[] {
  const t = normalizeName(target);
  if (!t) return [];
  return entries.filter((e) => {
    const n = normalizeName(e.name);
    return n.includes(t) || t.includes(n);
  });
}

function byEvalDesc(a: NpsHoldingEntry, b: NpsHoldingEntry): number {
  return (b.evalAmount ?? -Infinity) - (a.evalAmount ?? -Infinity);
}

/** Best-effort ticker → Korean name via the DART registry; null if unavailable. */
async function tryResolveName(ticker: string): Promise<string | null> {
  try {
    const resolved = await resolveTicker(ticker);
    return resolved?.corp_name ?? null;
  } catch {
    return null;
  }
}

export const getNpsHoldings_tool = new DynamicStructuredTool({
  name: 'get_nps_holdings',
  description: GET_NPS_HOLDINGS_DESCRIPTION,
  schema: InputSchema,
  func: async (input) => {
    let entries: NpsHoldingEntry[];
    try {
      entries = await getNpsHoldings();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return formatToolResult({ holdings: [], _error: message }, []);
    }

    const target = input.name ?? (input.ticker ? await tryResolveName(input.ticker) : null);

    let holdings: NpsHoldingEntry[];
    if (target) {
      holdings = matchByName(entries, target).sort(byEvalDesc).slice(0, input.limit);
    } else {
      holdings = [...entries].sort(byEvalDesc).slice(0, input.limit);
    }

    return formatToolResult({
      source: 'NPS 국내주식 투자정보 (data.go.kr, year-end snapshot)',
      query: { name: input.name ?? null, ticker: input.ticker ?? null, resolvedName: target },
      holdings,
    });
  },
});
