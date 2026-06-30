/**
 * Equity beta from a price-history regression — the authoritative replacement for
 * a web_search-inferred or sector-proxy beta in the DCF cost-of-equity
 * (Ke = Rf + β × ERP).
 *
 * Method (the agreed defaults; see src/skills/dcf/SKILL.md Step 3):
 *  - Resample daily closes to WEEKLY (last close of each Mon-anchored week) by
 *    default — captures the regime while damping daily microstructure noise.
 *  - Simple (arithmetic) periodic returns, aligned on the dates both series share.
 *  - OLS of stock returns on index returns: rawBeta = cov(s,m)/var(m).
 *  - Blume adjustment: adjBeta = 0.67·raw + 0.33·1.0 (mean reversion; Bloomberg default).
 *
 * Pure functions only (no I/O) so the regression is unit-testable against hand
 * computed fixtures. The fetch + index selection live in get-beta-kr.ts.
 */
import type { PriceBar } from './fetchers/naver-price-history.js';

export type BetaFrequency = 'daily' | 'weekly' | 'monthly';

/** Blume weights — raw beta reverts toward the market beta of 1.0. */
const BLUME_RAW_WEIGHT = 2 / 3;

export interface BetaResult {
  rawBeta: number;
  /** Blume-adjusted: 0.67·raw + 0.33. */
  adjustedBeta: number;
  alpha: number;
  rSquared: number;
  /** Number of aligned return pairs used in the regression. */
  observations: number;
  frequency: BetaFrequency;
  /** First and last date of the aligned return series (ISO). */
  startDate: string;
  asOf: string;
}

/** Monday (UTC) of the week containing `iso`, as a YYYY-MM-DD key. */
export function weekKey(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  const dow = d.getUTCDay(); // 0=Sun … 6=Sat
  const shift = dow === 0 ? -6 : 1 - dow; // back to Monday
  d.setUTCDate(d.getUTCDate() + shift);
  return d.toISOString().slice(0, 10);
}

/** Period bucket key for a date at the given sampling frequency. */
export function periodKey(iso: string, frequency: BetaFrequency): string {
  if (frequency === 'daily') return iso;
  if (frequency === 'monthly') return iso.slice(0, 7); // YYYY-MM
  return weekKey(iso);
}

/**
 * Resample ascending daily bars to one close per period (the LAST trading day in
 * each bucket). Returns `{ date, close }` ascending. Daily frequency is a no-op
 * (one bucket per date).
 */
export function resample(bars: PriceBar[], frequency: BetaFrequency): { date: string; close: number }[] {
  const byPeriod = new Map<string, { date: string; close: number }>();
  for (const b of bars) {
    // bars are ascending, so a later date in the same bucket overwrites — last wins.
    byPeriod.set(periodKey(b.date, frequency), { date: b.date, close: b.close });
  }
  return [...byPeriod.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/** Simple (arithmetic) period-over-period returns keyed by the later period's date. */
export function toReturns(series: { date: string; close: number }[]): { date: string; ret: number }[] {
  const out: { date: string; ret: number }[] = [];
  for (let i = 1; i < series.length; i++) {
    const prev = series[i - 1].close;
    if (prev > 0) out.push({ date: series[i].date, ret: series[i].close / prev - 1 });
  }
  return out;
}

/** Inner-join two return series on date. */
export function alignReturns(
  stock: { date: string; ret: number }[],
  index: { date: string; ret: number }[],
): { dates: string[]; s: number[]; m: number[] } {
  const idx = new Map(index.map((r) => [r.date, r.ret]));
  const dates: string[] = [];
  const s: number[] = [];
  const m: number[] = [];
  for (const r of stock) {
    const mr = idx.get(r.date);
    if (mr !== undefined) {
      dates.push(r.date);
      s.push(r.ret);
      m.push(mr);
    }
  }
  return { dates, s, m };
}

/** OLS of y on x: slope (beta), intercept (alpha), R². Needs ≥2 points and var(x)>0. */
export function ols(x: number[], y: number[]): { beta: number; alpha: number; rSquared: number } | null {
  const n = x.length;
  if (n < 2 || n !== y.length) return null;
  const mx = x.reduce((a, b) => a + b, 0) / n;
  const my = y.reduce((a, b) => a + b, 0) / n;
  let cov = 0;
  let varX = 0;
  let varY = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i] - mx;
    const dy = y[i] - my;
    cov += dx * dy;
    varX += dx * dx;
    varY += dy * dy;
  }
  if (varX === 0) return null;
  const beta = cov / varX;
  const alpha = my - beta * mx;
  const rSquared = varY === 0 ? 0 : (cov * cov) / (varX * varY);
  return { beta, alpha, rSquared };
}

/** Blume-adjust a raw beta toward 1.0. */
export function blumeAdjust(raw: number): number {
  return BLUME_RAW_WEIGHT * raw + (1 - BLUME_RAW_WEIGHT) * 1.0;
}

function round(n: number, dp = 4): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

/**
 * Compute beta of `stockBars` against `indexBars` at the given frequency.
 * Returns null if the two series share too few aligned returns to regress.
 */
export function computeBetaKr(
  stockBars: PriceBar[],
  indexBars: PriceBar[],
  frequency: BetaFrequency = 'weekly',
): BetaResult | null {
  const s = toReturns(resample(stockBars, frequency));
  const m = toReturns(resample(indexBars, frequency));
  const aligned = alignReturns(s, m);
  const fit = ols(aligned.m, aligned.s); // regress stock (y) on index (x)
  if (!fit) return null;
  return {
    rawBeta: round(fit.beta),
    adjustedBeta: round(blumeAdjust(fit.beta)),
    alpha: round(fit.alpha, 6),
    rSquared: round(fit.rSquared),
    observations: aligned.dates.length,
    frequency,
    startDate: aligned.dates[0],
    asOf: aligned.dates[aligned.dates.length - 1],
  };
}
