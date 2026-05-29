import { describe, it, expect } from 'bun:test';
import { mapShortBalanceRow } from './get-short-balance-kr.js';

describe('mapShortBalanceRow', () => {
  it('maps and numeric-parses a MDCSTAT30502 row', () => {
    const row = {
      RPT_DUTY_OCCR_DD: '2020/01/10',
      BAL_QTY: '5,489,240',
      LIST_SHRS: '5,969,782,550',
      BAL_AMT: '326,609,780,000',
      MKTCAP: '355,202,061,725,000',
      BAL_RTO: '0.09',
    };
    expect(mapShortBalanceRow(row)).toEqual({
      date: '2020/01/10',
      balanceQty: 5489240,
      listedShares: 5969782550,
      balanceAmount: 326609780000,
      marketCap: 355202061725000,
      balanceRatio: 0.09,
    });
  });

  it('tolerates missing fields', () => {
    expect(mapShortBalanceRow({ RPT_DUTY_OCCR_DD: '2020/01/10' })).toEqual({
      date: '2020/01/10',
      balanceQty: null,
      listedShares: null,
      balanceAmount: null,
      marketCap: null,
      balanceRatio: null,
    });
  });
});
