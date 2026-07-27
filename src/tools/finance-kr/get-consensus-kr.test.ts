import { describe, it, expect } from 'bun:test';
import { parseNaverFinance, assessConsensus, METRIC_UNITS } from './get-consensus-kr.js';
import type { ConsensusPeriod } from './get-consensus-kr.js';

/** Trimmed live shape from m.stock.naver.com/api/stock/005930/finance/annual (2026-07). */
const PAYLOAD = {
  itemCode: '005930',
  financePeriodType: 'annual',
  financeInfo: {
    itemCode: '005930',
    trTitleList: [
      { isConsensus: 'N', title: '2024.12.', key: '202412' },
      { isConsensus: 'N', title: '2025.12.', key: '202512' },
      { isConsensus: 'Y', title: '2026.12.', key: '202612' },
    ],
    rowList: [
      {
        title: '매출액',
        columns: {
          '202512': { value: '3,336,059', cx: null },
          '202612': { value: '7,324,732', cx: null },
          '202412': { value: '3,008,709', cx: null },
        },
      },
      {
        title: '영업이익',
        columns: {
          '202512': { value: '436,011', cx: null },
          '202612': { value: '3,832,404', cx: null },
          '202412': { value: '327,260', cx: null },
        },
      },
      {
        title: '지배주주순이익',
        columns: {
          '202512': { value: '442,610', cx: null },
          '202612': { value: '-', cx: null },
          '202412': { value: '336,214', cx: null },
        },
      },
      {
        title: 'EPS',
        columns: {
          '202512': { value: '6,564', cx: null },
          '202612': { value: '46,664', cx: null },
          '202412': { value: '4,950', cx: null },
        },
      },
    ],
  },
};

describe('parseNaverFinance', () => {
  it('parses periods ascending with consensus flags and mapped numeric metrics', () => {
    const periods = parseNaverFinance(PAYLOAD as never);
    expect(periods.map((p) => p.period)).toEqual(['2024.12', '2025.12', '2026.12']);
    expect(periods.map((p) => p.isConsensusEstimate)).toEqual([false, false, true]);

    const actual2024 = periods[0];
    expect(actual2024.metrics.revenue).toBe(3008709);
    expect(actual2024.metrics.operatingProfit).toBe(327260);
    expect(actual2024.metrics.netProfitControlling).toBe(336214);
    expect(actual2024.metrics.eps).toBe(4950);

    // "-" placeholders (metrics analysts don't estimate) parse to null, not 0.
    const estimate2026 = periods[2];
    expect(estimate2026.isConsensusEstimate).toBe(true);
    expect(estimate2026.metrics.revenue).toBe(7324732);
    expect(estimate2026.metrics.netProfitControlling).toBeNull();
  });

  it('passes unmapped row titles through verbatim so upstream additions surface', () => {
    const payload = {
      financeInfo: {
        trTitleList: [{ isConsensus: 'N', title: '2025.12.', key: '202512' }],
        rowList: [{ title: '신규지표', columns: { '202512': { value: '1,234' } } }],
      },
    };
    const periods = parseNaverFinance(payload as never);
    expect(periods[0].metrics['신규지표']).toBe(1234);
    expect('신규지표' in METRIC_UNITS).toBe(false);
  });

  it('returns [] for a null/malformed payload instead of throwing', () => {
    expect(parseNaverFinance(null)).toEqual([]);
    expect(parseNaverFinance({} as never)).toEqual([]);
    expect(parseNaverFinance({ financeInfo: { trTitleList: 'oops', rowList: null } } as never)).toEqual([]);
  });
});

describe('assessConsensus', () => {
  const period = (over?: Partial<ConsensusPeriod>): ConsensusPeriod => ({
    period: '2025.12',
    key: '202512',
    isConsensusEstimate: false,
    metrics: { revenue: 100, operatingProfit: 10, netProfit: 8 },
    ...over,
  });

  it('healthy blocks with an estimate → no warning, no note', () => {
    const a = assessConsensus([[period(), period({ key: '202612', isConsensusEstimate: true })]]);
    expect(a).toEqual({ hasConsensusEstimates: true, warning: null, note: null });
  });

  it('periods parsed but none is an estimate → genuine no-coverage note, no warning', () => {
    const a = assessConsensus([[period(), period({ key: '202412' })]]);
    expect(a.hasConsensusEstimates).toBe(false);
    expect(a.warning).toBeNull();
    expect(a.note).toContain('커버리지 부재');
  });

  it('an EMPTY block (null/drifted payload) → upstream-drift warning, NOT a no-coverage note', () => {
    const a = assessConsensus([[]]);
    expect(a.warning).toContain('단정하지 마세요');
    expect(a.note).toBeNull();
  });

  it("period='both' with one empty block still warns (partial drift)", () => {
    const a = assessConsensus([[period({ isConsensusEstimate: true })], []]);
    expect(a.hasConsensusEstimates).toBe(true);
    expect(a.warning).toContain('파싱하지 못했습니다');
    expect(a.note).toBeNull();
  });

  it('periods present but no known metric mapped → rename-drift warning', () => {
    const a = assessConsensus([[period({ metrics: { 신규지표: 1 } })]]);
    expect(a.warning).toContain('매핑되지 않았습니다');
    expect(a.note).toBeNull();
  });

  it('PARTIAL rename (one core column dead across all periods, siblings healthy) → drift warning names the column', () => {
    // Simulates Naver renaming 매출액 → 매출: 'revenue' vanishes from every period
    // while operatingProfit/netProfit keep mapping. The old all-or-nothing canary
    // missed exactly this case.
    const dropRevenue = { operatingProfit: 10, netProfit: 8, 매출: 100 };
    const a = assessConsensus([[
      period({ metrics: { ...dropRevenue } }),
      period({ key: '202412', metrics: { ...dropRevenue } }),
    ]]);
    expect(a.warning).toContain('revenue');
    expect(a.warning).toContain('rename');
    expect(a.note).toBeNull();
  });

  it('a genuinely null core value in SOME periods (estimate "-") does not trip the canary', () => {
    const a = assessConsensus([[
      period(),
      period({ key: '202612', isConsensusEstimate: true, metrics: { revenue: 200, operatingProfit: null, netProfit: null } }),
    ]]);
    expect(a.warning).toBeNull();
  });
});
