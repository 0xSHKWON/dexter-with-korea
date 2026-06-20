import { describe, it, expect } from 'bun:test';
import { mapShortBalanceRow, defaultRange } from './get-short-balance-kr.js';

describe('mapShortBalanceRow', () => {
  it('maps and numeric-parses a MDCSTAT30502 row (date → ISO)', () => {
    const row = {
      RPT_DUTY_OCCR_DD: '2020/01/10',
      BAL_QTY: '5,489,240',
      LIST_SHRS: '5,969,782,550',
      BAL_AMT: '326,609,780,000',
      MKTCAP: '355,202,061,725,000',
      BAL_RTO: '0.09',
    };
    expect(mapShortBalanceRow(row)).toEqual({
      date: '2020-01-10',
      balanceQty: 5489240,
      listedShares: 5969782550,
      balanceAmount: 326609780000,
      marketCap: 355202061725000,
      balanceRatio: 0.09,
    });
  });

  it('tolerates missing fields', () => {
    expect(mapShortBalanceRow({ RPT_DUTY_OCCR_DD: '2020/01/10' })).toEqual({
      date: '2020-01-10',
      balanceQty: null,
      listedShares: null,
      balanceAmount: null,
      marketCap: null,
      balanceRatio: null,
    });
  });
});

describe('defaultRange', () => {
  it('passes through an explicit start and end', () => {
    expect(defaultRange('2026-01-01', '2026-02-01')).toEqual({
      startDate: '2026-01-01',
      endDate: '2026-02-01',
    });
  });

  it('computes a ~30-day window before the given end', () => {
    expect(defaultRange(undefined, '2026-02-01')).toEqual({
      startDate: '2026-01-02',
      endDate: '2026-02-01',
    });
  });
});
