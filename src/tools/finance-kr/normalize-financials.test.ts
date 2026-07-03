import { describe, it, expect } from 'bun:test';
import {
  parseAmount,
  formatKrw,
  findMetric,
  sumMetrics,
  summarizePeriod,
  ACCOUNT_SPECS,
  DEBT_SUM_SPEC,
  CAPEX_SUM_SPEC,
  type DartRow,
} from './normalize-financials.js';

// Samsung-like annual consolidated (CFS) line items, with the ifrs-full_ProfitLoss
// trap duplicated under CF — netIncome must resolve to the IS row, not the CF row.
const annualList: DartRow[] = [
  { sj_div: 'BS', account_id: 'ifrs-full_Assets', account_nm: '자산총계', thstrm_amount: '514,531,948,000,000', frmtrm_amount: '448,424,507,000,000' },
  { sj_div: 'BS', account_id: 'ifrs-full_Liabilities', account_nm: '부채총계', thstrm_amount: '92,228,115,000,000', frmtrm_amount: '93,674,903,000,000' },
  { sj_div: 'BS', account_id: 'ifrs-full_Equity', account_nm: '자본총계', thstrm_amount: '422,303,833,000,000', frmtrm_amount: '354,749,604,000,000' },
  { sj_div: 'BS', account_id: 'ifrs-full_CashAndCashEquivalents', account_nm: '현금및현금성자산', thstrm_amount: '73,000,000,000,000', frmtrm_amount: '57,000,000,000,000' },
  { sj_div: 'IS', account_id: 'ifrs-full_Revenue', account_nm: '매출액', thstrm_amount: '300,870,903,000,000', frmtrm_amount: '258,935,494,000,000' },
  { sj_div: 'IS', account_id: 'dart_OperatingIncomeLoss', account_nm: '영업이익', thstrm_amount: '32,725,961,000,000', frmtrm_amount: '6,566,976,000,000' },
  { sj_div: 'IS', account_id: 'ifrs-full_ProfitLoss', account_nm: '당기순이익', thstrm_amount: '34,451,351,000,000', frmtrm_amount: '15,487,100,000,000' },
  { sj_div: 'CF', account_id: 'ifrs-full_ProfitLoss', account_nm: '당기순이익', thstrm_amount: '99,999,999,999,999', frmtrm_amount: '0' },
  { sj_div: 'IS', account_id: 'ifrs-full_BasicEarningsLossPerShare', account_nm: '기본주당이익(손실)', thstrm_amount: '5,062', frmtrm_amount: '2,131' },
  { sj_div: 'CF', account_id: 'ifrs-full_CashFlowsFromUsedInOperatingActivities', account_nm: '영업활동현금흐름', thstrm_amount: '70,000,000,000,000', frmtrm_amount: '44,000,000,000,000' },
  { sj_div: 'CF', account_id: 'ifrs-full_CashFlowsFromUsedInInvestingActivities', account_nm: '투자활동현금흐름', thstrm_amount: '-50,000,000,000,000', frmtrm_amount: '-30,000,000,000,000' },
  { sj_div: 'CF', account_id: 'ifrs-full_CashFlowsFromUsedInFinancingActivities', account_nm: '재무활동현금흐름', thstrm_amount: '-10,000,000,000,000', frmtrm_amount: '-9,000,000,000,000' },
  { sj_div: 'CF', account_id: 'ifrs-full_PurchaseOfPropertyPlantAndEquipmentClassifiedAsInvestingActivities', account_nm: '유형자산의 취득', thstrm_amount: '-40,000,000,000,000', frmtrm_amount: '-35,000,000,000,000' },
];

describe('parseAmount', () => {
  it('strips commas and parses signed integers', () => {
    expect(parseAmount('300,870,903,000,000')).toBe(300870903000000);
    expect(parseAmount('-9,000,000,000,000')).toBe(-9000000000000);
    expect(parseAmount('5,062')).toBe(5062);
  });
  it('returns null for empty / dash / nullish', () => {
    expect(parseAmount('')).toBeNull();
    expect(parseAmount('-')).toBeNull();
    expect(parseAmount(null)).toBeNull();
    expect(parseAmount(undefined)).toBeNull();
  });
});

