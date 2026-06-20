import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { dexterPath } from '../utils/paths.js';
import { _resetTickerRegistryForTests, resolveTicker, resolveCorpName } from './ticker-registry.js';

const REGISTRY_FILE = dexterPath('cache', 'dart', 'corp-codes.json');

function seedRegistry(fetchedAt: string): void {
  const dir = dirname(REGISTRY_FILE);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(
    REGISTRY_FILE,
    JSON.stringify({
      fetchedAt,
      entries: [
        { corp_code: '00126380', corp_name: '삼성전자', stock_code: '005930', modify_date: '20231201' },
        { corp_code: '00164779', corp_name: 'SK하이닉스', stock_code: '000660', modify_date: '20231115' },
        { corp_code: '00999999', corp_name: '비상장회사', stock_code: null, modify_date: '20231101' },
      ],
    }),
  );
}

describe('ticker-registry', () => {
  beforeEach(() => {
    _resetTickerRegistryForTests();
    if (existsSync(REGISTRY_FILE)) rmSync(REGISTRY_FILE);
  });

  afterEach(() => {
    _resetTickerRegistryForTests();
    if (existsSync(REGISTRY_FILE)) rmSync(REGISTRY_FILE);
  });

  test('resolves 6-digit ticker from fresh on-disk cache', async () => {
    seedRegistry(new Date().toISOString());
    const result = await resolveTicker('005930');
    expect(result).toEqual({ corp_code: '00126380', corp_name: '삼성전자' });
  });

  test('returns null for non-6-digit input', async () => {
    seedRegistry(new Date().toISOString());
    expect(await resolveTicker('AAPL')).toBeNull();
    expect(await resolveTicker('5930')).toBeNull();
    expect(await resolveTicker('0059301')).toBeNull();
  });

  test('returns null when ticker not in registry', async () => {
    seedRegistry(new Date().toISOString());
    expect(await resolveTicker('999999')).toBeNull();
  });

  test('resolveCorpName matches by exact Korean name', async () => {
    seedRegistry(new Date().toISOString());
    const result = await resolveCorpName('SK하이닉스');
    expect(result?.corp_code).toBe('00164779');
    expect(result?.stock_code).toBe('000660');
  });

  test('falls back to stale cache if refresh fails (no DART_API_KEY)', async () => {
    // Stale by setting fetchedAt to 30 days ago
    seedRegistry(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString());
    const originalKey = process.env.DART_API_KEY;
    delete process.env.DART_API_KEY;
    try {
      const result = await resolveTicker('005930');
      expect(result?.corp_code).toBe('00126380');
    } finally {
      if (originalKey !== undefined) process.env.DART_API_KEY = originalKey;
    }
  });
});
