# 개발 문서

[← README](README.md) · 일반 사용자용 소개는 README에, 도구·견고성·설치·평가 등 기술 내용은 여기에 모았습니다.

[virattt/dexter](https://github.com/virattt/dexter)(미국 시장 중심의 자율 금융 리서치 에이전트)를 포크해, 그 위에 **한국 주식 리서치 레이어**와 그 데이터가 조용히 깨지지 않게 받쳐주는 **견고성 레이어**를 얹은 것이 이 저장소의 핵심입니다.

**바로가기** · [동작 방식](#동작-방식) · [왜 따로 만들었나](#왜-한국-주식은-따로-만들어야-했나) · [도구](#도구) · [견고성](#견고성--조용히-깨지지-않기) · [한국 시장 튜닝](#한국-시장-튜닝) · [빠른 시작](#빠른-시작) · [개발·평가](#개발--평가) · [아키텍처](#아키텍처)

## 동작 방식

자연어 질문을 던지면 — 시장을 지정할 필요 없이 — 에이전트가 티커 형태(6자리 숫자 = 한국)와 언어를 보고 알맞은 도구로 라우팅하고, 1차 출처를 호출해, 결과를 교차 종합한 뒤 인용된 답을 냅니다.

```
> 삼성전자 지금 투자 관점에서 어때?
```

이 한 줄이 내부에서는 **정규화 실적**(매출·영업이익·순이익·마진·ROE·FCF·YoY) + **외국인/기관/개인 일별 수급** + **공매도 잔고** + **5%룰 대량보유** + **목표주가 컨센서스**를 각각 1차 출처에서 끌어와, "수급·실적·지배구조가 같은 방향인지 충돌인지"를 판단하는 하나의 thesis로 묶입니다.

모든 도구 호출은 스크래치패드(JSONL)에 기록되어 **무엇을 어디서 가져왔는지 감사·재현**할 수 있습니다.

## 왜 한국 주식은 따로 만들어야 했나

미국용 도구를 6자리 한국 티커에 그대로 쓸 수 없습니다(애초에 티커를 해결하지 못함). 그리고 한국 데이터 소스는 미국의 깔끔한 키 기반 API와 다릅니다:

| 소스 | 무엇 | 현실 |
|---|---|---|
| **DART** (금감원 전자공시) | 재무·공시·지배구조 | 무료 공식 API지만 **일 20,000건 한도** |
| **KRX** (한국거래소) | 공매도 잔고 | 2024–25부터 **회원 로그인 필수**(익명 차단) |
| **Naver** 모바일 | 현재가·외국인 지분율 | **공식 계약 없는** JSON 엔드포인트 |
| **국민연금** (data.go.kr) | 연기금 보유 | 분기 아닌 **연말 스냅샷**, 종목명 매칭 |

그래서 두 가지가 필요했습니다 — **(1)** 각 소스를 제대로 호출하는 도구, **(2)** 그게 한도 초과·로그인 만료·응답 구조 변경에 **조용히 깨지지 않게** 받쳐주는 견고성 레이어.

## 도구

**DART 기반** — `DART_API_KEY`가 설정되면 자동 등록.

| 도구 | 대응 미국 개념 | 내용 |
|---|---|---|
| `get_financials_kr` | `get_financials` (10-K/10-Q) | 사업·반기·분기보고서, K-IFRS 정규화 요약(연결/별도) |
| `get_filings_kr` | SEC EDGAR | DART 공시 검색 |
| `read_filings_kr` | `read_filings` (10-K 본문) | 보고서 본문 — 사업의 내용·주요제품·위험관리·MD&A **+ 지배구조·최대주주·특수관계자·계열회사·대주주 거래** |
| `get_large_holders_kr` | 13F (5%+ 보유) | 대량보유상황보고서 |
| `get_insider_trades_kr` | Form 4 (내부자) | 임원·주요주주 보고 |
| `get_segments_kr` | 세그먼트 공시 | 사업부문별 매출·영업이익 기여도 (DART 본문) |

**Korea-specific** — DART에 없는 데이터. 소스·키가 도구마다 다름.

| 도구 | 내용 (소스) | 활성화 |
|---|---|---|
| `get_market_data_kr` | 현재가·시총·PER/PBR/EPS/BPS·추정PER·배당·목표주가 컨센서스·peer (Naver) | **키 불필요** |
| `get_foreign_ownership_kr` | 외국인 지분율 + 외국인/기관/개인 순매수 (Naver) | **키 불필요** |
| `get_short_balance_kr` | 공매도 순보유잔고 (KRX) | `KRX_ID`+`KRX_PW` 또는 `KRX_COOKIE` |
| `get_nps_holdings` | 국민연금 국내주식 보유 (data.go.kr) | `DATA_GO_KR_SERVICE_KEY` |

미국 시장 도구(`get_financials`/`get_market_data`/`read_filings`/`stock_screener`)와 범용 도구도 같은 루프에서 동작합니다: `web_search`·`web_fetch`(웹 검색/페이지 정독), `ask_user_question`(모호하면 되묻기), `spawn_subagent`(독립 하위 작업을 격리 서브에이전트로 위임 — 한 턴에 여러 개를 띄워 병렬 fan-out).

> 현재가·외국인 지분율은 **키 하나 없이** 동작합니다. DART 키가 없어도 한국 종목의 시세·밸류에이션·외국인 수급은 바로 조회됩니다.

## 견고성 — 조용히 깨지지 않기

한국 소스의 거친 현실 위에서 잘못된 숫자를 사실처럼 답하지 않도록 다음을 내장했습니다.

- **DART 쿼터 보호** — `get_financials_kr`(연도별) × 라우팅(종목별) × 에이전트(도구 병렬)가 곱해지면 "이 종목 분석" 한 번이 수십 개의 DART 호출로 번집니다. **공유 동시성 캡**(기본 4, `DART_MAX_CONCURRENCY`로 조정)이 일 20,000건 한도를 태우지 않게 막고, 한도 초과(`020`)가 감지되면 **서킷 브레이커**가 나머지 호출을 즉시 중단하고 명확한 한국어 메시지로 알린 뒤 쿨다운 후 자동 재시도합니다.
- **데이터 드리프트 감지(canary)** — Naver JSON은 비공식이라 어느 날 필드명이 바뀌면 값이 **조용히 null**이 될 수 있습니다. 핵심 필드(현재가·시총·일별 수급)가 비면 결과에 `_dataQualityWarning`을 붙여 모델이 깨진 값을 보고하지 않게 합니다. 일별 종가가 rename되어 **전일 종가로 가려지는** 최악 케이스까지 감지하고, ETF/ETN·펀드·무커버 종목처럼 본래 일부 지표가 없는 경우는 오탐을 내지 않습니다.
- **keyless 플레이북 티어링** — DART 키가 없어도 keyless 도구만으로 **수급·밸류에이션 리서치 가이드가 살아 있습니다.** 키가 있으면 DART 1차 자료를 포함한 전체 교차신호 플레이북으로 확장됩니다(미등록 도구를 가리키지 않도록 등록 게이트와 단일 진실원으로 일치).
- **결정적 재현(record/replay)** — 평가 하네스가 실제 DART·KRX·Naver 응답을 픽스처로 기록해두면, 같은 질문을 **키·네트워크 없이 결정적으로 재현·회귀 테스트**합니다. [개발·평가](#개발--평가) 참고.

## 한국 시장 튜닝

- **DCF 자동 분기** — 6자리 티커면 DCF 스킬이 한국 경로로 전환(법인세율 ~22%·국고채 무위험금리 ~3%·KRW). **순부채를 부채총계가 아니라 이자부채(차입금·사채)에서 현금·단기금융상품을 뺀 값으로** 산정 — 삼성처럼 순현금 기업은 순현금을 더해 주식가치가 EV보다 커집니다(부채총계로 잘못 빼면 부호가 뒤집혀 저평가). 거래세·배당세는 투자자 세후 실현수익률 주의사항으로 표기.
- **지배구조·소유구조 본문** — 코리아 디스카운트의 1차 변수(최대주주·특수관계인·계열회사·순환출자·대주주 거래)를 DART 사업보고서 본문(VI 회사의 기관·VII 주주에 관한 사항·IX 계열회사·X 대주주 등과의 거래내용)에서 **추정이 아니라 1차 근거로** 추출.
- **물적분할 분석** — LG화학→LG에너지솔루션 같은 분할 이벤트를 모회사 주주 관점(희석·지주사 디스카운트)에서 평가하는 전용 스킬.
- **교차신호 종합** — 재무·외국인 수급·공매도·대량보유·공시를 단순 나열이 아니라 하나의 thesis로 엮음.
- **K-IFRS 정규화** — 연결/별도 둘 다, 매출·영업이익·순이익·마진·ROE·FCF·YoY로 요약(원시 라인아이템은 파일로 보존해 드릴다운). 영업이익 정의가 미국 GAAP와 미묘하게 다른 점 반영.
- **단위·시장 규칙** — 원(KRW)·억·조 자동 포맷, 09:00–15:30 KST 거래시간, ±30% 상하한가.
- **종목 코드 해결** — "삼성전자" → 티커 → `corp_code`. DART 마스터(`corpCode.xml`)를 첫 실행 시 받아 `.dexter/cache/`에 저장하고 7일마다 갱신(신규 상장·사명 변경·물적분할 자동 반영). KRX용 티커→ISIN 매핑도 별도 관리.

## 빠른 시작

**필요한 것:** [Bun](https://bun.com) v1.0+ · LLM 키 하나(OpenAI/Anthropic/Google/xAI/OpenRouter/Ollama 등) · (선택) 시장 데이터 키.
키가 하나도 없어도 한국 종목 현재가·외국인 지분율(Naver, 키 불필요)은 동작합니다.

```bash
# Bun 설치 (없다면)
curl -fsSL https://bun.com/install | bash          # macOS/Linux
# powershell -c "irm bun.sh/install.ps1|iex"        # Windows

git clone https://github.com/0xSHKWON/dexter-with-korea.git
cd dexter-with-korea
bun install

cp env.example .env      # 키 채우기 (아래)
bun start                # 대화형 실행  (bun run dev = watch 모드)
```

**키** (`.env`, `your-`로 시작하는 값은 미설정으로 간주):

```bash
# LLM — 최소 하나 필수
OPENAI_API_KEY=your-openai-api-key
# ANTHROPIC_API_KEY / GOOGLE_API_KEY / XAI_API_KEY / OPENROUTER_API_KEY / OLLAMA_BASE_URL …

# 미국 시장 데이터
FINANCIAL_DATASETS_API_KEY=your-financial-datasets-api-key

# 한국 시장
DART_API_KEY=your-dart-api-key        # 재무·공시·지배구조 (무료, 일 20,000건 — opendart.fss.or.kr)
# KRX_ID / KRX_PW                      # 공매도 잔고 (data.krx.co.kr 로그인)
# KRX_COOKIE=JSESSIONID=...            # 소셜 로그인 계정은 브라우저 쿠키 붙여넣기
# DATA_GO_KR_SERVICE_KEY=...           # 국민연금 (data.go.kr, Decoded 키)
# DART_MAX_CONCURRENCY=4               # (선택) DART 동시 호출 상한
# READ_FILINGS_KR_MODEL=...            # (선택) read_filings_kr 내부 요약 모델

# 웹 검색 (선택, Exa → Perplexity → Tavily → LangSearch 폴백) / X 센티먼트 (선택)
# EXASEARCH_API_KEY / PERPLEXITY_API_KEY / TAVILY_API_KEY / LANGSEARCH_API_KEY / X_BEARER_TOKEN
```

**활성화 규칙:** `DART_API_KEY` → 5개 DART 도구 · `KRX_ID`+`KRX_PW`(또는 `KRX_COOKIE`) → 공매도 · `DATA_GO_KR_SERVICE_KEY` → 국민연금. 현재가·외국인 지분율은 키 없이 항상 등록.

## 개발 · 평가

**런타임은 Bun.** 자주 쓰는 명령:

```bash
bun run typecheck    # tsc --noEmit (푸시 전 권장)
bun test             # 전체 테스트 (Bun 러너)
bun test path.test.ts
```

**평가(eval)** — LLM-as-judge 채점:

```bash
bun run src/evals/run.ts --sample 10   # 미국 중심 평가
bun run kr-eval                        # 한국 질문 뱅크, 라이브 채점
bun run kr-eval:record                 # 실제 DART·KRX·Naver 응답을 픽스처로 기록
bun run kr-eval:replay                 # 픽스처로 결정적 재현 (키·네트워크 불필요)
```

KR 채점 차원: 실적 YoY · 교차신호 · 지배구조 · grounding(환각 여부). "같은 질문 → 같은 데이터 경로"를 record/replay로 검증해 챗봇의 비결정적 답과 대비합니다.

**디버깅** — 모든 쿼리가 `.dexter/scratchpad/`에 JSONL로 기록됩니다(원본 쿼리·각 툴 호출의 인자/원시결과/LLM 요약·추론 단계). 에이전트가 무엇을 어디서 가져와 어떻게 해석했는지 한 줄씩 추적할 수 있습니다.

## 아키텍처

- **에이전트 루프** — `src/agent/agent.ts`. 반복 도구 호출 루프, 스크래치패드가 쿼리 내 단일 진실원. 답변 품질은 시스템 프롬프트(`src/agent/prompts.ts`)가 좌우.
- **도구 등록** — `src/tools/registry.ts`. 환경변수 기반 게이팅(위 활성화 규칙).
- **스킬** — `src/skills/`. `SKILL.md` 디렉터리를 드롭하면 자동 발견. DCF·물적분할(kr-spinoff)·메모, 그리고 상대가치(kr-relative-valuation)·지주사 SOTP(kr-sotp-holdco)·주주환원(kr-shareholder-return)·이익의 질(kr-earnings-quality).
- **데스크톱 앱** — `desktop/` (Electron + React). 코어를 `src/sidecar/`의 헤드리스 사이드카로 구동.
- 더 깊은 컨벤션·함정은 [`CLAUDE.md`](CLAUDE.md), 업스트림 기여자 문서는 [`AGENTS.md`](AGENTS.md) 참고.
