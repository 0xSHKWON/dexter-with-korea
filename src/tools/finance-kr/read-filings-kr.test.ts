import { describe, it, expect } from 'bun:test';
import { pickRceptNo, type DartFiling } from './read-filings-kr.js';

// Representative /list.json rows (정기공시), date-desc as DART returns them.
const SAMSUNG: DartFiling[] = [
  { rcept_no: '20260515002181', report_nm: '분기보고서 (2026.03)', rcept_dt: '20260515' },
  { rcept_no: '20260310002820', report_nm: '사업보고서 (2025.12)', rcept_dt: '20260310' },
  { rcept_no: '20251114002447', report_nm: '분기보고서 (2025.09)', rcept_dt: '20251114' },
  { rcept_no: '20250814003156', report_nm: '반기보고서 (2025.06)', rcept_dt: '20250814' },
  { rcept_no: '20250515001922', report_nm: '분기보고서 (2025.03)', rcept_dt: '20250515' },
  { rcept_no: '20250311001085', report_nm: '사업보고서 (2024.12)', rcept_dt: '20250311' },
];

describe('pickRceptNo', () => {
  it('picks the most recent 사업보고서 for annual', () => {
    expect(pickRceptNo(SAMSUNG, 'annual')?.rcept_no).toBe('20260310002820');
  });

  it('filters annual by fiscal year via the period month', () => {
    expect(pickRceptNo(SAMSUNG, 'annual', 2024)?.rcept_no).toBe('20250311001085');
  });

  it('picks 반기보고서 for semiannual', () => {
    expect(pickRceptNo(SAMSUNG, 'semiannual')?.rcept_no).toBe('20250814003156');
  });

  it('disambiguates 1분기 (.03) from 3분기 (.09)', () => {
    expect(pickRceptNo(SAMSUNG, 'quarterly_1')?.rcept_no).toBe('20260515002181'); // 2026.03
    expect(pickRceptNo(SAMSUNG, 'quarterly_3')?.rcept_no).toBe('20251114002447'); // 2025.09
  });

  it('prefers a [기재정정] amendment over the original', () => {
    const withAmendment: DartFiling[] = [
      { rcept_no: 'AMEND', report_nm: '[기재정정]사업보고서 (2025.12)', rcept_dt: '20260420' },
      { rcept_no: 'ORIG', report_nm: '사업보고서 (2025.12)', rcept_dt: '20260310' },
    ];
    expect(pickRceptNo(withAmendment, 'annual')?.rcept_no).toBe('AMEND');
  });

  it('returns null when no matching report type exists', () => {
    const onlyHalf: DartFiling[] = [
      { rcept_no: 'H', report_nm: '반기보고서 (2025.06)', rcept_dt: '20250814' },
    ];
    expect(pickRceptNo(onlyHalf, 'annual')).toBeNull();
  });
});
