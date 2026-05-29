import { describe, it, expect } from 'bun:test';
import { buildKrxIndex } from './krx-instrument-registry.js';
import type { KrxInstrumentEntry } from './fetchers/krx-instruments.js';

const ENTRIES: KrxInstrumentEntry[] = [
  { ticker: '005930', isin: 'KR7005930003', name: '삼성전자', market: 'KOSPI' },
  { ticker: '035420', isin: 'KR7035420009', name: 'NAVER', market: 'KOSPI' },
];

describe('buildKrxIndex', () => {
  it('indexes by ticker and by name', () => {
    const cache = buildKrxIndex(ENTRIES, 123);
    expect(cache.fetchedAt).toBe(123);
    expect(cache.byTicker.get('005930')?.isin).toBe('KR7005930003');
    expect(cache.byName.get('NAVER')?.ticker).toBe('035420');
    expect(cache.byTicker.get('999999')).toBeUndefined();
  });
});
