import { describe, it, expect } from 'bun:test';
import { pickRceptNo, buildSummaryInput, type DartFiling } from './read-filings-kr.js';

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

describe('buildSummaryInput', () => {
  it('dedupes a block shared across categories (business ⊇ risks 위험관리)', () => {
    // selectSections joins blocks with '\n\n\n'; 위험관리 appears under both categories.
    const sections = {
      business: '[1. 사업의 개요]\n반도체 사업.\n\n\n[5. 위험관리 및 파생거래]\n환율 위험.',
      risks: '[5. 위험관리 및 파생거래]\n환율 위험.\n\n\n[XI. 투자자 보호]\n제재 없음.',
    };
    const out = buildSummaryInput(sections);
    // The 위험관리 block is emitted once total; risks' unique XI block survives.
    expect(out.split('5. 위험관리 및 파생거래').length - 1).toBe(1);
    expect(out).toContain('반도체 사업');
    expect(out).toContain('제재 없음');
  });

  it('keeps non-overlapping categories intact', () => {
    const out = buildSummaryInput({ business: '[1. 사업의 개요]\nA.', mdna: '[1. 분석]\nB.' });
    expect(out).toContain('<<business>>');
    expect(out).toContain('<<mdna>>');
    expect(out).toContain('A.');
    expect(out).toContain('B.');
  });
});
