import { describe, it, expect } from 'bun:test';
import { mapChartRow, parseChartRows } from './naver-price-history.js';

describe('mapChartRow', () => {
  it('maps a Naver chart row to an ISO-dated PriceBar', () => {
    expect(
      mapChartRow({
        localDate: '20240102',
        closePrice: 79600.0,
        openPrice: 78200.0,
        highPrice: 79800.0,
        lowPrice: 78200.0,
        accumulatedTradingVolume: 17142847,
        foreignRetentionRate: 54.05,
      }),
    ).toEqual({ date: '2024-01-02', close: 79600, open: 78200, high: 79800, low: 78200, volume: 17142847 });
  });

  it('drops a row with no usable close', () => {
    expect(mapChartRow({ localDate: '20240102', closePrice: '-' })).toBeNull();
    expect(mapChartRow({ localDate: '', closePrice: 100 })).toBeNull();
  });
});

describe('parseChartRows', () => {
  it('sorts ascending by date and skips bad rows', () => {
    const bars = parseChartRows([
      { localDate: '20240105', closePrice: 105 },
      { localDate: '20240102', closePrice: 102 },
      { localDate: '20240103', closePrice: null }, // dropped
    ]);
    expect(bars.map((b) => b.date)).toEqual(['2024-01-02', '2024-01-05']);
  });

  it('returns [] for a non-array payload', () => {
    expect(parseChartRows({ error: 'nope' })).toEqual([]);
    expect(parseChartRows(null)).toEqual([]);
  });
});
