import { describe, it, expect } from 'bun:test';
import { mapForeignRow } from './get-foreign-ownership-kr.js';

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
      date: '20260529',
      foreignHoldRatio: 48.27,
      foreignNetBuyQty: -1061741,
      orgNetBuyQty: 5314304,
      individualNetBuyQty: -4237361,
      closePrice: 317000,
      tradingVolume: 32804208,
    });
  });
});