describe('formatKrw', () => {
  it('formats 조 / 억 with sign', () => {
    expect(formatKrw(300870903000000)).toBe('300.9조');
    expect(formatKrw(40000000000000)).toBe('40.0조');
    expect(formatKrw(-9000000000000)).toBe('-9.0조');
    expect(formatKrw(1500000000)).toBe('15억');
    expect(formatKrw(null)).toBeNull();
  });
});

describe('findMetric — sj_div discipline', () => {
  it('resolves netIncome from the IS row, not the duplicate CF ProfitLoss row', () => {
    const m = findMetric(annualList, ACCOUNT_SPECS.netIncome);
    expect(m.current).toBe(34451351000000);
    expect(m.current).not.toBe(99999999999999);
  });
  it('falls back to CIS when there is no IS statement (single-statement filer)', () => {
    const cisOnly: DartRow[] = [
      { sj_div: 'CIS', account_id: 'ifrs-full_Revenue', account_nm: '영업수익', thstrm_amount: '1,000,000,000', frmtrm_amount: '900,000,000' },
    ];
    const m = findMetric(cisOnly, ACCOUNT_SPECS.revenue);
    expect(m.current).toBe(1000000000);
    expect(m.label).toBe('영업수익');
  });
  it('falls back to account_nm when account_id is absent', () => {
    const noId: DartRow[] = [
      { sj_div: 'IS', account_id: '-', account_nm: '매출액', thstrm_amount: '500', frmtrm_amount: '400' },
    ];
    const m = findMetric(noId, ACCOUNT_SPECS.revenue);
    expect(m.current).toBe(500);
  });
  it('does NOT substring-match a different account (순영업이익 / 반영전 영업이익 ≠ 영업이익)', () => {
    const bankIs: DartRow[] = [
      { sj_div: 'CIS', account_id: '-표준계정코드 미사용-', account_nm: '신용손실충당금 반영전 영업이익', thstrm_amount: '10,880,589,000,000' },
      { sj_div: 'CIS', account_id: '-', account_nm: '순영업이익', thstrm_amount: '5,000,000,000,000' },
    ];
    expect(findMetric(bankIs, ACCOUNT_SPECS.operatingProfit).current).toBeNull();
  });
});

