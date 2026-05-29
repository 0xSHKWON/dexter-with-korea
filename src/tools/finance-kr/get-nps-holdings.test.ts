import { describe, it, expect } from 'bun:test';
import { matchByName } from './get-nps-holdings.js';
import type { NpsHoldingEntry } from '../../data/fetchers/nps-holdings.js';

const ENTRIES: NpsHoldingEntry[] = [
  { name: '삼성전자', evalAmount: 350000, weightPct: 25, shareRatioPct: 7.5 },
  { name: '삼성전자우', evalAmount: 20000, weightPct: 1.5, shareRatioPct: 5.1 },
  { name: 'NAVER', evalAmount: 30000, weightPct: 2, shareRatioPct: 8.2 },
];

describe('matchByName', () => {
  it('matches whitespace-insensitively and either-contains', () => {
    const matches = matchByName(ENTRIES, '삼성전자');
    // Both 삼성전자 and 삼성전자우 contain the target.
    expect(matches.map((m) => m.name)).toEqual(['삼성전자', '삼성전자우']);
  });

  it('matches when the entry name is contained in the query', () => {
    expect(matchByName(ENTRIES, 'NAVER Corp').map((m) => m.name)).toEqual(['NAVER']);
  });

  it('returns [] for an empty target', () => {
    expect(matchByName(ENTRIES, '   ')).toEqual([]);
  });
});
