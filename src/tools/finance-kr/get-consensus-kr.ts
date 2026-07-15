import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { fetchNaverFinance } from './naver-api.js';
import { resolveKrSecurity } from './resolve-kr.js';
import { parseKrxNumber } from './utils.js';
import { formatToolResult } from '../types.js';
import { TTL_6H } from '../finance/utils.js';

export const GET_CONSENSUS_KR_DESCRIPTION = `Retrieves annual/quarterly financials WITH sell-side consensus estimates (증권사 컨센서스 추정치) for a Korean (KOSPI/KOSDAQ) listed company — the keyless forward-estimate source.

Each period column is either a reported actual (isConsensusEstimate: false) or a FORWARD analyst-consensus estimate (isConsensusEstimate: true, from Naver's aggregation of 증권사 추정). Rows cover 매출액(revenue)·영업이익(operatingProfit)·당기순이익(netProfit)·지배주주순이익·margins·ROE·EPS·PER·BPS·PBR·주당배당금(dps).

Use this to (1) anchor growth assumptions to a SOURCED consensus instead of extrapolating from history, (2) answer "내년 실적 컨센서스/전망" questions, (3) check earnings surprise vs prior estimates. Money figures are in 억원 (hundred-million KRW, e.g. revenue 3,008,709 = 300.87조원); ratios in %; EPS/BPS/dps in 원; PER/PBR in 배.

If hasConsensusEstimates is false, no analyst coverage exists for the name — treat that as "no consensus available", NOT as zero growth. Accepts a 6-digit ticker (e.g. 005930) or a company name.`;

const InputSchema = z.object({
  ticker: z
    .string()
    .min(1)
    .describe('6-digit Korean stock ticker (e.g. 005930) OR the company name (e.g. 삼성전자) — a name is resolved to its listing automatically.'),
  period: z
    .enum(['annual', 'quarter', 'both'])
    .default('annual')
    .describe("'annual' (default, best for growth anchoring), 'quarter' (near-term momentum), or 'both'."),
});

/** Naver metric row titles → stable English keys. Unmapped titles pass through verbatim so upstream additions surface instead of vanishing. */
const METRIC_KEYS: Record<string, string> = {
  매출액: 'revenue',
  영업이익: 'operatingProfit',
  당기순이익: 'netProfit',
  지배주주순이익: 'netProfitControlling',
  비지배주주순이익: 'netProfitNonControlling',
  영업이익률: 'operatingMarginPct',
  순이익률: 'netMarginPct',
  ROE: 'roePct',
  부채비율: 'debtRatioPct',
  당좌비율: 'quickRatioPct',
  유보율: 'retentionRatioPct',
  EPS: 'eps',
  PER: 'per',
  BPS: 'bps',
  PBR: 'pbr',
  주당배당금: 'dps',
};

/** Units for the mapped metric keys, as labeled on the Naver finance tab (단위: 억원, %, 배, 원). */
export const METRIC_UNITS: Record<string, string> = {
  revenue: '억원',
  operatingProfit: '억원',
  netProfit: '억원',
  netProfitControlling: '억원',
  netProfitNonControlling: '억원',
  operatingMarginPct: '%',
  netMarginPct: '%',
  roePct: '%',
  debtRatioPct: '%',
  quickRatioPct: '%',
  retentionRatioPct: '%',
  eps: '원',
  per: '배',
  bps: '원',
  pbr: '배',
  dps: '원',
};

export interface ConsensusPeriod {
  /** Human period label, e.g. "2026.12" (annual) or "2026.06" (quarter). */
  period: string;
  /** Sort key, e.g. "202612". */
  key: string;
  /** true = forward sell-side consensus estimate; false = reported actual. */
  isConsensusEstimate: boolean;
  /** Metric key → parsed numeric value (null where Naver shows "-"). */
  metrics: Record<string, number | null>;
}

/**
 * Parse a Naver `/finance/{annual|quarter}` payload into period-major rows
 * (ascending by period key). Pure so it is unit-testable against fixtures.
 */
