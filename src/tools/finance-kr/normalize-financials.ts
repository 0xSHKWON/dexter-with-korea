/**
 * Normalize raw DART fnlttSinglAcntAll line items into a compact, in-context
 * financial summary.
 *
 * Why this exists: get_financials_kr previously returned the full raw DART payload
 * (80–100KB per period, all statements, raw K-IFRS labels). It blew past the
 * tool-result size cap → got persisted to disk → the model only saw a balance-sheet
 * preview and could not page into the income statement (single-line JSON exceeds the
 * read_file per-line limit). Result: the model never surfaced revenue/operating
 * profit/net income and fell back on generic narrative. This module produces a small
 * normalized summary that always fits in-context, so earnings reliably reach the model.
 *
 * Matching is by stable `account_id` first (labels vary by company/year — see the
 * 매출액 vs 영업수익 problem), with `account_nm` fallbacks. Income-statement accounts
 * are searched under both IS and CIS sj_div because single-statement filers report
 * P&L under the comprehensive-income statement only.
 */

export type ReportType = 'annual' | 'semiannual' | 'quarterly_1' | 'quarterly_3';
export type FsDiv = 'CFS' | 'OFS';

/** One raw DART line item from fnlttSinglAcntAll.json. */
export interface DartRow {
  account_id?: string;
  account_nm?: string;
  sj_div?: string;
  thstrm_amount?: string;
  frmtrm_amount?: string;
  /**
   * 전년 동기 누적 — present only on quarterly/semiannual flow statements (IS/CIS/CF).
   * DART leaves frmtrm_amount empty there and puts the prior-year SAME period here.
   */
  frmtrm_q_amount?: string;
  [key: string]: unknown;
}

/** A resolved metric: current/prior raw KRW amounts plus the matched label. */
export interface MetricVal {
  current: number | null;
  prior: number | null;
  /** account_nm actually matched — for traceability when labels vary. */
  label: string | null;
  /** Human-readable current value (조/억 for amounts, 원 for per-share). */
  display: string | null;
}

export interface FinancialSummary {
  bsns_year: number;
  report_type: ReportType;
  fs_div: FsDiv;
  unit: 'KRW';
  /** What thstrm/frmtrm mean for this report type (YTD-cumulative caveats etc.). */
  basis: string;
  incomeStatement: {
    revenue: MetricVal;
    operatingProfit: MetricVal;
    netIncome: MetricVal;
    controllingNetIncome: MetricVal;
    eps: MetricVal;
  };
  balanceSheet: {
    totalAssets: MetricVal;
    totalLiabilities: MetricVal;
    /**
     * Interest-bearing debt only (단기차입금 + 유동성장기부채 + 사채 + 장기차입금 + 전환사채 등),
     * NOT 부채총계. This is the net-debt numerator; `null` when no borrowing line matches
     * (banks/holdcos/insurers use non-standard labels — the model drills the raw file).
     */
    totalDebt: MetricVal;
    totalEquity: MetricVal;
    cashAndEquivalents: MetricVal;
    /** 단기금융상품 — short-term financial instruments, cash-equivalent for the net-debt bridge. */
    shortTermInvestments: MetricVal;
  };
  cashFlow: {
    operating: MetricVal;
    investing: MetricVal;
    financing: MetricVal;
    capex: MetricVal;
  };
  ratios: {
    operatingMarginPct: number | null;
    netMarginPct: number | null;
    roePct: number | null;
    debtToEquityPct: number | null;
    revenueYoYPct: number | null;
    operatingProfitYoYPct: number | null;
    netIncomeYoYPct: number | null;
    freeCashFlow: number | null;
    freeCashFlowDisplay: string | null;
  };
}

type Statement = 'IS' | 'BS' | 'CF';
type MetricKind = 'amount' | 'eps';

interface AccountSpec {
  /** sj_div values to search, in preference order. */
  sjDivs: string[];
  /** Stable account_id values, in preference order. */
  accountIds: string[];
  /** account_nm fallbacks when account_id is absent or unmatched. */
  accountNms: string[];
  kind: MetricKind;
  statement: Statement;
}