describe('summarizePeriod', () => {
  const s = summarizePeriod(annualList, { bsns_year: 2025, report_type: 'annual', fs_div: 'CFS' });

  it('surfaces income statement with display + YoY', () => {
    expect(s.incomeStatement.revenue.current).toBe(300870903000000);
    expect(s.incomeStatement.revenue.display).toBe('300.9조');
    expect(s.ratios.revenueYoYPct).toBe(16.2);
  });
  it('keeps EPS at per-share scale (원, not 조)', () => {
    expect(s.incomeStatement.eps.current).toBe(5062);
    expect(s.incomeStatement.eps.display).toBe('5,062원');
  });
  it('computes margins and ROE (annual)', () => {
    expect(s.ratios.operatingMarginPct).toBe(10.9);
    expect(s.ratios.roePct).toBe(8.2);
    expect(s.ratios.debtToEquityPct).toBe(21.8);
  });
  it('computes FCF as operating CF minus |capex|', () => {
    expect(s.ratios.freeCashFlow).toBe(30000000000000);
    expect(s.ratios.freeCashFlowDisplay).toBe('30.0조');
  });
  it('carries report metadata + basis note', () => {
    expect(s.fs_div).toBe('CFS');
    expect(s.unit).toBe('KRW');
    expect(s.basis).toContain('연간');
  });
  it('omits ROE for non-annual reports (YTD net income would mislead)', () => {
    const q = summarizePeriod(annualList, { bsns_year: 2026, report_type: 'quarterly_1', fs_div: 'CFS' });
    expect(q.ratios.roePct).toBeNull();
    expect(q.ratios.operatingMarginPct).toBe(10.9); // ratios of two YTD flows stay valid
  });
  it('reads prior-year same period from frmtrm_q_amount on quarterly reports', () => {
    // Real DART shape for a 1분기보고서 P&L: frmtrm_amount is empty, the prior-year
    // Q1 figure lives in frmtrm_q_amount. Samsung 2026 Q1 actuals.
    const q1: DartRow[] = [
      {
        sj_div: 'IS',
        account_id: 'ifrs-full_Revenue',
        account_nm: '매출액',
        thstrm_amount: '133,873,444,000,000',
        frmtrm_amount: '',
        frmtrm_q_amount: '79,140,503,000,000',
      },
    ];
    const s2 = summarizePeriod(q1, { bsns_year: 2026, report_type: 'quarterly_1', fs_div: 'CFS' });
    expect(s2.incomeStatement.revenue.current).toBe(133873444000000);
    expect(s2.incomeStatement.revenue.prior).toBe(79140503000000);
    expect(s2.ratios.revenueYoYPct).toBe(69.2);
  });
  it('nulls YoY only when both frmtrm and frmtrm_q are absent', () => {
    const q1: DartRow[] = [
      { sj_div: 'IS', account_id: 'ifrs-full_Revenue', account_nm: '매출액', thstrm_amount: '133,873,444,000,000' },
    ];
    const s2 = summarizePeriod(q1, { bsns_year: 2026, report_type: 'quarterly_1', fs_div: 'CFS' });
    expect(s2.incomeStatement.revenue.current).toBe(133873444000000);
    expect(s2.incomeStatement.revenue.prior).toBeNull();
    expect(s2.ratios.revenueYoYPct).toBeNull();
  });
  it('exposes quarterly IS as 3-month standalone + YTD cumulative (never mislabeled)', () => {
    // Real DART shape, 삼성전자 2025 3분기보고서 actuals: IS thstrm_amount is the
    // 3-MONTH figure, thstrm_add_amount the 9-month cumulative; CF has no add field
    // and its thstrm_amount is already cumulative.
    const q3: DartRow[] = [
      {
        sj_div: 'IS',
        account_id: 'ifrs-full_Revenue',
        account_nm: '매출액',
        thstrm_amount: '86,061,747,000,000',
        thstrm_add_amount: '239,768,567,000,000',
        frmtrm_amount: '',
        frmtrm_q_amount: '79,098,731,000,000',
        frmtrm_add_amount: '225,082,634,000,000',
      },
      {
        sj_div: 'CF',
        account_id: 'ifrs-full_CashFlowsFromUsedInOperatingActivities',
        account_nm: '영업활동현금흐름',
        thstrm_amount: '56,515,496,000,000',
      },
    ];
    const s3 = summarizePeriod(q3, { bsns_year: 2025, report_type: 'quarterly_3', fs_div: 'CFS' });
    // current = 3-month standalone, ytdCurrent = 9-month cumulative — both exposed.
    expect(s3.incomeStatement.revenue.current).toBe(86_061_747_000_000);
    expect(s3.incomeStatement.revenue.ytdCurrent).toBe(239_768_567_000_000);
    expect(s3.incomeStatement.revenue.prior).toBe(79_098_731_000_000); // prior-year 3M
    expect(s3.incomeStatement.revenue.ytdPrior).toBe(225_082_634_000_000); // prior-year 9M
    expect(s3.incomeStatement.revenue.ytdDisplay).toBe('239.8조');
    // YoY pairs 3M vs 3M (consistent basis).
    expect(s3.ratios.revenueYoYPct).toBe(8.8);
    // CF stays cumulative in `current` and gets no ytd fields.
    expect(s3.cashFlow.operating.current).toBe(56_515_496_000_000);
    expect(s3.cashFlow.operating.ytdCurrent).toBeUndefined();
    // basis note states the split explicitly.
    expect(s3.basis).toContain('3개월 단독');
    expect(s3.basis).toContain('9개월 누적');
  });
  it('annual IS metrics carry no ytd fields (thstrm is already the full year)', () => {
    expect(s.incomeStatement.revenue.ytdCurrent).toBeUndefined();
    expect(s.basis).toContain('연간');
  });
  it('returns null metrics (not throw) when accounts are missing', () => {
    const empty = summarizePeriod([], { bsns_year: 2025, report_type: 'annual', fs_div: 'CFS' });
    expect(empty.incomeStatement.revenue.current).toBeNull();
    expect(empty.ratios.operatingMarginPct).toBeNull();
    expect(empty.ratios.freeCashFlow).toBeNull();
  });
});