export function parseNaverFinance(payload: Record<string, unknown> | null): ConsensusPeriod[] {
  const financeInfo =
    payload && typeof payload.financeInfo === 'object' && payload.financeInfo !== null
      ? (payload.financeInfo as Record<string, unknown>)
      : null;
  const titleList = Array.isArray(financeInfo?.trTitleList)
    ? (financeInfo.trTitleList as Record<string, unknown>[])
    : [];
  const rowList = Array.isArray(financeInfo?.rowList)
    ? (financeInfo.rowList as Record<string, unknown>[])
    : [];

  const periods: ConsensusPeriod[] = titleList
    .map((t) => ({
      period: String(t.title ?? '').replace(/\.$/, ''),
      key: String(t.key ?? ''),
      isConsensusEstimate: t.isConsensus === 'Y',
      metrics: {} as Record<string, number | null>,
    }))
    .filter((p) => p.key !== '');

  for (const row of rowList) {
    const title = String(row.title ?? '');
    if (!title) continue;
    const key = METRIC_KEYS[title] ?? title;
    const columns =
      row.columns && typeof row.columns === 'object' ? (row.columns as Record<string, unknown>) : {};
    for (const p of periods) {
      const cell = columns[p.key];
      const value =
        cell && typeof cell === 'object' ? (cell as Record<string, unknown>).value : undefined;
      p.metrics[key] = parseKrxNumber(value);
    }
  }

  return periods.sort((a, b) => a.key.localeCompare(b.key));
}

interface PeriodBlock {
  periods: ConsensusPeriod[];
  source: string;
  fetchedAt: string | null;
}

export interface ConsensusAssessment {
  hasConsensusEstimates: boolean;
  /** Upstream-drift warning — set when the payload could not be parsed into periods/known metrics. */
  warning: string | null;
  /** "No analyst coverage" note — only when periods parsed fine but none is an estimate. */
  note: string | null;
}

/**
 * Classify the parsed blocks. Zero periods means the payload shape drifted or the
 * fetch degraded — NOT that the company lacks coverage; conflating the two made
 * the tool assert "애널리스트 커버리지 부재" for fully covered names on a Naver
 * hiccup. Pure (testable).
 */
export function assessConsensus(blocks: ConsensusPeriod[][]): ConsensusAssessment {
  const allPeriods = blocks.flat();
  const hasConsensusEstimates = allPeriods.some((p) => p.isConsensusEstimate);
  const anyBlockEmpty = blocks.some((b) => b.length === 0);
  const anyKnownMetric = allPeriods.some((p) => Object.keys(p.metrics).some((k) => k in METRIC_UNITS));

  const warning = anyBlockEmpty
    ? 'Naver finance 응답에서 기간 테이블을 파싱하지 못했습니다 — 응답 구조 변경 또는 일시적 오류 가능성이 있습니다. 실적/컨센서스 부재로 단정하지 마세요.'
    : !anyKnownMetric
      ? '알려진 재무 지표 행(매출액·영업이익 등)이 하나도 매핑되지 않았습니다. Naver finance 응답 구조 변경 가능성이 있어, 값을 신뢰하기 전 확인이 필요합니다.'
      : null;

  const note =
    !warning && !hasConsensusEstimates
      ? '컨센서스 추정 기간이 없습니다 — 애널리스트 커버리지 부재로 해석하세요 (성장률 0을 의미하지 않음).'
      : null;

  return { hasConsensusEstimates, warning, note };
}

async function fetchBlock(ticker: string, period: 'annual' | 'quarter'): Promise<{ block: PeriodBlock; url: string }> {
  const { data, url, fetchedAt } = await fetchNaverFinance(ticker, period, { cacheable: true, ttlMs: TTL_6H });
  return { block: { periods: parseNaverFinance(data), source: 'Naver mobile finance (증권사 컨센서스 집계)', fetchedAt }, url };
}

export const getConsensusKr = new DynamicStructuredTool({
  name: 'get_consensus_kr',
  description: GET_CONSENSUS_KR_DESCRIPTION,
  schema: InputSchema,
  func: async (input) => {
    const resolved = await resolveKrSecurity(input.ticker);
    if (!resolved) {
      return formatToolResult(
        { ticker: input.ticker, _error: `Could not resolve "${input.ticker}" to a Korean listing — pass a 6-digit ticker or an exact company name` },
        [],
      );
    }
    const ticker = resolved.stockCode;
    const base: Record<string, unknown> = { ticker, name: resolved.name };
    try {
      const wants: Array<'annual' | 'quarter'> =
        input.period === 'both' ? ['annual', 'quarter'] : [input.period];
      const results = await Promise.all(wants.map((p) => fetchBlock(ticker, p)));
      const urls: string[] = [];
      results.forEach(({ block, url }, i) => {
        base[wants[i]] = block;
        urls.push(url);
      });

      const { hasConsensusEstimates, warning, note } = assessConsensus(
        results.map(({ block }) => block.periods),
      );

      return formatToolResult(
        {
          ...base,
          units: METRIC_UNITS,
          hasConsensusEstimates,
          ...(note ? { _note: note } : {}),
          ...(warning ? { _dataQualityWarning: warning } : {}),
        },
        urls,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return formatToolResult({ ...base, _error: message }, []);
    }
  },
});