/**
 * Spec for a metric that is the SUM of several line items (e.g. total interest-bearing
 * debt). Unlike AccountSpec/findMetric (one row), sumMetrics adds EVERY row whose
 * account_id ∈ accountIds OR account_nm ∈ accountNms — a filer may report the same
 * concept across multiple rows (LG화학 lists current and non-current borrowings as two
 * rows both labelled exactly "차입금"). Matching is by the exact-set membership only (no
 * substring), so 리스부채/충당부채/매입채무 stay out.
 */
export interface SumSpec {
  sjDiv: Statement;
  accountIds: string[];
  accountNms: string[];
  kind: MetricKind;
}

/** account_id mapping verified against real DART payloads (Samsung 005930, CFS). */
export const ACCOUNT_SPECS: Record<string, AccountSpec> = {
  revenue: {
    sjDivs: ['IS', 'CIS'],
    accountIds: ['ifrs-full_Revenue'],
    accountNms: ['매출액', '영업수익', '수익(매출액)'],
    kind: 'amount',
    statement: 'IS',
  },
  operatingProfit: {
    sjDivs: ['IS', 'CIS'],
    accountIds: ['dart_OperatingIncomeLoss'],
    accountNms: ['영업이익', '영업이익(손실)'],
    kind: 'amount',
    statement: 'IS',
  },
  netIncome: {
    // ifrs-full_ProfitLoss also appears under CF/CIS/SCE — sj_div ordering keeps us on the P&L.
    sjDivs: ['IS', 'CIS'],
    accountIds: ['ifrs-full_ProfitLoss'],
    accountNms: ['당기순이익', '분기순이익', '반기순이익', '당기순이익(손실)'],
    kind: 'amount',
    statement: 'IS',
  },
  controllingNetIncome: {
    sjDivs: ['IS', 'CIS'],
    accountIds: ['ifrs-full_ProfitLossAttributableToOwnersOfParent'],
    accountNms: ['지배기업 소유주지분', '지배기업의 소유주에게 귀속되는 당기순이익'],
    kind: 'amount',
    statement: 'IS',
  },
  eps: {
    sjDivs: ['IS', 'CIS'],
    accountIds: ['ifrs-full_BasicEarningsLossPerShare', 'ifrs-full_DilutedEarningsLossPerShare'],
    accountNms: ['기본주당이익', '기본주당이익(손실)', '희석주당이익', '희석주당이익(손실)'],
    kind: 'eps',
    statement: 'IS',
  },
  totalAssets: {
    sjDivs: ['BS'],
    accountIds: ['ifrs-full_Assets'],
    accountNms: ['자산총계'],
    kind: 'amount',
    statement: 'BS',
  },
  totalLiabilities: {
    sjDivs: ['BS'],
    accountIds: ['ifrs-full_Liabilities'],
    accountNms: ['부채총계'],
    kind: 'amount',
    statement: 'BS',
  },
  totalEquity: {
    // Prefer total equity (incl. NCI) over owners'-only.
    sjDivs: ['BS'],
    accountIds: ['ifrs-full_Equity', 'ifrs-full_EquityAttributableToOwnersOfParent'],
    accountNms: ['자본총계', '지배기업의 소유주에게 귀속되는 자본'],
    kind: 'amount',
    statement: 'BS',
  },
  cashAndEquivalents: {
    sjDivs: ['BS'],
    accountIds: ['ifrs-full_CashAndCashEquivalents'],
    accountNms: ['현금및현금성자산'],
    kind: 'amount',
    statement: 'BS',
  },
  // 단기금융상품 (short-term financial instruments) — cash-equivalent for net debt. id/nm
  // verified against real DART CFS payloads (삼성전자 005930 and 알테오젠 both use this id).
  shortTermInvestments: {
    sjDivs: ['BS'],
    accountIds: ['ifrs-full_ShorttermDepositsNotClassifiedAsCashEquivalents'],
    accountNms: ['단기금융상품'],
    kind: 'amount',
    statement: 'BS',
  },
  cfo: {
    sjDivs: ['CF'],
    accountIds: ['ifrs-full_CashFlowsFromUsedInOperatingActivities'],
    accountNms: ['영업활동현금흐름', '영업활동으로 인한 현금흐름'],
    kind: 'amount',
    statement: 'CF',
  },
  cfi: {
    sjDivs: ['CF'],
    accountIds: ['ifrs-full_CashFlowsFromUsedInInvestingActivities'],
    accountNms: ['투자활동현금흐름', '투자활동으로 인한 현금흐름'],
    kind: 'amount',
    statement: 'CF',
  },
  cff: {
    sjDivs: ['CF'],
    accountIds: ['ifrs-full_CashFlowsFromUsedInFinancingActivities'],
    accountNms: ['재무활동현금흐름', '재무활동으로 인한 현금흐름'],
    kind: 'amount',
    statement: 'CF',
  },
  capex: {
    sjDivs: ['CF'],
    accountIds: ['ifrs-full_PurchaseOfPropertyPlantAndEquipmentClassifiedAsInvestingActivities'],
    accountNms: ['유형자산의 취득', '유형자산의 증가'],
    kind: 'amount',
    statement: 'CF',
  },
};