describe('nonControllingInterests — BS row, not the IS/CIS attribution rows', () => {
  it('resolves the BS 비지배지분 and ignores same-named P&L rows', () => {
    // 삼성전자 FY2024 actuals: BS/IS/CIS all carry a row named '비지배지분'.
    const rows: DartRow[] = [
      { sj_div: 'BS', account_id: 'ifrs-full_NoncontrollingInterests', account_nm: '비지배지분', thstrm_amount: '10,504,467,000,000' },
      { sj_div: 'IS', account_id: 'ifrs-full_ProfitLossAttributableToNoncontrollingInterests', account_nm: '비지배지분', thstrm_amount: '829,988,000,000' },
      { sj_div: 'CIS', account_id: 'ifrs-full_ComprehensiveIncomeAttributableToNoncontrollingInterests', account_nm: '비지배지분', thstrm_amount: '1,248,139,000,000' },
    ];
    const s = summarizePeriod(rows, { bsns_year: 2024, report_type: 'annual', fs_div: 'CFS' });
    expect(s.balanceSheet.nonControllingInterests.current).toBe(10_504_467_000_000);
  });

  it('is null when the filer reports no NCI line (별도재무제표 등)', () => {
    const s = summarizePeriod([], { bsns_year: 2024, report_type: 'annual', fs_div: 'OFS' });
    expect(s.balanceSheet.nonControllingInterests.current).toBeNull();
  });
});

describe('interestPaid — amount + IAS 7 classification', () => {
  it('classifies operating from the standard account_id (삼성전자·LG화학 shape)', () => {
    const rows: DartRow[] = [
      { sj_div: 'CF', account_id: 'ifrs-full_InterestPaidClassifiedAsOperatingActivities', account_nm: '이자의 지급', thstrm_amount: '675,049,000,000' },
    ];
    const s = summarizePeriod(rows, { bsns_year: 2024, report_type: 'annual', fs_div: 'CFS' });
    expect(s.cashFlow.interestPaid.current).toBe(675_049_000_000);
    expect(s.cashFlow.interestPaidClassification).toBe('operating');
  });

  it('classifies financing from the financing-activities id', () => {
    const rows: DartRow[] = [
      { sj_div: 'CF', account_id: 'ifrs-full_InterestPaidClassifiedAsFinancingActivities', account_nm: '이자지급', thstrm_amount: '-100,000,000' },
    ];
    const s = summarizePeriod(rows, { bsns_year: 2024, report_type: 'annual', fs_div: 'CFS' });
    expect(s.cashFlow.interestPaidClassification).toBe('financing');
  });

  it('returns the amount with null classification when only the bare label matches', () => {
    const rows: DartRow[] = [
      { sj_div: 'CF', account_id: '-표준계정코드 미사용-', account_nm: '이자의 지급', thstrm_amount: '50,000,000' },
    ];
    const s = summarizePeriod(rows, { bsns_year: 2024, report_type: 'annual', fs_div: 'CFS' });
    expect(s.cashFlow.interestPaid.current).toBe(50_000_000);
    expect(s.cashFlow.interestPaidClassification).toBeNull();
  });

  it('does not confuse 이자의 수취 (interest received) with interest paid', () => {
    const rows: DartRow[] = [
      { sj_div: 'CF', account_id: 'ifrs-full_InterestReceivedClassifiedAsOperatingActivities', account_nm: '이자의 수취', thstrm_amount: '4,008,359,000,000' },
    ];
    const s = summarizePeriod(rows, { bsns_year: 2024, report_type: 'annual', fs_div: 'CFS' });
    expect(s.cashFlow.interestPaid.current).toBeNull();
  });
});

