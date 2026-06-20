// The KR research question bank + rubric metadata. Each entry pins which KR
// tools the agent should reach for (deterministic gate) and which answer-quality
// dimensions an LLM judge should score (see judge.ts). Adding a question here is
// all that's needed to extend the harness.

/** Answer-quality dimensions scored by the LLM judge (judge.ts). */
export type DimensionId =
  | 'earnings_yoy'
  | 'earnings_momentum'
  | 'cross_signal'
  | 'governance'
  | 'relative_value'
  | 'value_up'
  | 'grounding';

/**
 * A deterministic numeric-accuracy gate: a value the answer MUST state within
 * tolerance (anti-hallucination — catches a plausible-but-wrong number the LLM judge
 * waves through). Anchor `value`s to a committed fixture's figures so they stay stable.
 *  - unit 'krw'   → matched against 조/억 amounts parsed from the answer; tolerancePct is RELATIVE % (default 5).
 *  - unit 'pct'   → matched against `N%` figures; tolerancePct is ABSOLUTE percentage-points (default 1).
 *  - unit 'count' → matched against comma-grouped integers; tolerancePct is RELATIVE % (default 5).
 */
export interface NumericAnchor {
  label: string;
  value: number;
  unit: 'krw' | 'pct' | 'count';
  tolerancePct?: number;
}

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
  /** Hard gate: these substrings MUST appear in the answer (whitespace/case-insensitive) — e.g. the resolved name or a segment label. */
  requiredPhrases?: string[];
  /** Hard gate: each value MUST appear in the answer within tolerance (anti-hallucination). */
  numericAnchors?: NumericAnchor[];
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
    // Anchored to fixtures/default/samsung-fundamentals.json (revenue 133.9조, OP 57.2조):
    // a deterministic accuracy gate that fails a plausible-but-wrong figure the judge misses.
    numericAnchors: [
      { label: '매출', value: 133.9e12, unit: 'krw', tolerancePct: 3 },
      { label: '영업이익', value: 57.2e12, unit: 'krw', tolerancePct: 5 },
    ],
    notes: '단일 종목 펀더멘털 — 손익 + 전년대비 숫자가 핵심. grounding + numericAnchors로 YoY/수치가 툴 데이터에 실제 근거하는지 교차검증.',
  },
  {
    id: 'business-overview-samsung',
    query: '삼성전자(005930) 사업보고서 보면 사업이 어떤 사업부문으로 구성돼 있어?',
    ticker: '005930',
    expectedTools: ['read_filings_kr'],
    requiredTools: ['read_filings_kr'],
    dimensions: ['grounding'],
    notes: '사업보고서 「II. 사업의 내용」 내러티브 추출 → 사업부문/제품 구성. 환각 없이 본문에 근거해 설명하는지(grounding)로 채점.',
  },
  {
    id: 'key-risks-samsung',
    query: '삼성전자 주요 리스크가 뭐야?',
    ticker: '005930',
    expectedTools: ['read_filings_kr'],
    requiredTools: ['read_filings_kr'],
    dimensions: ['grounding'],
    notes: '리스크는 단일 섹션이 아니라 II.5 위험관리 + XI 투자자보호로 분산 → read_filings_kr가 본문 근거로 종합하는지(grounding). 운영/재무 리스크 내러티브라 governance(지배구조 valuation) 차원은 제외.',
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

  // ── Coverage expansion (M3): de-bias the 삼성-heavy bank and exercise the new
  // M2 tools/skills. These have no recorded fixture yet, so they run in live/record
  // and SKIP under replay until `bun run kr-eval:record` captures them.
  {
    id: 'segments-samsung',
    query: '삼성전자(005930) 사업부문별 매출이랑 영업이익 비중 알려줘.',
    ticker: '005930',
    expectedTools: ['get_segments_kr'],
    requiredTools: ['get_segments_kr'],
    dimensions: ['grounding'],
    // DX/DS are Samsung's reported segment labels — a correct answer must name them.
    requiredPhrases: ['DX', 'DS'],
    notes: '신규 get_segments_kr — 사업부문별 요약 재무현황 추출이 답에 반영되는지(부문명 + grounding).',
  },
  {
    id: 'name-resolution-koreazinc',
    query: '고려아연 외국인 지분율이랑 현재가 어때?',
    expectedTools: ['get_market_data_kr', 'get_foreign_ownership_kr'],
    requiredTools: ['get_market_data_kr'],
    dimensions: ['grounding'],
    // Name-only (no ticker): the resolver must land on 고려아연(010130), not a wrong code.
    // The resolved name appearing is the anti-"silent wrong company" check.
    requiredPhrases: ['고려아연'],
    notes: '이름 해석 경로(티커 미제공) — resolveKrSecurity가 정확한 종목으로 라우팅되는지.',
  },
  {
    id: 'holdco-sotp-lg',
    query: 'LG(003550) 지주사인데 NAV(순자산가치) 대비 얼마나 할인돼 거래되는지 봐줘.',
    ticker: '003550',
    expectedTools: ['get_market_data_kr', 'get_large_holders_kr', 'read_filings_kr'],
    requiredTools: ['get_market_data_kr'],
    dimensions: ['governance', 'grounding'],
    thresholds: { governance: 0.6 },
    notes: '지주사 SOTP/NAV — kr-sotp-holdco 스킬 경로. 지주사 할인을 가치요인으로 다루는지(governance).',
  },
  {
    id: 'value-up-hyundai',
    query: '현대차(005380) PBR도 낮은데 밸류업·주주환원(자사주 소각·배당) 기대할 만해?',
    ticker: '005380',
    expectedTools: ['get_market_data_kr', 'get_filings_kr'],
    requiredTools: ['get_market_data_kr'],
    dimensions: ['value_up', 'grounding'],
    notes: '밸류업/주주환원 — kr-shareholder-return 스킬. PBR<1 re-rating·환원 공시를 평가하는지(value_up).',
  },
  {
    id: 'relative-value-hynix',
    query: 'SK하이닉스(000660) 동종업계 대비 밸류에이션 싼 편이야? PER/PBR로 비교해줘.',
    ticker: '000660',
    expectedTools: ['get_market_data_kr'],
    requiredTools: ['get_market_data_kr'],
    dimensions: ['relative_value', 'grounding'],
    notes: '경기민감주 상대가치 — kr-relative-valuation. peer 멀티플 비교가 답에 들어가는지(relative_value).',
  },
  {
    id: 'bank-valuation-kb',
    query: 'KB금융(105560) 밸류에이션 어때? 은행이니까 PBR이랑 ROE 기준으로.',
    ticker: '105560',
    expectedTools: ['get_market_data_kr', 'get_financials_kr'],
    requiredTools: ['get_market_data_kr'],
    dimensions: ['relative_value', 'grounding'],
    notes: '은행주 — 영업이익-YoY 프레임이 아닌 PBR/ROE로 답하는지. 업종 적합 프레임 선택 테스트.',
  },
  {
    id: 'earnings-momentum-hynix',
    query: 'SK하이닉스(000660) 실적 모멘텀 어때? 전분기 대비(QoQ)랑 컨센서스 대비로.',
    ticker: '000660',
    expectedTools: ['get_financials_kr', 'get_market_data_kr'],
    requiredTools: ['get_financials_kr'],
    dimensions: ['earnings_momentum', 'grounding'],
    notes: 'QoQ + forward 컨센서스 모멘텀 — YoY만이 아닌 분기 변곡/컨센 부합을 다루는지(earnings_momentum).',
  },
  {
    id: 'preferred-share-samsung',
    query: '삼성전자우(005935)랑 보통주(005930) 괴리율 어때?',
    ticker: '005935',
    expectedTools: ['get_market_data_kr'],
    requiredTools: ['get_market_data_kr'],
    dimensions: ['grounding'],
    requiredPhrases: ['우선주'],
    notes: '우선주/보통주 — 6자리 우선주 코드 라우팅 + 괴리 개념을 다루는지.',
  },
];
