interface KeyGuide {
  label: string;
  envVar: string;
  url: string;
  urlLabel: string;
  desc: string;
  required?: boolean;
}

interface Section {
  title: string;
  intro?: string;
  items: KeyGuide[];
  footnote?: string;
}

// Issuance guides. Env var names match the core (src/model/llm.ts, env.ts) exactly.
const SECTIONS: Section[] = [
  {
    title: 'LLM API 키 — 최소 1개 필요',
    intro: '챗을 쓰려면 아래 중 최소 하나의 키가 필요합니다. 한 곳만 발급해도 됩니다.',
    items: [
      { label: 'OpenAI', envVar: 'OPENAI_API_KEY', required: true, url: 'https://platform.openai.com/api-keys', urlLabel: 'platform.openai.com', desc: '로그인 → API keys → "Create new secret key".' },
      { label: 'Anthropic (Claude)', envVar: 'ANTHROPIC_API_KEY', url: 'https://console.anthropic.com/settings/keys', urlLabel: 'console.anthropic.com', desc: 'API Keys → "Create Key".' },
      { label: 'Google (Gemini)', envVar: 'GOOGLE_API_KEY', url: 'https://aistudio.google.com/app/apikey', urlLabel: 'aistudio.google.com', desc: '"Get API key" → 키 생성.' },
      { label: 'xAI (Grok)', envVar: 'XAI_API_KEY', url: 'https://console.x.ai', urlLabel: 'console.x.ai', desc: 'API Keys에서 발급.' },
      { label: 'OpenRouter', envVar: 'OPENROUTER_API_KEY', url: 'https://openrouter.ai/keys', urlLabel: 'openrouter.ai', desc: '여러 모델을 한 키로. Keys에서 발급.' },
      { label: 'DeepSeek', envVar: 'DEEPSEEK_API_KEY', url: 'https://platform.deepseek.com', urlLabel: 'platform.deepseek.com', desc: 'API keys에서 발급.' },
      { label: 'Moonshot (Kimi)', envVar: 'MOONSHOT_API_KEY', url: 'https://platform.moonshot.cn', urlLabel: 'platform.moonshot.cn', desc: 'API keys에서 발급.' },
    ],
    footnote: 'Ollama는 로컬 실행이라 API 키가 필요 없습니다 (모델 ID 앞에 "ollama:" 접두).',
  },
  {
    title: '한국 주식 데이터',
    intro: '한국 종목 리서치를 풍부하게 하려면 권장합니다. DART만 있어도 재무·공시 분석이 가능합니다.',
    items: [
      { label: 'DART 전자공시', envVar: 'DART_API_KEY', required: true, url: 'https://opendart.fss.or.kr', urlLabel: 'opendart.fss.or.kr', desc: '인증키 신청·관리 → 오픈API 이용신청 (무료, 일 20,000건). 재무제표·공시·지배구조 등 5개 도구가 켜집니다.' },
      { label: 'KRX 공매도 잔고 (ID)', envVar: 'KRX_ID', url: 'https://data.krx.co.kr', urlLabel: 'data.krx.co.kr', desc: 'KRX 데이터마켓플레이스 회원가입·로그인 후, 그 계정 아이디를 입력.' },
      { label: 'KRX 공매도 잔고 (비밀번호)', envVar: 'KRX_PW', url: 'https://data.krx.co.kr', urlLabel: 'data.krx.co.kr', desc: '위 계정의 비밀번호. 소셜/네이버 로그인이라 비밀번호가 없으면 대신 KRX_COOKIE를 씁니다(추후 지원).' },
      { label: '국민연금 보유', envVar: 'DATA_GO_KR_SERVICE_KEY', url: 'https://www.data.go.kr', urlLabel: 'data.go.kr', desc: '공공데이터포털 회원가입 → 데이터 3070507 활용신청 → Decoded(디코딩) 서비스키를 입력.' },
    ],
    footnote: '현재가·시세·외국인 지분율은 키 없이도 항상 작동합니다 (네이버 공개 데이터).',
  },
  {
    title: '웹 검색 — 선택 (하나면 충분)',
    intro: '최신 뉴스·정성 정보를 함께 조사하려면 아래 중 하나를 발급하세요.',
    items: [
      { label: 'Exa', envVar: 'EXASEARCH_API_KEY', url: 'https://exa.ai', urlLabel: 'exa.ai', desc: 'Dashboard에서 API 키 발급.' },
      { label: 'Perplexity', envVar: 'PERPLEXITY_API_KEY', url: 'https://www.perplexity.ai/settings/api', urlLabel: 'perplexity.ai', desc: 'Settings → API.' },
      { label: 'Tavily', envVar: 'TAVILY_API_KEY', url: 'https://tavily.com', urlLabel: 'tavily.com', desc: 'Dashboard에서 발급.' },
      { label: 'LangSearch', envVar: 'LANGSEARCH_API_KEY', url: 'https://langsearch.com', urlLabel: 'langsearch.com', desc: 'API 키 발급.' },
    ],
  },
  {
    title: '기타 — 선택',
    items: [
      { label: 'X (트위터) 감성 리서치', envVar: 'X_BEARER_TOKEN', url: 'https://developer.x.com', urlLabel: 'developer.x.com', desc: 'Developer Portal에서 Bearer Token 발급. 공개 트윗 기반 여론 조사에 사용.' },
      { label: '미국 주식 데이터', envVar: 'FINANCIAL_DATASETS_API_KEY', url: 'https://financialdatasets.ai', urlLabel: 'financialdatasets.ai', desc: '미국 종목 재무·시세 도구에 사용.' },
    ],
  },
];

export default function HelpView(): JSX.Element {
  return (
    <div className="help">
      <header className="page-head">
        <h1>API 키 발급 가이드</h1>
        <p className="sub">발급처에서 키를 받아 설정에 입력하세요. 키는 이 컴퓨터에 암호화 저장되며 외부로 전송되지 않습니다.</p>
      </header>

      {SECTIONS.map((section) => (
        <section className="card" key={section.title}>
          <h2>{section.title}</h2>
          {section.intro && <p className="sec-intro">{section.intro}</p>}
          <div className="key-list">
            {section.items.map((item) => (
              <div className="key-item" key={item.envVar}>
                <div className="key-item-head">
                  <div className="key-item-title">
                    <span className="key-label">{item.label}</span>
                    {item.required && <span className="sec-tag req">권장</span>}
                  </div>
                  <a className="link-btn" href={item.url} target="_blank" rel="noreferrer">
                    {item.urlLabel} ↗
                  </a>
                </div>
                <code className="key-env">{item.envVar}</code>
                <p className="key-desc">{item.desc}</p>
              </div>
            ))}
          </div>
          {section.footnote && <p className="hint">{section.footnote}</p>}
        </section>
      ))}
    </div>
  );
}