// Capex = 유형자산 취득 + 무형자산 취득 (PP&E-only capex overstates FCF for telcos/
// biotech/platforms whose intangible purchases are large real cash outflows).
describe('cashFlow.capex — tangible + intangible purchase sum', () => {
  // 삼성전자 FY2024 CFS actuals (both rows carry the standard ifrs-full ids).
  const cfRows: DartRow[] = [
    { sj_div: 'CF', account_id: 'ifrs-full_CashFlowsFromUsedInOperatingActivities', account_nm: '영업활동현금흐름', thstrm_amount: '70,000,000,000,000' },
    { sj_div: 'CF', account_id: 'ifrs-full_PurchaseOfPropertyPlantAndEquipmentClassifiedAsInvestingActivities', account_nm: '유형자산의 취득', thstrm_amount: '51,406,355,000,000' },
    { sj_div: 'CF', account_id: 'ifrs-full_PurchaseOfIntangibleAssetsClassifiedAsInvestingActivities', account_nm: '무형자산의 취득', thstrm_amount: '2,335,284,000,000' },
    // proceeds lines must NOT offset the purchase sum:
    { sj_div: 'CF', account_id: 'ifrs-full_ProceedsFromSalesOfPropertyPlantAndEquipmentClassifiedAsInvestingActivities', account_nm: '유형자산의 처분', thstrm_amount: '156,191,000,000' },
    { sj_div: 'CF', account_id: 'ifrs-full_ProceedsFromSalesOfIntangibleAssetsClassifiedAsInvestingActivities', account_nm: '무형자산의 처분', thstrm_amount: '15,869,000,000' },
  ];

  it('sums 유형 + 무형 취득 and excludes 처분 lines', () => {
    const capex = sumMetrics(cfRows, CAPEX_SUM_SPEC);
    expect(capex.current).toBe(53_741_639_000_000);
    expect(capex.label).toBe('유형자산의 취득 + 무형자산의 취득');
  });

  it('feeds the combined capex into FCF', () => {
    const s = summarizePeriod(cfRows, { bsns_year: 2024, report_type: 'annual', fs_div: 'CFS' });
    expect(s.cashFlow.capex.current).toBe(53_741_639_000_000);
    expect(s.ratios.freeCashFlow).toBe(70_000_000_000_000 - 53_741_639_000_000);
  });

  it('still works for a PP&E-only filer (no intangible purchase line)', () => {
    const ppeOnly = cfRows.filter((r) => !r.account_nm?.includes('무형'));
    expect(sumMetrics(ppeOnly, CAPEX_SUM_SPEC).current).toBe(51_406_355_000_000);
  });
});

