import { describe, it, expect } from 'bun:test';
import { pickBestNaverMatch } from './naver-api.js';
import { resolveKrSecurity } from './resolve-kr.js';

// Captured from the live ac.stock.naver.com response for "삼성전자": the canonical
// listing first, then leveraged/mixed ETFs that merely contain the name in their title.
const SAMSUNG_ITEMS = [
  { code: '005930', name: '삼성전자', typeCode: 'KOSPI', nationCode: 'KOR', category: 'stock' },
  { code: '0162Z0', name: 'RISE 삼성전자SK하이닉스채권혼합50', typeCode: 'KOSPI', nationCode: 'KOR', category: 'stock' },
  { code: '0193W0', name: 'KODEX 삼성전자단일종목레버리지', typeCode: 'KOSPI', nationCode: 'KOR', category: 'stock' },
];

describe('pickBestNaverMatch', () => {
  it('picks the 6-digit-numeric equity and drops alphanumeric ETF codes', () => {
    const hit = pickBestNaverMatch(SAMSUNG_ITEMS, '삼성전자');
    expect(hit).not.toBeNull();
    expect(hit?.code).toBe('005930');
    expect(hit?.market).toBe('KOSPI');
  });

  it('prefers an exact whitespace-insensitive name hit over autocomplete order', () => {
    const items = [
      { code: '000661', name: 'SK하이닉스우', typeCode: 'KOSPI', nationCode: 'KOR', category: 'stock' },
      { code: '000660', name: 'SK 하이닉스', typeCode: 'KOSPI', nationCode: 'KOR', category: 'stock' },
    ];
    expect(pickBestNaverMatch(items, 'SK하이닉스')?.code).toBe('000660');
  });

  it('returns null when no domestic-equity candidate survives', () => {
    expect(pickBestNaverMatch([{ code: 'AAPL', name: 'Apple', nationCode: 'USA', category: 'stock' }], 'apple')).toBeNull();
    expect(pickBestNaverMatch([], '없는회사')).toBeNull();
    expect(pickBestNaverMatch(null, 'x')).toBeNull();
  });
});

describe('resolveKrSecurity', () => {
  // Empty/whitespace short-circuits BEFORE any registry/network call — the only
  // resolveKrSecurity branch that's pure. The 6-digit-passthrough and name paths read
  // the DART corp registry (a ~12MB on-disk cache when a key is configured) and/or call
  // Naver, so they're covered by the live probe in CLAUDE notes, not this unit suite —
  // exercising them here cold-loads 12MB and destabilizes the parallel test run.
  it('returns null for empty / whitespace input', async () => {
    expect(await resolveKrSecurity('')).toBeNull();
    expect(await resolveKrSecurity('   ')).toBeNull();
  });
});