/**
 * Interest-bearing debt for the Net Debt bridge: Net Debt = totalDebt − (cash + STI).
 * Summed across every matching BS row (a filer may split borrowings over several lines,
 * or — like LG화학 — report two rows both labelled exactly "차입금").
 *
 * VERIFIED against real DART CFS payloads: 삼성전자 005930 (단기차입금 carries account_id
 * `-표준계정코드 미사용-` → the account_nm set, not the id, resolves it; plus 유동성장기부채/
 * 사채/장기차입금), LG화학 051910 (bare "차입금" ×2 — current + non-current), 알테오젠 196170
 * (유동전환사채/유동성장기차입금). The id set is a preference layer; the exact-nm set is the
 * reliable matcher.
 *
 * BEST-EFFORT (plausible but NOT present in those three samples): 유동성사채, 단기사채,
 * 전환사채, 비유동 전환사채, 신주인수권부사채, 유동성신주인수권부사채. Exact-match means each
 * either hits the real label or harmlessly misses — never a false positive.
 *
 * 리스부채 (operating, already in FCF) is intentionally EXCLUDED. Caveat: a filer reporting
 * BOTH itemized borrowings AND a bare "차입금" subtotal would double-count — not observed
 * (fnlttSinglAcntAll lists reported leaves, not computed subtotals), and Step 7 of the DCF
 * skill cross-checks |Net Debt| vs market cap as a backstop.
 */
export const DEBT_SUM_SPEC: SumSpec = {
  sjDiv: 'BS',
  kind: 'amount',
  accountIds: [
    'ifrs-full_ShorttermBorrowings',
    'ifrs-full_CurrentPortionOfLongtermBorrowings',
    'ifrs-full_NoncurrentPortionOfNoncurrentLoansReceived',
    'ifrs-full_LongtermBorrowings',
    'ifrs-full_NoncurrentPortionOfNoncurrentBondsIssued',
    'ifrs-full_BondsIssued',
    'dart_CurrentPortionOfConvertibleBonds',
  ],
  accountNms: [
    '단기차입금',
    '차입금',
    '유동성장기부채',
    '유동성장기차입금',
    '장기차입금',
    '유동성사채',
    '사채',
    '단기사채',
    '유동전환사채',
    '전환사채',
    '비유동 전환사채',
    '신주인수권부사채',
    '유동성신주인수권부사채',
  ],
};

const BASIS_NOTES: Record<ReportType, string> = {
  annual: '연간(thstrm=당기, frmtrm=전기). 손익·현금흐름 YoY 비교 가능.',
  semiannual: '반기 누적(thstrm=당반기 누적, frmtrm=전년 동기 누적). 손익·현금흐름은 6개월 YTD.',
  quarterly_1: '1분기 누적(thstrm=당기, frmtrm=전년 동기). 손익·현금흐름은 YTD; BS는 분기말 vs 전년말.',
  quarterly_3: '3분기 누적(9개월 YTD, 분기 단독 아님). 손익·현금흐름은 누적; 분기 단독값은 별도 계산 필요.',
};

