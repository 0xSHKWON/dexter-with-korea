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
   * 전년 동기 — present only on quarterly/semiannual flow statements (IS/CIS/CF).
   * DART leaves frmtrm_amount empty there and puts the prior-year SAME period here
   * (for IS rows that is the prior-year 3-MONTH figure, matching thstrm_amount).
   */
  frmtrm_q_amount?: string;
  /**
   * 당기 누적 — on quarterly/semiannual IS/CIS rows, thstrm_amount is the 3-MONTH
   * STANDALONE figure and THIS field carries the fiscal-YTD cumulative. CF rows have
   * no add field: their thstrm_amount is already cumulative. Verified against live
   * DART payloads (005930 2025 Q3: 매출 thstrm=86.1조(3M) vs add=239.8조(9M YTD);
   * 반기 thstrm=74.6조(2Q 3M) vs add=153.7조(6M); Q1 thstrm=add).
   */
  thstrm_add_amount?: string;
  /** 전년 동기 누적 — the prior-year counterpart of thstrm_add_amount. */
  frmtrm_add_amount?: string;
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
  /**
   * Fiscal-YTD cumulative — present ONLY on income-statement metrics of
   * quarterly/semiannual reports, where `current`/`prior` are the 3-MONTH
   * STANDALONE amounts (DART thstrm_amount / frmtrm_q_amount) and these carry
   * thstrm_add_amount / frmtrm_add_amount. Absent on annual reports and on
   * BS/CF metrics (quarterly CF is already cumulative in `current`).
   */
  ytdCurrent?: number | null;
  ytdPrior?: number | null;
  ytdDisplay?: string | null;
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
    /**
     * 비지배지분 (non-controlling interests, book value) — the consolidated equity
     * that belongs to subsidiary minority holders, NOT to this company's own
     * shareholders. An EV→Equity bridge must subtract it (Equity Value = EV −
     * Net Debt − NCI) or a consolidated DCF attributes 100% of subsidiary value
     * to the parent's shareholders.
     */
    nonControllingInterests: MetricVal;
    cashAndEquivalents: MetricVal;
    /** 단기금융상품 — short-term financial instruments, cash-equivalent for the net-debt bridge. */
    shortTermInvestments: MetricVal;
  };
  cashFlow: {
    operating: MetricVal;
    investing: MetricVal;
    financing: MetricVal;
    capex: MetricVal;
    /** 이자의 지급 — needed to normalize FCF to FCFF when a filer classifies it as operating. */
    interestPaid: MetricVal;
    /**
     * Where 이자의 지급 sits in the cash-flow statement (K-IFRS allows either).
     * 'operating' → the reported CFO is already net of interest, so FCFF needs
     * back-adding after-tax interest; 'financing' → CFO is pre-interest (no
     * adjustment); null → not found or classification unknown (sentinel id).
     */
    interestPaidClassification: 'operating' | 'financing' | null;
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
  // 비지배지분 — BS only (IS/CIS also carry rows literally named '비지배지분' for the
  // P&L attribution, so the sj_div filter is what keeps this on the equity balance).
  // id/nm verified live: 삼성전자 FY2024 10.5조, LG화학 FY2024 14.7조.
  nonControllingInterests: {
    sjDivs: ['BS'],
    accountIds: ['ifrs-full_NoncontrollingInterests'],
    accountNms: ['비지배지분', '비지배주주지분'],
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
};

/**
 * Capex for the FCF calc: 유형자산 취득 + 무형자산 취득, summed. Intangible purchases
 * are real investing cash outflows — 통신 주파수이용권, 자본화 개발비(바이오), 소프트웨어
 * (게임·플랫폼) — so a PP&E-only capex systematically overstates FCF exactly in the
 * sectors the DCF skill treats as DCF-suitable. Verified against live DART CFS
 * (005930 FY2024): 유형자산의 취득 51.4조 + 무형자산의 취득 2.3조, both under the
 * standard ifrs-full ids. 처분(proceeds) lines use different ids/labels and are
 * excluded by the exact-match rule.
 */
export const CAPEX_SUM_SPEC: SumSpec = {
  sjDiv: 'CF',
  kind: 'amount',
  accountIds: [
    'ifrs-full_PurchaseOfPropertyPlantAndEquipmentClassifiedAsInvestingActivities',
    'ifrs-full_PurchaseOfIntangibleAssetsClassifiedAsInvestingActivities',
  ],
  accountNms: ['유형자산의 취득', '유형자산의 증가', '무형자산의 취득', '무형자산의 증가'],
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

// Verified against live DART payloads (005930 2025 Q1/반기/Q3) — quarterly IS
// thstrm_amount is the 3-MONTH figure, NOT cumulative; the cumulative lives in
// thstrm_add_amount (exposed as ytdCurrent). Quarterly CF has no add field and
// its thstrm_amount IS cumulative. Mislabeling this direction is a 3x error.
const BASIS_NOTES: Record<ReportType, string> = {
  annual: '연간(current=당기, prior=전기). 손익·현금흐름 YoY 비교 가능.',
  semiannual:
    '반기: 손익 current=2분기 3개월 단독(prior=전년 동기 3개월), ytdCurrent=상반기 6개월 누적(ytdPrior=전년 동기 누적). 현금흐름은 6개월 누적(FCF 포함). BS는 반기말 vs 전년말.',
  quarterly_1: '1분기: 손익·현금흐름 모두 3개월(단독=누적; ytdCurrent=current). BS는 분기말 vs 전년말.',
  quarterly_3:
    '3분기: 손익 current=3분기 3개월 단독(prior=전년 동기 3개월), ytdCurrent=9개월 누적(ytdPrior=전년 동기 누적). 현금흐름은 9개월 누적(3개월 단독 아님; FCF도 누적 기준). BS는 분기말 vs 전년말.',
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
export function findMetric(list: DartRow[], spec: AccountSpec, opts?: { withYtd?: boolean }): MetricVal {
  for (const sjDiv of spec.sjDivs) {
    const rows = list.filter((r) => r.sj_div === sjDiv);
    if (rows.length === 0) continue;

    // 1. Stable account_id (preference-ordered).
    for (const id of spec.accountIds) {
      const row = rows.find((r) => r.account_id === id);
      if (row) return toMetric(row, spec.kind, opts?.withYtd);
    }
    // 2. Exact account_nm (whitespace-insensitive) — no substring matching, see above.
    for (const nm of spec.accountNms) {
      const target = squash(nm);
      const row = rows.find((r) => r.account_nm && squash(r.account_nm) === target);
      if (row) return toMetric(row, spec.kind, opts?.withYtd);
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

function toMetric(row: DartRow, kind: MetricKind, withYtd = false): MetricVal {
  const current = parseAmount(row.thstrm_amount);
  const base: MetricVal = {
    current,
    prior: priorAmount(row),
    label: row.account_nm ?? null,
    display: formatDisplay(current, kind),
  };
  if (!withYtd) return base;
  const ytdCurrent = parseAmount(row.thstrm_add_amount);
  return {
    ...base,
    ytdCurrent,
    ytdPrior: parseAmount(row.frmtrm_add_amount),
    ytdDisplay: formatDisplay(ytdCurrent, kind),
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

/**
 * 이자의 지급 with its cash-flow classification. K-IFRS (IAS 7) allows interest paid
 * under operating OR financing; the standard account_id encodes which. When only the
 * bare label matches (sentinel account_id), the classification is unknowable from the
 * flat row list → null, and the caller must not assume either way.
 * Verified live: 삼성전자·LG화학 both use InterestPaidClassifiedAsOperatingActivities.
 */
const INTEREST_PAID_IDS: ReadonlyArray<readonly [string, 'operating' | 'financing']> = [
  ['ifrs-full_InterestPaidClassifiedAsOperatingActivities', 'operating'],
  ['ifrs-full_InterestPaidClassifiedAsFinancingActivities', 'financing'],
];

export function findInterestPaid(list: DartRow[]): {
  metric: MetricVal;
  classification: 'operating' | 'financing' | null;
} {
  const cfRows = list.filter((r) => r.sj_div === 'CF');
  for (const [id, classification] of INTEREST_PAID_IDS) {
    const row = cfRows.find((r) => r.account_id === id);
    if (row) return { metric: toMetric(row, 'amount'), classification };
  }
  const names = new Set(['이자의지급', '이자지급', '이자의지급액'].map(squash));
  const row = cfRows.find((r) => r.account_nm && names.has(squash(r.account_nm)));
  if (row) return { metric: toMetric(row, 'amount'), classification: null };
  return { metric: { ...EMPTY_METRIC }, classification: null };
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
  // Quarterly/semiannual IS rows carry 3-month standalone in thstrm_amount and the
  // fiscal-YTD cumulative in thstrm_add_amount — expose BOTH so neither gets mislabeled.
  const withYtd = opts.report_type !== 'annual';
  const is = (key: keyof typeof ACCOUNT_SPECS): MetricVal => findMetric(list, ACCOUNT_SPECS[key], { withYtd });

  const revenue = is('revenue');
  const operatingProfit = is('operatingProfit');
  const netIncome = is('netIncome');
  const controllingNetIncome = is('controllingNetIncome');
  const eps = is('eps');
  const totalAssets = m('totalAssets');
  const totalLiabilities = m('totalLiabilities');
  const totalDebt = sumMetrics(list, DEBT_SUM_SPEC);
  const totalEquity = m('totalEquity');
  const nonControllingInterests = m('nonControllingInterests');
  const cashAndEquivalents = m('cashAndEquivalents');
  const shortTermInvestments = m('shortTermInvestments');
  const cfo = m('cfo');
  const cfi = m('cfi');
  const cff = m('cff');
  const capex = sumMetrics(list, CAPEX_SUM_SPEC);
  const interestPaid = findInterestPaid(list);

  // FCF = operating cash flow − capex. capex (유·무형자산의 취득 합산) is reported as a
  // cash outflow; treat it as a use regardless of reported sign.
  const freeCashFlow =
    cfo.current === null || capex.current === null
      ? null
      : cfo.current - Math.abs(capex.current);

  // ROE mixes a flow (net income) with a stock (equity); only meaningful over a full
  // year. Quarterly/semiannual net income covers 3 months (current) or a partial-year
  // cumulative (ytdCurrent) — either denominator mismatch would mislead, so skip.
  // Basis: total net income / total equity (both incl. non-controlling interests for CFS).
  const roePct = opts.report_type === 'annual' ? ratioPct(netIncome.current, totalEquity.current) : null;

  return {
    bsns_year: opts.bsns_year,
    report_type: opts.report_type,
    fs_div: opts.fs_div,
    unit: 'KRW',
    basis: BASIS_NOTES[opts.report_type],
    incomeStatement: { revenue, operatingProfit, netIncome, controllingNetIncome, eps },
    balanceSheet: { totalAssets, totalLiabilities, totalDebt, totalEquity, nonControllingInterests, cashAndEquivalents, shortTermInvestments },
    cashFlow: {
      operating: cfo,
      investing: cfi,
      financing: cff,
      capex,
      interestPaid: interestPaid.metric,
      interestPaidClassification: interestPaid.classification,
    },
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