// Net-debt inputs (totalDebt = interest-bearing borrowings; shortTermInvestments = 단기금융상품).
// Fixtures use REAL DART CFS line items so account_id/account_nm reflect actual filings:
//   - 삼성전자 005930 lists 단기차입금 with account_id '-표준계정코드 미사용-' (no standard code)
//   - LG화학 051910 aggregates all borrowings into two rows both labelled exactly "차입금"
//   - 단기금융상품 uses ifrs-full_ShorttermDepositsNotClassifiedAsCashEquivalents
describe('balanceSheet.totalDebt — interest-bearing debt sum', () => {
  // 삼성전자 2025 연결 BS, actual figures.
  const samsungBS: DartRow[] = [
    { sj_div: 'BS', account_id: '-표준계정코드 미사용-', account_nm: '단기차입금', thstrm_amount: '17,574,980,000,000', frmtrm_amount: '17,000,000,000,000' },
    { sj_div: 'BS', account_id: 'ifrs-full_CurrentPortionOfLongtermBorrowings', account_nm: '유동성장기부채', thstrm_amount: '1,177,508,000,000', frmtrm_amount: '1,000,000,000,000' },
    { sj_div: 'BS', account_id: 'ifrs-full_NoncurrentPortionOfNoncurrentBondsIssued', account_nm: '사채', thstrm_amount: '7,134,000,000', frmtrm_amount: '7,000,000,000' },
    { sj_div: 'BS', account_id: 'ifrs-full_NoncurrentPortionOfNoncurrentLoansReceived', account_nm: '장기차입금', thstrm_amount: '6,479,517,000,000', frmtrm_amount: '6,000,000,000,000' },
    { sj_div: 'BS', account_id: 'ifrs-full_CashAndCashEquivalents', account_nm: '현금및현금성자산', thstrm_amount: '57,856,378,000,000', frmtrm_amount: '49,680,710,000,000' },
    { sj_div: 'BS', account_id: 'ifrs-full_ShorttermDepositsNotClassifiedAsCashEquivalents', account_nm: '단기금융상품', thstrm_amount: '67,965,021,000,000', frmtrm_amount: '65,102,886,000,000' },
    // noise that must NOT be summed into debt:
    { sj_div: 'BS', account_id: 'ifrs-full_CurrentLeaseLiabilities', account_nm: '유동 리스부채', thstrm_amount: '1,500,000,000,000', frmtrm_amount: '1,400,000,000,000' },
    { sj_div: 'BS', account_id: 'ifrs-full_NoncurrentLeaseLiabilities', account_nm: '비유동 리스부채', thstrm_amount: '2,000,000,000,000', frmtrm_amount: '1,900,000,000,000' },
    { sj_div: 'BS', account_id: '-표준계정코드 미사용-', account_nm: '매입채무', thstrm_amount: '12,000,000,000,000', frmtrm_amount: '11,000,000,000,000' },
    { sj_div: 'BS', account_id: 'ifrs-full_CurrentProvisions', account_nm: '유동성충당부채', thstrm_amount: '5,000,000,000,000', frmtrm_amount: '4,500,000,000,000' },
  ];

  it('sums every borrowing line (단기차입금 matched by name — its id is the no-code sentinel)', () => {
    const s = summarizePeriod(samsungBS, { bsns_year: 2025, report_type: 'annual', fs_div: 'CFS' });
    expect(s.balanceSheet.totalDebt.current).toBe(25_239_139_000_000);
    expect(s.balanceSheet.totalDebt.prior).toBe(24_007_000_000_000);
    expect(s.balanceSheet.totalDebt.display).toBe('25.2조');
    expect(s.balanceSheet.totalDebt.label).toBe('단기차입금 + 유동성장기부채 + 사채 + 장기차입금');
  });

  it('excludes 리스부채 / 매입채무 / 충당부채 from debt', () => {
    const debt = sumMetrics(samsungBS, DEBT_SUM_SPEC);
    // If leases/payables/provisions leaked in, the sum would jump by 20.5조.
    expect(debt.current).toBe(25_239_139_000_000);
    expect(debt.label).not.toContain('리스');
    expect(debt.label).not.toContain('매입채무');
  });

  it('resolves 단기금융상품 as shortTermInvestments → company is net cash', () => {
    const s = summarizePeriod(samsungBS, { bsns_year: 2025, report_type: 'annual', fs_div: 'CFS' });
    expect(s.balanceSheet.shortTermInvestments.current).toBe(67_965_021_000_000);
    expect(s.balanceSheet.shortTermInvestments.display).toBe('68.0조');
    // Net Debt = totalDebt − (cash + shortTermInvestments) must be deeply negative (net cash).
    const cash = s.balanceSheet.cashAndEquivalents.current!;
    const sti = s.balanceSheet.shortTermInvestments.current!;
    const debt = s.balanceSheet.totalDebt.current!;
    expect(debt - (cash + sti)).toBe(-100_582_260_000_000);
    expect(debt - (cash + sti)).toBeLessThan(0);
  });

  it('sums multiple rows sharing the same label (LG화학 lists 차입금 twice: current + non-current)', () => {
    const lgChemBS: DartRow[] = [
      { sj_div: 'BS', account_id: '-표준계정코드 미사용-', account_nm: '차입금', thstrm_amount: '3,804,367,000,000', frmtrm_amount: '3,000,000,000,000' },
      { sj_div: 'BS', account_id: '-표준계정코드 미사용-', account_nm: '차입금', thstrm_amount: '12,160,152,000,000', frmtrm_amount: '11,000,000,000,000' },
      { sj_div: 'BS', account_id: 'ifrs-full_CashAndCashEquivalents', account_nm: '현금및현금성자산', thstrm_amount: '8,497,882,000,000' },
    ];
    const debt = sumMetrics(lgChemBS, DEBT_SUM_SPEC);
    expect(debt.current).toBe(15_964_519_000_000); // both rows, not just the first
    expect(debt.prior).toBe(14_000_000_000_000);
    expect(debt.label).toBe('차입금'); // deduped label
  });

  it('includes 전환사채 (convertible bonds) and 유동성장기차입금 variant', () => {
    const altBS: DartRow[] = [
      { sj_div: 'BS', account_id: '-표준계정코드 미사용-', account_nm: '유동성장기차입금', thstrm_amount: '972,248,000' },
      { sj_div: 'BS', account_id: 'dart_CurrentPortionOfConvertibleBonds', account_nm: '유동전환사채', thstrm_amount: '1,600,360,970' },
      { sj_div: 'BS', account_id: 'ifrs-full_NoncurrentPortionOfNoncurrentLoansReceived', account_nm: '장기차입금', thstrm_amount: '4,027,752,000' },
    ];
    const debt = sumMetrics(altBS, DEBT_SUM_SPEC);
    expect(debt.current).toBe(972_248_000 + 1_600_360_970 + 4_027_752_000);
    expect(debt.label).toContain('유동전환사채');
  });

  it('counts a row matched by both id and name only once (no double count)', () => {
    const dupMatch: DartRow[] = [
      // matches DEBT_SUM_SPEC by BOTH account_id and account_nm
      { sj_div: 'BS', account_id: 'ifrs-full_CurrentPortionOfLongtermBorrowings', account_nm: '유동성장기부채', thstrm_amount: '1,000,000,000,000' },
    ];
    expect(sumMetrics(dupMatch, DEBT_SUM_SPEC).current).toBe(1_000_000_000_000);
  });

  it('totalDebt / shortTermInvestments are null for filers with no borrowing lines (banks/holdcos)', () => {
    const bankBS: DartRow[] = [
      { sj_div: 'BS', account_id: 'ifrs-full_CashAndCashEquivalents', account_nm: '현금및현금성자산', thstrm_amount: '20,000,000,000,000' },
      { sj_div: 'BS', account_id: '-표준계정코드 미사용-', account_nm: '예수부채', thstrm_amount: '300,000,000,000,000' },
      { sj_div: 'BS', account_id: '-표준계정코드 미사용-', account_nm: '보험계약부채', thstrm_amount: '150,000,000,000,000' },
    ];
    const s = summarizePeriod(bankBS, { bsns_year: 2025, report_type: 'annual', fs_div: 'CFS' });
    expect(s.balanceSheet.totalDebt.current).toBeNull();
    expect(s.balanceSheet.totalDebt.label).toBeNull();
    expect(s.balanceSheet.shortTermInvestments.current).toBeNull();
  });

  it('does not substring-match (예수부채 / 매입채무 are not 차입금)', () => {
    const tricky: DartRow[] = [
      { sj_div: 'BS', account_id: '-표준계정코드 미사용-', account_nm: '예수부채', thstrm_amount: '999,000,000,000' },
      { sj_div: 'BS', account_id: '-표준계정코드 미사용-', account_nm: '단기차입금및유동성장기부채', thstrm_amount: '888,000,000,000' },
    ];
    // bare-label set is exact: neither row equals an entry, so debt is null.
    expect(sumMetrics(tricky, DEBT_SUM_SPEC).current).toBeNull();
  });
});
