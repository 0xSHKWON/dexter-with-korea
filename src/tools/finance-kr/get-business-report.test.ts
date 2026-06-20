import { describe, it, expect } from 'bun:test';
import { mkdtempSync, writeFileSync, readdirSync, utimesSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { pruneRawFinancialFiles, RAW_FILE_KEEP } from './sub-tools/get-business-report.js';

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
