import { describe, it, expect } from 'bun:test';
import { mapForeignRow } from './get-foreign-ownership-kr.js';
import { deadColumns } from './utils.js';

describe('mapForeignRow', () => {
  it('maps and numeric-parses a Naver trend row', () => {
    const row = {
      bizdate: '20260529',
      foreignerHoldRatio: '48.27%',
      foreignerPureBuyQuant: '-1,061,741',
      organPureBuyQuant: '+5,314,304',
      individualPureBuyQuant: '-4,237,361',
      closePrice: '317,000',
      accumulatedTradingVolume: '32,804,208',
    };
    expect(mapForeignRow(row)).toEqual({
      date: '2026-05-29',
      foreignHoldRatio: 48.27,
      foreignNetBuyQty: -1061741,
      orgNetBuyQty: 5314304,
      individualNetBuyQty: -4237361,
      closePrice: 317000,
      tradingVolume: 32804208,
    });
  });
});

describe('foreign-ownership partial-drift canary', () => {
  // Mirrors the caller's structural column set (get-foreign-ownership-kr.ts).
  const COLS: Array<keyof ReturnType<typeof mapForeignRow>> = [
    'foreignHoldRatio',
    'foreignNetBuyQty',
    'orgNetBuyQty',
    'individualNetBuyQty',
    'closePrice',
    'tradingVolume',
  ];

  it('flags foreignHoldRatio dead when Naver renames foreignerHoldRatio (rows still non-empty)', () => {
    // Simulate the rename: foreignerHoldRatio is gone; every other field still maps.
    const drifted = [
      { bizdate: '20260529', foreignerPureBuyQuant: '-1,000', organPureBuyQuant: '+2,000', individualPureBuyQuant: '-1,000', closePrice: '317,000', accumulatedTradingVolume: '100' },
      { bizdate: '20260528', foreignerPureBuyQuant: '+500', organPureBuyQuant: '-500', individualPureBuyQuant: '0', closePrice: '315,000', accumulatedTradingVolume: '200' },
      { bizdate: '20260527', foreignerPureBuyQuant: '0', organPureBuyQuant: '0', individualPureBuyQuant: '0', closePrice: '316,000', accumulatedTradingVolume: '150' },
    ].map(mapForeignRow);
    expect(drifted.length).toBeGreaterThanOrEqual(3); // not a "no data" / single-row case
    expect(deadColumns(drifted, COLS)).toEqual(['foreignHoldRatio']);
  });

  it('flags nothing for healthy rows (zeros parse to 0, not null)', () => {
    const healthy = [
      { bizdate: '20260529', foreignerHoldRatio: '48.27%', foreignerPureBuyQuant: '-1,061,741', organPureBuyQuant: '+5,314,304', individualPureBuyQuant: '-4,237,361', closePrice: '317,000', accumulatedTradingVolume: '32,804,208' },
      { bizdate: '20260528', foreignerHoldRatio: '48.30%', foreignerPureBuyQuant: '0', organPureBuyQuant: '0', individualPureBuyQuant: '0', closePrice: '316,000', accumulatedTradingVolume: '0' },
    ].map(mapForeignRow);
    expect(deadColumns(healthy, COLS)).toEqual([]);
  });
});
