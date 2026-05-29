import { describe, it, expect } from 'bun:test';
import {
  toDartDate,
  sortByRceptDtDesc,
  isNoDataError,
  parseKrxNumber,
  extractOutBlock,
} from './utils.js';

describe('toDartDate', () => {
  it('strips dashes from an ISO date', () => {
    expect(toDartDate('2024-03-15')).toBe('20240315');
  });
});

describe('sortByRceptDtDesc', () => {
  it('orders by rcept_dt descending and caps to limit', () => {
    const list = [
      { rcept_dt: '20230101', id: 'a' },
      { rcept_dt: '20240601', id: 'b' },
      { rcept_dt: '20240105', id: 'c' },
    ];
    const result = sortByRceptDtDesc(list, 2);
    expect(result.map((r) => r.id)).toEqual(['b', 'c']);
  });

  it('does not mutate the input array', () => {
    const list = [{ rcept_dt: '20230101' }, { rcept_dt: '20240601' }];
    sortByRceptDtDesc(list, 10);
    expect(list[0].rcept_dt).toBe('20230101');
  });

  it('tolerates missing rcept_dt', () => {
    const list = [{ rcept_dt: '20240101' }, {}];
    expect(sortByRceptDtDesc(list, 10)).toHaveLength(2);
  });
});

describe('isNoDataError', () => {
  it('detects DART status 013 (no data)', () => {
    expect(isNoDataError('[DART API] foo — status=013 (조회된 데이타가 없습니다)')).toBe(true);
  });

  it('returns false for other errors', () => {
    expect(isNoDataError('[DART API] foo — status=020 (사용한도초과)')).toBe(false);
  });
});

describe('parseKrxNumber', () => {
  it('strips comma grouping', () => {
    expect(parseKrxNumber('5,489,240')).toBe(5489240);
  });

  it('strips a leading sign and a trailing percent', () => {
    expect(parseKrxNumber('+5,314,304')).toBe(5314304);
    expect(parseKrxNumber('48.27%')).toBe(48.27);
  });

  it('treats blanks and the "-" placeholder as null', () => {
    expect(parseKrxNumber('')).toBeNull();
    expect(parseKrxNumber('-')).toBeNull();
    expect(parseKrxNumber(null)).toBeNull();
    expect(parseKrxNumber(undefined)).toBeNull();
  });

  it('passes through plain numbers', () => {
    expect(parseKrxNumber(0.09)).toBe(0.09);
  });
});

describe('extractOutBlock', () => {
  it('returns the array under the default key', () => {
    expect(extractOutBlock({ OutBlock_1: [{ a: 1 }] })).toEqual([{ a: 1 }]);
  });

  it('returns [] when the block is missing or not an array', () => {
    expect(extractOutBlock({})).toEqual([]);
    expect(extractOutBlock(null)).toEqual([]);
    expect(extractOutBlock({ OutBlock_1: 'nope' })).toEqual([]);
  });
});