/** Parse a DART numeric string ("-1,234" / "" / "-") into a number or null. */
export function parseAmount(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim().replace(/,/g, '');
  if (s === '' || s === '-') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Collapse whitespace for tolerant account_nm comparison. */
function squash(s: string): string {
  return s.replace(/\s+/g, '');
}

/** Format a KRW amount as 조/억 (rounded), preserving sign. */
export function formatKrw(n: number | null): string | null {
  if (n === null) return null;
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (abs >= 1e12) return `${sign}${(abs / 1e12).toFixed(1)}조`;
  if (abs >= 1e8) return `${sign}${Math.round(abs / 1e8).toLocaleString('en-US')}억`;
  return n.toLocaleString('en-US');
}

function formatDisplay(value: number | null, kind: MetricKind): string | null {
  if (value === null) return null;
  if (kind === 'eps') return `${value.toLocaleString('en-US')}원`;
  return formatKrw(value);
}

const EMPTY_METRIC: MetricVal = { current: null, prior: null, label: null, display: null };

/**
 * Resolve one metric from the line-item list per its AccountSpec.
 *
 * Matching is account_id first, then EXACT account_nm (whitespace-insensitive). We
 * deliberately do NOT do substring matching: e.g. "영업이익" is a substring of the
 * bank line "신용손실충당금 반영전 영업이익" and of "순영업이익", which would silently
 * resolve operatingProfit to the wrong figure and poison every margin. When no exact
 * match exists (banks/holdcos with non-standard labels), the metric stays null and the
 * model drills into rawLineItemsFile instead.
 */
export function findMetric(list: DartRow[], spec: AccountSpec): MetricVal {
  for (const sjDiv of spec.sjDivs) {
    const rows = list.filter((r) => r.sj_div === sjDiv);
    if (rows.length === 0) continue;

    // 1. Stable account_id (preference-ordered).
    for (const id of spec.accountIds) {
      const row = rows.find((r) => r.account_id === id);
      if (row) return toMetric(row, spec.kind);
    }
    // 2. Exact account_nm (whitespace-insensitive) — no substring matching, see above.
    for (const nm of spec.accountNms) {
      const target = squash(nm);
      const row = rows.find((r) => r.account_nm && squash(r.account_nm) === target);
      if (row) return toMetric(row, spec.kind);
    }
  }
  return { ...EMPTY_METRIC };
}

/**
 * Prior-year same-period amount. On quarterly/semiannual flow statements DART leaves
 * frmtrm_amount empty and carries 전년 동기 in frmtrm_q_amount; on annual reports (and the
 * quarterly balance sheet) there is no _q field, so fall back to frmtrm_amount (전기 /
 * 전년말). Without this, quarterly YoY is silently null.
 */
function priorAmount(row: DartRow): number | null {
  const priorQ = parseAmount(row.frmtrm_q_amount);
  return priorQ !== null ? priorQ : parseAmount(row.frmtrm_amount);
}

function toMetric(row: DartRow, kind: MetricKind): MetricVal {
  const current = parseAmount(row.thstrm_amount);
  return {
    current,
    prior: priorAmount(row),
    label: row.account_nm ?? null,
    display: formatDisplay(current, kind),
  };
}

/**
 * Sum every BS row whose account_id ∈ spec.accountIds OR account_nm (whitespace-
 * insensitive) ∈ spec.accountNms, counting each physical row once. Used for totalDebt,
 * which spans several borrowing lines. Returns EMPTY_METRIC when nothing matches; a filer
 * missing some borrowing lines still gets the sum of the ones it reports.
 *
 * NOTE: do NOT put the sentinel `-표준계정코드 미사용-` in accountIds — many unrelated rows
 * share it; those lines are matched by their exact account_nm instead.
 */
export function sumMetrics(list: DartRow[], spec: SumSpec): MetricVal {
  const idSet = new Set(spec.accountIds);
  const nmSet = new Set(spec.accountNms.map(squash));
  const matched = list.filter(
    (r) =>
      r.sj_div === spec.sjDiv &&
      ((r.account_id !== undefined && idSet.has(r.account_id)) ||
        (r.account_nm !== undefined && nmSet.has(squash(r.account_nm)))),
  );
  if (matched.length === 0) return { ...EMPTY_METRIC };

  let current: number | null = null;
  let prior: number | null = null;
  for (const row of matched) {
    const c = parseAmount(row.thstrm_amount);
    if (c !== null) current = (current ?? 0) + c;
    const p = priorAmount(row);
    if (p !== null) prior = (prior ?? 0) + p;
  }
  const labels = [...new Set(matched.map((r) => r.account_nm).filter((n): n is string => !!n))];
  return {
    current,
    prior,
    label: labels.length > 0 ? labels.join(' + ') : null,
    display: formatDisplay(current, spec.kind),
  };
}

function yoyPct(m: MetricVal): number | null {
  if (m.current === null || m.prior === null || m.prior === 0) return null;
  return round1(((m.current - m.prior) / Math.abs(m.prior)) * 100);
}

function ratioPct(numer: number | null, denom: number | null): number | null {
  if (numer === null || denom === null || denom === 0) return null;
  return round1((numer / denom) * 100);
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export interface SummarizeOpts {
  bsns_year: number;
  report_type: ReportType;
  fs_div: FsDiv;
}

/** Build the normalized summary for one reporting period from its raw line items. */
export function summarizePeriod(list: DartRow[], opts: SummarizeOpts): FinancialSummary {
  const m = (key: keyof typeof ACCOUNT_SPECS): MetricVal => findMetric(list, ACCOUNT_SPECS[key]);

  const revenue = m('revenue');
  const operatingProfit = m('operatingProfit');
  const netIncome = m('netIncome');
  const controllingNetIncome = m('controllingNetIncome');
  const eps = m('eps');
  const totalAssets = m('totalAssets');
  const totalLiabilities = m('totalLiabilities');
  const totalDebt = sumMetrics(list, DEBT_SUM_SPEC);
  const totalEquity = m('totalEquity');
  const cashAndEquivalents = m('cashAndEquivalents');
  const shortTermInvestments = m('shortTermInvestments');
  const cfo = m('cfo');
  const cfi = m('cfi');
  const cff = m('cff');
  const capex = m('capex');

  // FCF = operating cash flow − capex. capex (유형자산의 취득) is reported as a cash
  // outflow; treat it as a use regardless of reported sign.
  const freeCashFlow =
    cfo.current === null || capex.current === null
      ? null
      : cfo.current - Math.abs(capex.current);

  // ROE mixes a flow (net income) with a stock (equity); only meaningful over a full
  // year. Quarterly/semiannual net income is YTD-cumulative, so skip to avoid a
  // misleadingly low partial-year ROE. Basis: total net income / total equity (both
  // incl. non-controlling interests for CFS).
  const roePct = opts.report_type === 'annual' ? ratioPct(netIncome.current, totalEquity.current) : null;

  return {
    bsns_year: opts.bsns_year,
    report_type: opts.report_type,
    fs_div: opts.fs_div,
    unit: 'KRW',
    basis: BASIS_NOTES[opts.report_type],
    incomeStatement: { revenue, operatingProfit, netIncome, controllingNetIncome, eps },
    balanceSheet: { totalAssets, totalLiabilities, totalDebt, totalEquity, cashAndEquivalents, shortTermInvestments },
    cashFlow: { operating: cfo, investing: cfi, financing: cff, capex },
    ratios: {
      operatingMarginPct: ratioPct(operatingProfit.current, revenue.current),
      netMarginPct: ratioPct(netIncome.current, revenue.current),
      roePct,
      debtToEquityPct: ratioPct(totalLiabilities.current, totalEquity.current),
      revenueYoYPct: yoyPct(revenue),
      operatingProfitYoYPct: yoyPct(operatingProfit),
      netIncomeYoYPct: yoyPct(netIncome),
      freeCashFlow,
      freeCashFlowDisplay: formatKrw(freeCashFlow),
    },
  };
}
