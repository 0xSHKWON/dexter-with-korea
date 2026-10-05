import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { formatToolResult } from '../types.js';
import { blumeAdjust } from '../../data/compute-beta-kr.js';
import { BackpackUnsupportedTickerError, fetchBackpackStock, type BackpackStock } from './backpack-api.js';
import { TTL_6H } from './utils.js';

export const GET_BETA_DESCRIPTION = `Fetches equity beta (β) for US-listed stocks/ETFs — the sourced β for a US DCF cost of equity (Ke = Rf + β × ERP) and for bottom-up peer betas (unlever → median → relever). Accepts several tickers in one call (peer sets).

Source: Backpack's public stock data (keyless). Backpack does not disclose the method; the values match a 5-year MONTHLY raw regression on the S&P 500 (cross-checked on AAPL/NVDA/JNJ/KO), i.e. the FMP/Yahoo-style beta — NOT a Bloomberg-terminal 2y-weekly adjusted beta. No R² or observation count is provided. Returns rawBeta and adjustedBeta (Blume 0.67·raw + 0.33, same convention as get_beta_kr — use adjustedBeta as the WACC input), plus listDate/historyMonths, market cap (USD), sector and industry for peer work.

Use for US tickers (AAPL, BRK.B, ADRs like TSM). Korean 6-digit tickers → use get_beta_kr. A listing younger than 60 months has fewer than 5 years of monthly data, so its beta is a short-sample estimate (can be wildly off — e.g. 7+); the tool flags it in _dataQualityWarning — disclose it and prefer a peer beta.`;

const InputSchema = z.object({
  tickers: z
    .array(z.string().min(1))
    .min(1)
    .max(15)
    .describe('US tickers, e.g. ["AAPL"] or a peer set ["MSFT","ORCL","CRM"]. Share classes as BRK.B.'),
});

/** Months of price history needed to fill Backpack's (inferred) 5y monthly window. */
const FULL_WINDOW_MONTHS = 60;

export const BETA_METHOD =
  'Backpack 공개 데이터(산출법 비공개) — S&P 500 대비 5y 월간 raw 회귀와 일치(교차검증 기반 추정, FMP 방식). R²·관측치 미제공. adjustedBeta = Blume(0.67·raw + 0.33), get_beta_kr와 동일 보정.';

export interface UsBetaRecord {
  ticker: string;
  name: string | null;
  type: string | null;
  listDate: string | null;
  historyMonths: number | null;
  rawBeta: number | null;
  adjustedBeta: number | null;
  marketCapUsd: number | null;
  sector: string | null;
  industry: string | null;
  _dataQualityWarning?: string;
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function round(n: number, dp = 4): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

/** Whole months between an ISO date and `now` (null when unparseable). */
export function monthsSince(iso: string | null, now: Date): number | null {
  if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return null;
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  let months = (now.getUTCFullYear() - d.getUTCFullYear()) * 12 + (now.getUTCMonth() - d.getUTCMonth());
  if (now.getUTCDate() < d.getUTCDate()) months -= 1;
  return Math.max(0, months);
}

/** Shape one Backpack stats+info pair into the tool's per-ticker record. */
export function toBetaRecord(requested: string, stock: Pick<BackpackStock, 'stats' | 'info'>, now: Date): UsBetaRecord {
  const { stats, info } = stock;
  const raw = num(stats.beta);
  const listDate = str(info.listDate);
  const historyMonths = monthsSince(listDate, now);
  const type = str(info.type);

  const warnings: string[] = [];
  if (raw === null) {
    warnings.push('Backpack 응답에 β가 없습니다 — 피어 β 또는 섹터 대용치를 쓰고 그 사실을 명시하십시오.');
  }
  if (raw !== null && historyMonths === null) {
    warnings.push('상장일을 확인하지 못해 5y 창 충족 여부를 모릅니다 — 최근 상장 종목이면 소표본 β일 수 있으니 피어 β와 교차확인하십시오.');
  }
  if (historyMonths !== null && historyMonths < FULL_WINDOW_MONTHS) {
    warnings.push(
      `상장 ${historyMonths}개월(listDate ${listDate}) — 5y 월간 창(60개월) 미충족이라 관측치가 ~${historyMonths}개뿐인 소표본 β입니다. 단독으로 WACC에 쓰지 말고 피어 bottom-up β를 우선하십시오.`,
    );
  }
  if (raw !== null && (raw < 0 || raw > 3)) {
    warnings.push(`raw β=${round(raw)}는 이례적 극단값입니다 — 피어 β와 교차확인하십시오.`);
  }
  if (type === 'ETF') {
    warnings.push('ETF입니다 — 개별 기업 β가 아니라 펀드 β입니다.');
  }

  return {
    ticker: str(stats.ticker) ?? requested,
    name: str(info.name),
    type,
    listDate,
    historyMonths,
    rawBeta: raw === null ? null : round(raw),
    adjustedBeta: raw === null ? null : round(blumeAdjust(raw)),
    marketCapUsd: num(stats.marketCap) ?? num(info.marketCap),
    sector: str(stats.sector),
    industry: str(stats.industry),
    ...(warnings.length > 0 ? { _dataQualityWarning: warnings.join(' ') } : {}),
  };
}

export const getBeta = new DynamicStructuredTool({
  name: 'get_beta',
  description: GET_BETA_DESCRIPTION,
  schema: InputSchema,
  func: async (input) => {
    const tickers = [...new Set(input.tickers.map((t) => t.trim().toUpperCase()).filter(Boolean))];
    const now = new Date();
    const urls: string[] = [];

    const betas = await Promise.all(
      tickers.map(async (ticker) => {
        if (/^\d{6}$/.test(ticker)) {
          return { ticker, _error: `${ticker} is a Korean ticker — use get_beta_kr` };
        }
        try {
          const stock = await fetchBackpackStock(ticker, { cacheable: true, ttlMs: TTL_6H });
          urls.push(stock.url);
          return toBetaRecord(ticker, stock, now);
        } catch (error) {
          if (error instanceof BackpackUnsupportedTickerError) {
            return { ticker, _error: `${error.message} — use a peer beta or sector proxy` };
          }
          return { ticker, _error: error instanceof Error ? error.message : String(error) };
        }
      }),
    );

    return formatToolResult(
      {
        betas,
        benchmark: 'S&P 500',
        method: BETA_METHOD,
        source: 'Backpack (api.backpack.exchange) — keyless',
        fetchedAt: now.toISOString(),
      },
      urls,
    );
  },
});
