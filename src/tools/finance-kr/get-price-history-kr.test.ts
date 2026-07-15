import { describe, it, expect } from 'bun:test';
import { computeSummary, aggregateBars, resolveGranularity, weekKey, parseIsoDateLocal, localYmd } from './get-price-history-kr.js';
import type { PriceBar } from '../../data/fetchers/naver-price-history.js';

const bar = (date: string, close: number, extra?: Partial<PriceBar>): PriceBar => ({
  date,
  close,
  open: extra?.open ?? close,
  high: extra?.high ?? close,
  low: extra?.low ?? close,
  volume: extra?.volume ?? 1000,
});

describe('computeSummary', () => {
  it('computes return, extremes, and peak-to-trough drawdown from daily closes', () => {
    const bars = [
      bar('2026-01-02', 100),
      bar('2026-01-03', 120), // peak
      bar('2026-01-06', 90), // trough after peak → -25% drawdown
      bar('2026-01-07', 110),
    ];
    const s = computeSummary(bars)!;
    expect(s.firstClose).toBe(100);
    expect(s.lastClose).toBe(110);
    expect(s.totalReturnPct).toBe(10);
    expect(s.high).toBe(120);
    expect(s.highDate).toBe('2026-01-03');
    expect(s.low).toBe(90);
    expect(s.lowDate).toBe('2026-01-06');
    expect(s.maxDrawdownPct).toBe(-25);
  });

  it('is 0-drawdown for a monotonic rise and null for an empty series', () => {
    expect(computeSummary([bar('2026-01-02', 100), bar('2026-01-03', 105)])!.maxDrawdownPct).toBe(0);
    expect(computeSummary([])).toBeNull();
  });
});

describe('aggregateBars', () => {
  it('groups by ISO week: open=first, close=last, high/low=extremes, volume=sum, date=last trading day', () => {
    // 2026-01-05 is a Monday.
    const weekly = aggregateBars(
      [
        bar('2026-01-05', 100, { open: 98, high: 101, low: 97, volume: 10 }),
        bar('2026-01-07', 104, { open: 100, high: 106, low: 99, volume: 20 }),
        bar('2026-01-09', 102, { open: 104, high: 105, low: 101, volume: 30 }),
        bar('2026-01-12', 110, { volume: 40 }), // next week
      ],
      'weekly',
    );
    expect(weekly).toHaveLength(2);
    expect(weekly[0]).toEqual({ date: '2026-01-09', close: 102, open: 98, high: 106, low: 97, volume: 60 });
    expect(weekly[1].date).toBe('2026-01-12');
  });

  it('groups monthly by YYYY-MM and falls back to close where OHLC is null', () => {
    const monthly = aggregateBars(
      [
        { date: '2026-01-05', close: 100, open: null, high: null, low: null, volume: null },
        { date: '2026-01-30', close: 90, open: null, high: null, low: null, volume: null },
        { date: '2026-02-02', close: 95, open: null, high: null, low: null, volume: 5 },
      ],
      'monthly',
    );
    expect(monthly).toHaveLength(2);
    expect(monthly[0]).toEqual({ date: '2026-01-30', close: 90, open: 100, high: 100, low: 90, volume: null });
    expect(monthly[1].volume).toBe(5);
  });
});

describe('weekKey', () => {
  it('maps any weekday to that week\'s Monday', () => {
    expect(weekKey('2026-01-05')).toBe('2026-01-05'); // Monday
    expect(weekKey('2026-01-09')).toBe('2026-01-05'); // Friday
    expect(weekKey('2026-01-11')).toBe('2026-01-05'); // Sunday
    expect(weekKey('2026-01-12')).toBe('2026-01-12'); // next Monday
  });
});

describe('parseIsoDateLocal / localYmd', () => {
  it('round-trips the requested calendar day on ANY host timezone (local-getter consistency with the fetcher ymd)', () => {
    // UTC-midnight parsing (`new Date('...T00:00:00Z')`) breaks this on UTC-negative
    // hosts: the fetcher's local getters emit the PRIOR day. Local-midnight parsing
    // makes the round-trip timezone-independent — this assertion holds under any TZ.
    expect(localYmd(parseIsoDateLocal('2026-07-15'))).toBe('20260715');
    expect(localYmd(parseIsoDateLocal('2026-01-01'))).toBe('20260101');
    expect(localYmd(parseIsoDateLocal('2025-12-31'))).toBe('20251231');
  });

  it('parses to local midnight so a today startDate is never "in the future" vs new Date()', () => {
    const d = parseIsoDateLocal('2026-07-15');
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(6);
    expect(d.getDate()).toBe(15);
    expect(d.getHours()).toBe(0);
  });
});

describe('resolveGranularity', () => {
  it('honors an explicit request and auto-scales by window size', () => {
    expect(resolveGranularity('daily', 5000)).toBe('daily');
    expect(resolveGranularity('auto', 120)).toBe('daily');
    expect(resolveGranularity('auto', 500)).toBe('weekly');
    expect(resolveGranularity('auto', 2500)).toBe('monthly');
  });
});
