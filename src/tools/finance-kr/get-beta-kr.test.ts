import { describe, it, expect } from 'bun:test';
import { marketToIndex } from './get-beta-kr.js';

describe('marketToIndex', () => {
  it('maps KOSDAQ-bearing market strings to KOSDAQ', () => {
    expect(marketToIndex('KOSDAQ')).toBe('KOSDAQ');
    expect(marketToIndex('kosdaq')).toBe('KOSDAQ');
    expect(marketToIndex('KOSDAQ GLOBAL')).toBe('KOSDAQ');
  });

  it('defaults everything else (KOSPI, KONEX, null, unknown) to KOSPI', () => {
    expect(marketToIndex('KOSPI')).toBe('KOSPI');
    expect(marketToIndex('KONEX')).toBe('KOSPI');
    expect(marketToIndex(null)).toBe('KOSPI');
    expect(marketToIndex('')).toBe('KOSPI');
  });
});
