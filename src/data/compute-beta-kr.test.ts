import { describe, it, expect } from 'bun:test';
import {
  weekKey,
  periodKey,
  resample,
  toReturns,
  alignReturns,
  ols,
  blumeAdjust,
  computeBetaKr,
} from './compute-beta-kr.js';
import type { PriceBar } from './fetchers/naver-price-history.js';

function bar(date: string, close: number): PriceBar {
  return { date, close, open: null, high: null, low: null, volume: null };
}

describe('weekKey / periodKey', () => {
  it('maps every weekday to that week’s Monday', () => {
    // 2024-01-01 is a Monday; 2024-01-07 is the Sunday of the same week.
    expect(weekKey('2024-01-01')).toBe('2024-01-01');
    expect(weekKey('2024-01-03')).toBe('2024-01-01');
    expect(weekKey('2024-01-07')).toBe('2024-01-01');
    expect(weekKey('2024-01-08')).toBe('2024-01-08');
  });
  it('monthly buckets by YYYY-MM, daily is identity', () => {
    expect(periodKey('2024-03-15', 'monthly')).toBe('2024-03');
    expect(periodKey('2024-03-15', 'daily')).toBe('2024-03-15');
  });
});

describe('resample', () => {
  it('keeps the last close in each weekly bucket', () => {
    const bars = [
      bar('2024-01-02', 100), // week of 01-01
      bar('2024-01-05', 110), // week of 01-01 (last) -> 110
      bar('2024-01-08', 120), // week of 01-08
      bar('2024-01-10', 130), // week of 01-08 (last) -> 130
    ];
    expect(resample(bars, 'weekly')).toEqual([
      { date: '2024-01-05', close: 110 },
      { date: '2024-01-10', close: 130 },
    ]);
  });
});

describe('toReturns', () => {
  it('computes simple period returns', () => {
    const r = toReturns([
      { date: 'a', close: 100 },
      { date: 'b', close: 110 },
      { date: 'c', close: 99 },
    ]);
    expect(r[0].ret).toBeCloseTo(0.1, 10);
    expect(r[1].ret).toBeCloseTo(-0.1, 10);
  });
});

describe('ols', () => {
  it('recovers a known slope/intercept exactly', () => {
    // y = 2x + 1 perfectly → beta 2, alpha 1, R² 1.
    const x = [1, 2, 3, 4];
    const y = [3, 5, 7, 9];
    const fit = ols(x, y)!;
    expect(fit.beta).toBeCloseTo(2, 10);
    expect(fit.alpha).toBeCloseTo(1, 10);
    expect(fit.rSquared).toBeCloseTo(1, 10);
  });
  it('returns null when variance of x is zero', () => {
    expect(ols([5, 5, 5], [1, 2, 3])).toBeNull();
  });
});

describe('blumeAdjust', () => {
  it('pulls a high beta toward 1.0 and is identity at 1.0', () => {
    expect(blumeAdjust(1)).toBeCloseTo(1, 10);
    expect(blumeAdjust(1.6)).toBeCloseTo(1.4, 10); // 0.67*1.6 + 0.33 = 1.4
    expect(blumeAdjust(0.4)).toBeCloseTo(0.6, 10);
  });
});

describe('computeBetaKr', () => {
  it('returns beta ≈1 when the stock moves exactly with the index', () => {
    // Index follows a VARYING path (constant returns would give var(x)=0); the
    // stock applies the identical move each week → beta 1, R² 1.
    const moves = [0.01, -0.02, 0.015, -0.005, 0.03, -0.01, 0.02, -0.025, 0.01, 0.005, -0.015];
    const stock: PriceBar[] = [bar('2024-01-01', 1000)];
    const index: PriceBar[] = [bar('2024-01-01', 2000)];
    let ps = 1000;
    let pm = 2000;
    for (let i = 0; i < moves.length; i++) {
      const d = new Date(Date.UTC(2024, 0, 8 + i * 7)); // consecutive Mondays
      const iso = d.toISOString().slice(0, 10);
      ps *= 1 + moves[i];
      pm *= 1 + moves[i];
      stock.push(bar(iso, ps));
      index.push(bar(iso, pm));
    }
    const res = computeBetaKr(stock, index, 'weekly')!;
    expect(res.rawBeta).toBeCloseTo(1, 6);
    expect(res.adjustedBeta).toBeCloseTo(1, 6);
    expect(res.rSquared).toBeCloseTo(1, 6);
    expect(res.observations).toBe(11); // 12 closes → 11 returns
  });

  it('returns beta ≈2 when the stock amplifies the index 2×', () => {
    const stock: PriceBar[] = [];
    const index: PriceBar[] = [];
    const moves = [0.01, -0.02, 0.015, -0.005, 0.03, -0.01, 0.02, -0.025, 0.01, 0.005];
    let ps = 1000;
    let pm = 2000;
    stock.push(bar('2024-01-01', ps));
    index.push(bar('2024-01-01', pm));
    for (let i = 0; i < moves.length; i++) {
      const d = new Date(Date.UTC(2024, 0, 8 + i * 7));
      const iso = d.toISOString().slice(0, 10);
      pm *= 1 + moves[i];
      ps *= 1 + 2 * moves[i]; // stock = 2× index move
      stock.push(bar(iso, ps));
      index.push(bar(iso, pm));
    }
    const res = computeBetaKr(stock, index, 'weekly')!;
    // Not exactly 2 (compounding makes simple returns slightly non-linear) but close.
    expect(res.rawBeta).toBeGreaterThan(1.9);
    expect(res.rawBeta).toBeLessThan(2.1);
    expect(res.rSquared).toBeGreaterThan(0.99);
  });

  it('returns null when series barely overlap', () => {
    const stock = [bar('2024-01-01', 100), bar('2024-01-08', 101)];
    const index = [bar('2024-02-01', 200), bar('2024-02-08', 201)];
    expect(computeBetaKr(stock, index, 'weekly')).toBeNull();
  });
});
