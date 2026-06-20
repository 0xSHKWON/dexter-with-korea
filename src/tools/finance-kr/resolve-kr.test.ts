import { describe, it, expect, mock, beforeEach, afterAll } from 'bun:test';

// Import the REAL modules first: we keep pickBestNaverMatch real (pure, tested below)
// and only override the three functions resolve-kr depends on. mock.module is applied
// BEFORE importing resolve-kr so it binds to the mocked deps; mock.restore() in afterAll
// prevents the override from leaking into other test files.
const realNaver = await import('./naver-api.js');
const realRegistry = await import('../../data/ticker-registry.js');

const resolveTicker = mock(async (_t: string): Promise<any> => null);
const resolveCorpName = mock(async (_n: string): Promise<any> => null);
const fetchNaverAutocomplete = mock(async (_q: string): Promise<any> => null);

mock.module('../../data/ticker-registry.js', () => ({ ...realRegistry, resolveTicker, resolveCorpName }));
mock.module('./naver-api.js', () => ({ ...realNaver, fetchNaverAutocomplete }));

const { resolveKrSecurity } = await import('./resolve-kr.js');
const { pickBestNaverMatch } = realNaver;

afterAll(() => mock.restore());

beforeEach(() => {
  for (const m of [resolveTicker, resolveCorpName, fetchNaverAutocomplete]) m.mockReset();
  resolveTicker.mockImplementation(async () => null);
  resolveCorpName.mockImplementation(async () => null);
  fetchNaverAutocomplete.mockImplementation(async () => null);
});

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
  it('returns null for empty / whitespace input (no registry/network call)', async () => {
    expect(await resolveKrSecurity('')).toBeNull();
    expect(await resolveKrSecurity('   ')).toBeNull();
    expect(resolveTicker).not.toHaveBeenCalled();
    expect(fetchNaverAutocomplete).not.toHaveBeenCalled();
  });

  it('6-digit: passes through and enriches corp_code from the registry', async () => {
    resolveTicker.mockImplementation(async () => ({ corp_code: '00126380', corp_name: '삼성전자' }));
    const r = await resolveKrSecurity('005930');
    expect(r).toEqual({ stockCode: '005930', corpCode: '00126380', name: '삼성전자', market: null, source: 'ticker' });
    expect(resolveCorpName).not.toHaveBeenCalled(); // 6-digit never hits the name path
    expect(fetchNaverAutocomplete).not.toHaveBeenCalled();
  });

  it('6-digit: still resolves stockCode when the registry is unavailable (keyless tier)', async () => {
    resolveTicker.mockImplementation(async () => {
      throw new Error('[DART corpCode] DART_API_KEY not set');
    });
    const r = await resolveKrSecurity('000660');
    expect(r?.stockCode).toBe('000660');
    expect(r?.corpCode).toBeNull();
    expect(r?.source).toBe('ticker');
  });

  it('name → DART registry hit wins (authoritative corp_code), no Naver call', async () => {
    resolveCorpName.mockImplementation(async () => ({ corp_code: '00164742', corp_name: '고려아연', stock_code: '010130' }));
    const r = await resolveKrSecurity('고려아연');
    expect(r).toEqual({ stockCode: '010130', corpCode: '00164742', name: '고려아연', market: null, source: 'registry-name' });
    expect(fetchNaverAutocomplete).not.toHaveBeenCalled();
  });

  it('name → falls back to keyless Naver when the registry misses', async () => {
    resolveCorpName.mockImplementation(async () => null);
    fetchNaverAutocomplete.mockImplementation(async () => ({ code: '034020', name: '두산에너빌리티', market: 'KOSPI' }));
    const r = await resolveKrSecurity('두산에너빌리티');
    expect(r?.stockCode).toBe('034020');
    expect(r?.market).toBe('KOSPI');
    expect(r?.source).toBe('naver-name');
    expect(fetchNaverAutocomplete).toHaveBeenCalledTimes(1);
  });

  it('name → falls back to Naver even when the registry THROWS (no DART key)', async () => {
    resolveCorpName.mockImplementation(async () => {
      throw new Error('[DART corpCode] DART_API_KEY not set');
    });
    fetchNaverAutocomplete.mockImplementation(async () => ({ code: '034020', name: '두산에너빌리티', market: 'KOSPI' }));
    const r = await resolveKrSecurity('두산에너빌리티');
    expect(r?.source).toBe('naver-name');
    expect(r?.stockCode).toBe('034020');
  });

  it('name → null when both the registry and Naver miss', async () => {
    resolveCorpName.mockImplementation(async () => null);
    fetchNaverAutocomplete.mockImplementation(async () => null);
    expect(await resolveKrSecurity('존재하지않는회사명xyz')).toBeNull();
  });

  it('ignores a registry hit whose stock_code is not a 6-digit listing (unlisted) → Naver', async () => {
    resolveCorpName.mockImplementation(async () => ({ corp_code: '00999999', corp_name: '비상장사', stock_code: null }));
    fetchNaverAutocomplete.mockImplementation(async () => ({ code: '034020', name: '두산에너빌리티', market: 'KOSPI' }));
    const r = await resolveKrSecurity('비상장사');
    expect(r?.source).toBe('naver-name');
  });
});
