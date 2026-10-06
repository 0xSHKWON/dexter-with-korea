export interface PromptExample {
  /** Compact copy shown on the chat empty state. */
  mainLabel: string;
  /** Full prompt inserted into the composer. */
  p: string;
  why: string;
  tags: string[];
}

export interface PromptGroup {
  label: string;
  icon: string;
  tone: 'blue' | 'violet' | 'cyan' | 'amber' | 'rose' | 'slate';
  featured?: boolean;
  items: PromptExample[];
}

// These are product demonstrations, not generic finance questions. Each prompt
// is deliberately shaped to require Dexter's first-party KR data and/or a
// specialist workflow, then end in an auditable investment judgment.
export const PROMPT_GROUPS: PromptGroup[] = [
  {
    label: '한 질문으로 투자 판단',
    icon: '360°',
    tone: 'blue',
    featured: true,
    items: [
      {
        mainLabel: '삼성전자, 지금 신규 매수해도 될까?',
        p: '삼성전자를 지금 신규 매수해도 될까? 최근 3년 실적·잉여현금흐름과 사업부별 이익기여도, 현재 밸류에이션, 외국인 수급·공매도, 지배구조를 동종기업과 비교하고 Bull/Base/Bear 시나리오별 투자 판단과 판단을 뒤집을 조건까지 정리해줘.',
        why: '재무·사업부문·수급·공매도·지배구조·peer를 연결해 결론과 반증 조건까지 제시',
        tags: ['재무', '수급', '공매도', '지배구조', 'Peer 비교'],
      },
    ],
  },
  {
    label: '비교 · 랭킹 · 주주환원',
    icon: 'VS',
    tone: 'violet',
    items: [
      {
        mainLabel: '반도체 3사 투자매력 순위를 매겨줘',
        p: '삼성전자·SK하이닉스·한미반도체를 같은 기준일로 비교해줘. 최근 실적 성장, 잉여현금흐름, 재무건전성, 밸류에이션, 주가 베타, 외국인 수급을 점수표로 만들고 각 점수의 1차 근거와 함께 12개월 투자매력 순위를 매겨줘.',
        why: '세 종목의 데이터 기준일을 맞추고 6개 축을 정량화해 재현 가능한 순위로',
        tags: ['3종목', 'Scorecard', 'β', '1차 출처'],
      },
      {
        mainLabel: '현대차와 기아, 주주환원 매력은 누가 앞설까?',
        p: '현대차와 기아 중 주주환원 관점에서 어느 종목이 더 매력적인지 비교해줘. 최근 3년 배당·자사주 매입과 소각, 총주주환원율, 순현금, 밸류에이션을 확인하고 현재 할인율이 축소될 구체적 트리거와 리스크까지 평가해줘.',
        why: '배당만 보지 않고 자사주·재무여력·밸류에이션을 묶어 할인 해소 가능성을 평가',
        tags: ['주주환원', '자사주', '배당', '밸류에이션'],
      },
    ],
  },
  {
    label: '이익의 질 검증',
    icon: 'CASH',
    tone: 'cyan',
    items: [
      {
        mainLabel: '삼성전자 이익, 현금으로도 들어오고 있을까?',
        p: '삼성전자의 최근 3년 이익 성장이 실제 현금으로 이어졌는지 검증해줘. 순이익과 영업현금흐름의 괴리, 발생액, 매출채권·재고자산 변화, 일회성 손익을 분석하고 연결·별도 기준 차이까지 확인해 이익의 질을 A~F로 평가해줘.',
        why: '손익계산서의 성장률을 현금흐름·운전자본·일회성 항목으로 교차검증',
        tags: ['이익의 질', '현금전환', '운전자본', 'DART'],
      },
    ],
  },
  {
    label: '수급 신호 교차검증',
    icon: 'FLOW',
    tone: 'cyan',
    items: [
      {
        mainLabel: '에코프로비엠 수급, 상승 신호일까 경고일까?',
        p: '에코프로비엠의 최근 6개월 주가, 외국인 보유율·순매수, 공매도 순보유잔고를 같은 시계열로 비교해줘. 가격과 수급이 엇갈린 구간을 찾아 지금 흐름이 추세 강화인지 경고 신호인지 근거와 기준일을 붙여 판단해줘.',
        why: 'KRX·네이버 일별 데이터를 같은 축에 놓고 가격과 수급의 divergence를 탐지',
        tags: ['KRX', 'NAVER', '공매도', '외국인 수급'],
      },
      {
        mainLabel: '삼성SDI 장기 자금은 들어오고 있을까?',
        p: '삼성SDI에 장기 자금이 들어오고 있는지 확인해줘. 국민연금 보유, 5% 이상 대량보유자 변동, 최대주주·특수관계인 지분, 외국인 보유율 추이를 함께 보고 단기 수급과 장기 지분 변화가 같은 방향인지 판단해줘.',
        why: '국민연금·대량보유 공시·최대주주·외국인을 합쳐 자금의 성격까지 구분',
        tags: ['국민연금', '5% 공시', '대주주', '외국인'],
      },
    ],
  },
  {
    label: '기업 유형에 맞춘 적정가치',
    icon: '₩',
    tone: 'amber',
    items: [
      {
        mainLabel: 'SK 지주사 할인은 정말 과도할까?',
        p: 'SK의 상장·비상장 자회사 지분가치와 순차입금을 분해해 SOTP/NAV를 계산해줘. 현재 시가총액의 지주사 할인율을 구하고, 중복상장·비상장 가치 불확실성을 반영한 보수적/Base 시나리오와 할인 축소 트리거까지 제시해줘.',
        why: '지주사에 부적합한 연결 PER·DCF 대신 실제 보유지분 기반 NAV로 평가',
        tags: ['SOTP', 'NAV', '보유지분', '지주사 할인'],
      },
      {
        mainLabel: 'NAVER 적정주가를 DCF로 계산해줘',
        p: 'NAVER의 적정주가를 DCF로 계산해줘. 최근 재무에서 정상화 FCF를 만들고 한국은행 국고채 10년물, 직접 산출한 주가 베타, 자본구조를 사용해 WACC를 구성해줘. 핵심 가정의 출처·기준일과 Bull/Base/Bear 민감도, 현재가 대비 상승여력까지 보여줘.',
        why: '추정 WACC가 아니라 ECOS 금리·회귀 β·실제 자본구조를 사용한 감사 가능한 DCF',
        tags: ['DCF', 'ECOS', 'β', '민감도'],
      },
      {
        mainLabel: 'SK하이닉스, DCF보다 상대가치가 맞을까?',
        p: 'SK하이닉스는 이익 변동성이 큰데 DCF와 상대가치 중 어떤 방법이 더 적합한지 먼저 판단해줘. 삼성전자와 글로벌 메모리 peer의 PBR·EV/EBITDA, 정상화 이익, 성장성과 수익성 차이를 비교해 적정 멀티플과 목표주가 범위를 제시해줘.',
        why: '경기민감주에 평가법을 기계적으로 적용하지 않고 through-cycle peer valuation으로 라우팅',
        tags: ['상대가치', 'PBR', 'EV/EBITDA', '정상이익'],
      },
    ],
  },
  {
    label: '지배구조 · 기업 이벤트',
    icon: 'DART',
    tone: 'rose',
    items: [
      {
        mainLabel: 'LG화학 물적분할은 기존 주주에게 득이었을까?',
        p: 'LG화학의 배터리 사업 물적분할부터 LG에너지솔루션 상장까지 공시 원문으로 타임라인을 재구성해줘. 분할 전후 지분구조, 모회사 주주의 경제적 권리, IPO 희석과 이중상장 할인을 따져 기존 LG화학 주주에게 득이었는지 평가해줘.',
        why: '뉴스 요약이 아니라 분할·상장 공시와 지분구조를 연결해 모회사 주주 관점에서 판정',
        tags: ['물적분할', 'DART 원문', '희석', '이중상장'],
      },
      {
        mainLabel: '삼성전자 지배구조의 핵심 연결고리를 그려줘',
        p: '삼성전자 사업보고서와 대량보유 공시를 기준으로 최대주주·특수관계인·계열사·국민연금의 지분 관계를 정리해줘. 최근 지분 변동과 실질 지배력의 핵심 연결고리를 설명하고 일반주주 관점의 지배구조 리스크를 근거별로 평가해줘.',
        why: '정적인 주주명부를 넘어 관계인·계열사 연결과 최근 변동을 함께 해석',
        tags: ['최대주주', '특수관계인', '계열사', '국민연금'],
      },
    ],
  },
  {
    label: '의사결정용 투자 메모',
    icon: 'MEMO',
    tone: 'slate',
    items: [
      {
        mainLabel: '삼성바이오로직스 투자 메모를 작성해줘',
        p: '삼성바이오로직스에 대한 신규 매수 검토용 투자 메모를 작성해줘. 핵심 투자 논거 3개, 시장이 놓치고 있는 변수, 밸류에이션 앵커, 12개월 촉매, 하방 리스크와 논거가 훼손되는 관찰 지표를 1차 출처와 기준일이 포함된 형태로 정리해줘.',
        why: '데이터 나열을 실제 매수 검토에 쓰는 논거·촉매·반증 조건 구조로 변환',
        tags: ['투자 논거', '촉매', '리스크', '반증 조건'],
      },
    ],
  },
];

export const MAIN_PROMPTS = PROMPT_GROUPS.flatMap((group) =>
  group.items.map((item) => ({ label: item.mainLabel, prompt: item.p })),
);

export type MainPrompt = (typeof MAIN_PROMPTS)[number];

/** Draw distinct prompts, excluding the previous set when the pool is large enough. */
export function sampleMainPrompts(
  previous: MainPrompt[] = [],
  count = 4,
  random: () => number = Math.random,
): MainPrompt[] {
  const previousPrompts = new Set(previous.map((item) => item.prompt));
  const fresh = MAIN_PROMPTS.filter((item) => !previousPrompts.has(item.prompt));
  const candidates = fresh.length >= count ? fresh : MAIN_PROMPTS;
  const shuffled = candidates.slice();

  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  return shuffled.slice(0, Math.min(count, shuffled.length));
}
