import { describe, it, expect } from 'bun:test';
import { mapMarketData, parseKoreanMarketCapToKRW, hasNoMarketData } from './get-market-data-kr.js';
import { parseNaverMetric } from './utils.js';

// Shape captured from m.stock.naver.com/api/stock/005930/integration.
const SAMSUNG_RAW = {
  itemCode: '005930',
  stockName: '삼성전자',
  totalInfos: [
    { code: 'lastClosePrice', key: '전일', value: '349,000' },
    { code: 'openPrice', key: '시가', value: '356,000' },
    { code: 'highPrice', key: '고가', value: '377,000' },
    { code: 'lowPrice', key: '저가', value: '342,000' },
    { code: 'accumulatedTradingVolume', key: '거래량', value: '55,130,555' },
    { code: 'marketValue', key: '시총', value: '2,075조 4,289억' },
    { code: 'foreignRate', key: '외인소진율', value: '48.30%' },
    { code: 'highPriceOf52Weeks', key: '52주 최고', value: '377,000' },
    { code: 'lowPriceOf52Weeks', key: '52주 최저', value: '56,800' },
    { code: 'per', key: 'PER', value: '28.69배' },
    { code: 'eps', key: 'EPS', value: '12,372원' },
    { code: 'cnsPer', key: '추정PER', value: '8.24배' },
    { code: 'cnsEps', key: '추정EPS', value: '43,098원' },
    { code: 'pbr', key: 'PBR', value: '4.94배' },
    { code: 'bps', key: 'BPS', value: '71,907원' },
    { code: 'dividendYieldRatio', key: '배당수익률', value: '0.47%' },
    { code: 'dividend', key: '주당배당금', value: '1,668원' },
  ],
  dealTrendInfos: [
    {
      bizdate: '20260601',
      closePrice: '349,000',
      compareToPreviousClosePrice: '32,000',
      compareToPreviousPrice: { code: '2', text: '상승', name: 'RISING' },
      accumulatedTradingVolume: '45,052,488',
    },
  ],
  consensusInfo: { itemCode: '005930', createDate: '2026-06-01', recommMean: '4.04', priceTargetMean: '401,250' },
  industryCompareInfo: [
    { itemCode: '000660', stockName: 'SK하이닉스', closePrice: '2,327,000', fluctuationsRatio: '-1.52', marketValue: '1,658,458,403' },
  ],
};

describe('parseNaverMetric', () => {
  it('strips 배/원/% suffixes and comma grouping', () => {
    expect(parseNaverMetric('28.69배')).toBe(28.69);
    expect(parseNaverMetric('12,372원')).toBe(12372);
    expect(parseNaverMetric('0.47%')).toBe(0.47);
    expect(parseNaverMetric('401,250')).toBe(401250);
    expect(parseNaverMetric('-1.52')).toBe(-1.52);
    expect(parseNaverMetric('+5.5%')).toBe(5.5);
    // 주 is a Naver label-key char (52주, 주당배당금), never a value unit; a value
    // carrying it is treated as non-numeric rather than silently stripped to a number.
    expect(parseNaverMetric('1,668주')).toBeNull();
    expect(parseNaverMetric('n/a')).toBeNull();
    expect(parseNaverMetric('N/A')).toBeNull();
    expect(parseNaverMetric('-')).toBeNull();
    expect(parseNaverMetric('')).toBeNull();
    expect(parseNaverMetric(null)).toBeNull();
    expect(parseNaverMetric(undefined)).toBeNull();
  });
});

describe('parseKoreanMarketCapToKRW', () => {
  it('parses 조/억 market cap to KRW', () => {
    expect(parseKoreanMarketCapToKRW('2,075조 4,289억')).toBe(2_075_428_900_000_000);
    expect(parseKoreanMarketCapToKRW('4,289억')).toBe(428_900_000_000);
    expect(parseKoreanMarketCapToKRW('1조')).toBe(1_000_000_000_000);
  });

  it('returns null for a unit-less number (never misscales a bare value)', () => {
    expect(parseKoreanMarketCapToKRW('1,658,458,403')).toBeNull();
    expect(parseKoreanMarketCapToKRW('')).toBeNull();
    expect(parseKoreanMarketCapToKRW(null)).toBeNull();
  });
});

describe('mapMarketData', () => {
  const m = mapMarketData('005930', SAMSUNG_RAW as Record<string, unknown>);

  it('maps the latest quote with computed daily change %', () => {
    expect(m.name).toBe('삼성전자');
    expect(m.quote).toEqual({
      date: '2026-06-01',
      price: 349000,
      change: 32000,
      changePct: 10.09, // 32000 / (349000 - 32000)
      direction: '상승',
      open: 356000,
      high: 377000,
      low: 342000,
      high52w: 377000,
      low52w: 56800,
      volume: 45052488,
    });
  });

  it('maps valuation and derives shares outstanding from market cap / price', () => {
    expect(m.valuation.marketCap).toBe(2_075_428_900_000_000);
    expect(m.valuation.marketCapDisplay).toBe('2,075조 4,289억');
    expect(m.valuation.sharesOutstanding).toBe(5_946_787_679);
    expect(m.valuation.per).toBe(28.69);
    expect(m.valuation.pbr).toBe(4.94);
    expect(m.valuation.eps).toBe(12372);
    expect(m.valuation.bps).toBe(71907);
    expect(m.valuation.forwardPer).toBe(8.24);
    expect(m.valuation.forwardEps).toBe(43098);
    expect(m.valuation.dividendYieldPct).toBe(0.47);
    expect(m.valuation.dividendPerShare).toBe(1668);
  });

  it('maps consensus with implied upside to target', () => {
    expect(m.consensus).toEqual({
      date: '2026-06-01',
      targetPrice: 401250,
      recommendationMean: 4.04,
      upsidePct: 14.97, // (401250 - 349000) / 349000
    });
  });

  it('maps peers with market cap converted from 백만 to KRW', () => {
    expect(m.peers).toEqual([
      { ticker: '000660', name: 'SK하이닉스', price: 2327000, changePct: -1.52, marketCap: 1_658_458_403_000_000 },
    ]);
  });

  it('degrades gracefully on an empty payload', () => {
    const empty = mapMarketData('005930', null);
    expect(empty.name).toBeNull();
    expect(empty.quote.price).toBeNull();
    expect(empty.valuation.marketCap).toBeNull();
    expect(empty.valuation.sharesOutstanding).toBeNull();
    expect(empty.consensus.targetPrice).toBeNull();
    expect(empty.peers).toEqual([]);
  });
});

describe('hasNoMarketData', () => {
  it('flags an all-null mapping (empty/garbage 200 payload) as not found', () => {
    expect(hasNoMarketData(mapMarketData('999999', null))).toBe(true);
    expect(hasNoMarketData(mapMarketData('999999', {} as Record<string, unknown>))).toBe(true);
  });

  it('does not false-positive on a valid ticker (stockName alone is enough)', () => {
    // A valid /integration response always carries stockName, so a real ticker
    // never trips the guard even if price/marketCap are momentarily absent.
    const sparse = mapMarketData('005930', { stockName: '삼성전자' } as Record<string, unknown>);
    expect(sparse.name).toBe('삼성전자');
    expect(hasNoMarketData(sparse)).toBe(false);
  });

  it('does not false-positive on the full Samsung payload', () => {
    expect(hasNoMarketData(mapMarketData('005930', SAMSUNG_RAW as Record<string, unknown>))).toBe(false);
  });
});
