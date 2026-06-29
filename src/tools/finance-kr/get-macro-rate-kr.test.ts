import { describe, it, expect } from 'bun:test';
import { ECOS_SERIES, parseEcosResponse } from '../../data/fetchers/ecos.js';
import { getMacroRateKr } from './get-macro-rate-kr.js';

const SPEC = ECOS_SERIES.treasury_10y;

function successBody(rows: Array<{ TIME: string; DATA_VALUE: string }>) {
  return {
    StatisticSearch: {
      list_total_count: rows.length,
      row: rows.map((r) => ({
        STAT_CODE: '817Y002',
        STAT_NAME: '1.3.1. 시장금리(일별)',
        ITEM_CODE1: '010210000',
        ITEM_NAME1: '국고채(10년)',
        UNIT_NAME: '연%',
        ...r,
      })),
    },
  };
}

describe('parseEcosResponse', () => {
  it('sorts ascending, drops blank prints, and picks the right metadata', () => {
    const body = successBody([
      { TIME: '20240115', DATA_VALUE: '3.45' },
      { TIME: '20240117', DATA_VALUE: '3.50' },
      { TIME: '20240116', DATA_VALUE: '-' }, // placeholder → filtered
    ]);
    const res = parseEcosResponse('treasury_10y', SPEC, body);
    expect(res.rows).toEqual([
      { date: '2024-01-15', value: 3.45 },
      { date: '2024-01-17', value: 3.5 },
    ]);
    expect(res.unit).toBe('연%');
    expect(res.itemName).toBe('국고채(10년)');
    expect(res.statCode).toBe('817Y002');
  });

  it('throws on the ECOS RESULT envelope (no-data INFO-200)', () => {
    const body = { RESULT: { CODE: 'INFO-200', MESSAGE: '해당하는 데이터가 없습니다.' } };
    expect(() => parseEcosResponse('treasury_10y', SPEC, body)).toThrow('INFO-200');
  });

  it('throws on the ECOS auth error (INFO-100) instead of returning empty', () => {
    const body = { RESULT: { CODE: 'INFO-100', MESSAGE: '인증키가 유효하지 않습니다.' } };
    expect(() => parseEcosResponse('treasury_10y', SPEC, body)).toThrow('INFO-100');
  });

  it('returns an empty series (no throw) when the payload has no rows', () => {
    const res = parseEcosResponse('treasury_10y', SPEC, {});
    expect(res.rows).toEqual([]);
  });
});

describe('ECOS_SERIES codes', () => {
  it('every series has a well-formed stat code and numeric item code', () => {
    for (const [key, spec] of Object.entries(ECOS_SERIES)) {
      expect(spec.statCode, key).toMatch(/^\d{3}Y\d{3}$/);
      expect(spec.itemCode, key).toMatch(/^\d+$/);
      expect(['D', 'M']).toContain(spec.cycle);
    }
  });
});

describe('get_macro_rate_kr tool', () => {
  it('returns a structured _error (not a throw) when ECOS_API_KEY is unset', async () => {
    const saved = process.env.ECOS_API_KEY;
    delete process.env.ECOS_API_KEY;
    try {
      const out = await getMacroRateKr.invoke({ series: 'treasury_10y', recent: 5 });
      const parsed = JSON.parse(out);
      expect(parsed.data.latest).toBeNull();
      expect(parsed.data._error).toContain('ECOS_API_KEY not set');
    } finally {
      if (saved !== undefined) process.env.ECOS_API_KEY = saved;
    }
  });
});
