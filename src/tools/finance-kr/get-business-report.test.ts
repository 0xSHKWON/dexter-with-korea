import { describe, it, expect } from 'bun:test';
import { mkdtempSync, writeFileSync, readdirSync, utimesSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { pruneRawFinancialFiles, defaultYear, RAW_FILE_KEEP } from './sub-tools/get-business-report.js';

describe('defaultYear — report-type-aware', () => {
  it('annual always defaults to last year (publishes in March of N+1)', () => {
    expect(defaultYear('annual', new Date(Date.UTC(2026, 6, 1)))).toBe(2025); // July
    expect(defaultYear('annual', new Date(Date.UTC(2026, 11, 31)))).toBe(2025); // December
  });
  it('quarterly/semiannual switch to the current year once filed', () => {
    // July 2026: Q1 2026 (filed ~May) is out; 반기/Q3 2026 are not yet.
    const july = new Date(Date.UTC(2026, 6, 1));
    expect(defaultYear('quarterly_1', july)).toBe(2026);
    expect(defaultYear('semiannual', july)).toBe(2025);
    expect(defaultYear('quarterly_3', july)).toBe(2025);
    // December 2026: everything for 2026 is filed.
    const december = new Date(Date.UTC(2026, 11, 15));
    expect(defaultYear('quarterly_1', december)).toBe(2026);
    expect(defaultYear('semiannual', december)).toBe(2026);
    expect(defaultYear('quarterly_3', december)).toBe(2026);
    // March 2026: latest available quarterly is still from 2025.
    const march = new Date(Date.UTC(2026, 2, 1));
    expect(defaultYear('quarterly_3', march)).toBe(2025);
  });
  it('switches within days of the statutory deadline (period end + 45d + small buffer)', () => {
    // Q1 deadline is ~May 15 → the new quarter must be the default by late May,
    // not held back until June.
    expect(defaultYear('quarterly_1', new Date(Date.UTC(2026, 4, 25)))).toBe(2026); // May 25
    expect(defaultYear('quarterly_1', new Date(Date.UTC(2026, 4, 10)))).toBe(2025); // May 10 (pre-deadline)
    expect(defaultYear('semiannual', new Date(Date.UTC(2026, 7, 25)))).toBe(2026); // Aug 25
    expect(defaultYear('quarterly_3', new Date(Date.UTC(2026, 10, 25)))).toBe(2026); // Nov 25
  });
});

describe('pruneRawFinancialFiles', () => {
  it('keeps newest RAW_FILE_KEEP dumps, preserves call_*.txt and the current file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'kr-prune-'));
    try {
      // Agent persist (different naming) — must never be deleted.
      writeFileSync(join(dir, 'call_abc123.txt'), 'persist');

      // RAW_FILE_KEEP + 5 dumps with strictly increasing mtimes (i=0 oldest).
      const extra = 5;
      for (let i = 0; i < RAW_FILE_KEEP + extra; i++) {
        const name = `kr-financials-x${i}-11011-CFS-2024_2024.json`;
        writeFileSync(join(dir, name), '{}');
        const t = 1_000_000 + i;
        utimesSync(join(dir, name), t, t);
      }

      // The file just written this call — intentionally given the OLDEST mtime to
      // prove it is kept via the keepName guard, not via recency.
      const current = 'kr-financials-current-11011-CFS-2025_2025.json';
      writeFileSync(join(dir, current), '{}');
      utimesSync(join(dir, current), 500_000, 500_000);

      pruneRawFinancialFiles(dir, current);

      const left = readdirSync(dir);
      expect(left).toContain('call_abc123.txt'); // agent persist untouched
      expect(left).toContain(current); // current kept despite oldest mtime
      expect(left).not.toContain('kr-financials-x0-11011-CFS-2024_2024.json'); // oldest dropped
      const dumps = left.filter((f) => f.startsWith('kr-financials-'));
      expect(dumps.length).toBeLessThanOrEqual(RAW_FILE_KEEP + 1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('is a no-op on an empty directory', () => {
    const dir = mkdtempSync(join(tmpdir(), 'kr-prune-empty-'));
    try {
      expect(() => pruneRawFinancialFiles(dir, 'kr-financials-none.json')).not.toThrow();
      expect(readdirSync(dir).length).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
