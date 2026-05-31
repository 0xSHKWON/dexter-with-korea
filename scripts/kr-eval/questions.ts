// The KR research question bank + rubric metadata. Each entry pins which KR
// tools the agent should reach for (deterministic gate) and which answer-quality
// dimensions an LLM judge should score (see judge.ts). Adding a question here is
// all that's needed to extend the harness.

/** Answer-quality dimensions scored by the LLM judge (judge.ts). */
export type DimensionId = 'earnings_yoy' | 'cross_signal' | 'governance' | 'grounding';

export interface KrEvalQuestion {
  /** Stable id — also the fixture filename (scripts/kr-eval/fixtures/<scenario>/<id>.json). */
  id: string;
  /** The user query fired at the agent. */
  query: string;
  /** Primary ticker (for fixture/debug context; not used for scoring). */
  ticker?: string;
  /** Tools that SHOULD fire — scored as coverage (soft). */
  expectedTools: string[];
  /** Subset of expectedTools that MUST fire — a hard gate (defaults to expectedTools if omitted). */
  requiredTools?: string[];
  /** Which judge dimensions apply to this question. */
  dimensions: DimensionId[];
  /** Per-dimension pass threshold override (default DEFAULT_THRESHOLD in scorer.ts). */
  thresholds?: Partial<Record<DimensionId, number>>;
  notes?: string;
}

export const KR_EVAL_QUESTIONS: KrEvalQuestion[] = [
  {
    id: 'samsung-fundamentals',
    query: '삼성전자(005930) 최근 실적 매출이랑 영업이익 YoY로 알려줘.',
    ticker: '005930',
    expectedTools: ['get_financials_kr'],
    requiredTools: ['get_financials_kr'],
    dimensions: ['earnings_yoy', 'grounding'],
    notes: '단일 종목 펀더멘털 — 손익 + 전년대비 숫자가 핵심. grounding으로 YoY가 툴 데이터에 실제 근거하는지 교차검증.',
  },
  {
    id: 'samsung-synthesis',
    query: '삼성전자 지금 투자 관점에서 어때?',
    ticker: '005930',
    expectedTools: [
      'get_financials_kr',
      'get_foreign_ownership_kr',
      'get_large_holders_kr',
      'get_filings_kr',
      'get_short_balance_kr',
    ],
    requiredTools: ['get_financials_kr', 'get_foreign_ownership_kr'],
    dimensions: ['earnings_yoy', 'cross_signal', 'governance', 'grounding'],
    // governance is one STRAND of a synthesis answer (not the focus), so the judge
    // consistently lands it ~0.70–0.78 — relax the bar vs. dedicated governance
    // questions (large-holders/spinoff score 0.92+ at the default 0.70).
    thresholds: { governance: 0.65 },
    notes: '교차신호 종합 — 수급·실적·지배구조를 하나의 thesis로.',
  },
  {
    id: 'foreign-flow-hynix',
    query: 'SK하이닉스(000660) 외국인 지분율하고 최근 순매수 흐름 어때?',
    ticker: '000660',
    expectedTools: ['get_foreign_ownership_kr'],
    requiredTools: ['get_foreign_ownership_kr'],
    dimensions: ['grounding'],
    notes: '단일 신호(외국인 수급) 질문 — 지분율·순매수 수치가 툴 데이터에 근거하는지(grounding)로 채점. 교차신호 thesis는 synthesis 질문에서만 요구.',
  },
  {
    id: 'short-balance-ecopro',
    query: '에코프로비엠(247540) 공매도 잔고비중 지금 어느 수준이야?',
    ticker: '247540',
    expectedTools: ['get_short_balance_kr'],
    requiredTools: ['get_short_balance_kr'],
    dimensions: ['grounding'],
    notes: 'KRX 공매도 — KRX 자격증명 없으면 skip.',
  },
  {
    id: 'institutional-vs-foreign',
    query: '오늘 삼성전자 기준으로 기관·외국인·개인 누가 사고 팔았어?',
    ticker: '005930',
    expectedTools: ['get_foreign_ownership_kr'],
    requiredTools: ['get_foreign_ownership_kr'],
    dimensions: ['grounding'],
    notes: '단일 신호(당일 매매동향) 질문 — Naver trend의 기관/외국인/개인 순매수 수치 근거(grounding)로 채점.',
  },
  {
    id: 'large-holders-samsung',
    query: '삼성전자 대량보유(5%룰) 현황하고 지배구조 함의 정리해줘.',
    ticker: '005930',
    expectedTools: ['get_large_holders_kr'],
    requiredTools: ['get_large_holders_kr'],
    dimensions: ['governance'],
    notes: '대량보유 → 순환출자/계열 지분 함의.',
  },
  {
    id: 'insider-trades-celltrion',
    query: '최근 셀트리온(068270) 임원·주요주주 소유 변동 있었어?',
    ticker: '068270',
    expectedTools: ['get_insider_trades_kr'],
    requiredTools: ['get_insider_trades_kr'],
    dimensions: ['grounding'],
    notes: '사실 조회("변동 있었어?") — 소유 변동 수치를 정확히 근거 있게 보고하는지(grounding)로 채점. 깊은 지배구조 valuation 분석은 large-holders/spinoff 질문이 담당.',
  },
  {
    id: 'spinoff-lgchem',
    query: 'LG화학(051910) 물적분할이 소액주주한테 어떤 영향이었어?',
    ticker: '051910',
    expectedTools: ['get_filings_kr'],
    requiredTools: ['get_filings_kr'],
    dimensions: ['governance'],
    notes: '물적분할 이벤트 — 소액주주/지주사 할인 관점. skill(kr-spinoff)도 가능.',
  },
  {
    id: 'nps-samsung',
    query: '국민연금이 삼성전자 얼마나 들고 있어?',
    ticker: '005930',
    expectedTools: ['get_nps_holdings'],
    requiredTools: ['get_nps_holdings'],
    dimensions: ['grounding'],
    notes: 'data.go.kr 서비스키 없으면 skip. 연말 스냅샷.',
  },
  {
    id: 'nps-top',
    query: '국민연금 보유 비중 상위 종목 알려줘.',
    expectedTools: ['get_nps_holdings'],
    requiredTools: ['get_nps_holdings'],
    dimensions: ['grounding'],
    notes: 'NPS 상위 보유 — 종목명 매칭.',
  },
  {
    id: 'filings-hyundai',
    query: '현대차(005380) 최근 주요 공시 뭐 있었어?',
    ticker: '005380',
    expectedTools: ['get_filings_kr'],
    requiredTools: ['get_filings_kr'],
    dimensions: ['grounding'],
    notes: '공시 메타데이터 검색.',
  },
  {
    id: 'cross-signal-alteogen',
    query: '알테오젠(196170) 투자 매력 종합 평가해줘 (수급·실적·지배구조).',
    ticker: '196170',
    expectedTools: ['get_financials_kr', 'get_foreign_ownership_kr', 'get_large_holders_kr'],
    requiredTools: ['get_financials_kr'],
    dimensions: ['earnings_yoy', 'cross_signal', 'governance', 'grounding'],
    // See samsung-synthesis: governance is a strand here, not the focus.
    thresholds: { governance: 0.65 },
    notes: 'KOSDAQ 교차신호 종합.',
  },
];
