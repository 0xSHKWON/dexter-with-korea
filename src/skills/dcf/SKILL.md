---
name: dcf-valuation
description: 주당 내재가치를 추정하는 DCF(현금흐름할인) 밸류에이션 분석을 수행한다. 적정주가·내재가치·DCF·밸류에이션·"얼마가 적정한가"·목표주가·저평가/고평가 분석, 또는 현재가를 펀더멘털 가치와 비교하려 할 때 트리거. (Triggers on fair value, intrinsic value, DCF, valuation, price target, undervalued/overvalued.)
---

# DCF 밸류에이션 스킬

## 워크플로 체크리스트

복사해서 진행 상황을 추적하라:
```
DCF 분석 진행:
- [ ] Step 0: 시장 감지(US vs KR) 및 경로 선택
- [ ] Step 1: 재무 데이터 수집
- [ ] Step 2: FCF 성장률 계산
- [ ] Step 3: 할인율(WACC) 추정
- [ ] Step 4: 미래 현금흐름 투영(1~5년 + 터미널)
- [ ] Step 5: 현재가치 및 주당 적정가치 계산
- [ ] Step 6: 민감도 분석
- [ ] Step 7: 결과 검증
- [ ] Step 8: 주의사항과 함께 결과 제시
```

## Step 0: 시장 감지

데이터를 수집하기 전에 어느 경로를 따를지 결정하라:

- **KR 경로** — 티커가 6자리 숫자(예: `005930`, `035420`)이거나 회사가 한국어 이름(삼성전자, 네이버)으로 식별되면. 한국 상장사는 **K-IFRS**로 보고하고 **KRW**로 거래된다.
- **US 경로** — 티커가 ASCII 심볼(`AAPL`, `MSFT`)이면. US GAAP로 보고하고 USD로 거래된다.

아래 각 단계는 **US 기본값**을 제시하고, 다른 경우 **🇰🇷 KR override**를 둔다. override는 KR 경로에서만 따르고, 그 외에는 US 기본값을 그대로 사용하라.

> **🇰🇷 DCF가 부적합한 KR 종목 — 다른 스킬로 라우팅:** DCF는 안정적 잉여현금흐름을 가정한다. 대상이
> (a) **경기민감주**(반도체·철강·조선·화학·해운) 또는 **금융주**라 이익 변동이 크면 → `kr-relative-valuation`
> (상대가치)이 더 신뢰성 있다; (b) **지주사/홀딩스**면 → `kr-sotp-holdco`(NAV/SOTP) — 일반 DCF는 자회사
> 이익을 더블카운팅한다. 이 경우 DCF를 강행하지 말고 해당 스킬로 답하거나 그것을 1차로 삼아라.

## Step 1: 재무 데이터 수집

**US 경로** — `get_financials` 도구를 다음 쿼리로 호출한다:

> **🇰🇷 KR override:** 대신 `get_financials_kr`를 호출한다(DART 사업/반기/분기보고서로 라우팅). 자연어 쿼리 하나면 충분하다. 예: `"005930 최근 5년 연결 재무제표 현금흐름·손익·재무상태표"`. 그다음 현재가·시가총액·발행주식수·PER/PBR·목표주가 컨센서스는 `get_market_data_kr`로 가져온다(`get_market_data`는 6자리 티커를 지원하지 않으니 `web_search` 추론에 기대지 마라).
>
> **출력은 `periods[].summary` 에 정규화돼 있다(KRW).** 라벨을 직접 파싱하지 말고 이 필드를 읽어라:
> - 현금흐름: `cashFlow.operating`(=영업현금흐름), `cashFlow.capex`, `ratios.freeCashFlow`(=영업CF−|capex|). `free_cash_flow`가 없으면 이 값을 쓴다.
> - 손익: `incomeStatement.revenue / operatingProfit / netIncome`, `ratios.revenueYoYPct`.
> - 재무상태표 — **순부채(Net Debt)는 부채총계가 아니다. 이자부채만 쓴다:**
>   - `balanceSheet.totalDebt`(이자부채 합계 = 단기차입금+유동성장기부채+사채+장기차입금+전환사채), `balanceSheet.cashAndEquivalents`(현금및현금성자산), `balanceSheet.shortTermInvestments`(단기금융상품), `balanceSheet.totalEquity`.
>   - **Net Debt = `totalDebt` − (`cashAndEquivalents` + `shortTermInvestments`)** (`shortTermInvestments`·`cashAndEquivalents`가 null이면 0으로 본다). 음수면 **순현금(net cash)** 기업 — 이때 주식가치는 EV보다 **커진다**(순현금을 더한다). 삼성전자처럼 차입금이 작고 현금+단기금융상품이 큰 종목이 대표적(부채총계를 순부채로 쓰면 부호가 뒤집혀 저평가).
>   - `totalDebt`가 `null`이면(은행·지주사 등 이자부채 라벨 비표준) `rawLineItemsFile`을 `read_file`로 열어 차입금·사채 라인을 **`account_nm`(라벨) 우선, `account_id` 보조**로 직접 합산하라(삼성처럼 차입금 `account_id`가 `-표준계정코드 미사용-`인 경우가 많아 라벨이 더 안정적이다). 그래도 불명확하면 보고된 `enterprise_value`·시총 기반 브리지로 폴백.
>   - `balanceSheet.totalLiabilities`(부채총계)·`ratios.debtToEquityPct`는 레버리지 점검용일 뿐 **순부채가 아니다.** 리스부채는 totalDebt에 포함하지 않는다(영업성; FCF에 이미 반영).
> - 각 metric은 `{ current, prior, label, display }` 구조이며 `current`(당기)를 쓴다. 분기·반기 손익/현금흐름은 누적(YTD)임을 `summary.basis`가 알려준다.
> - 발행주식수(`outstanding_shares`)는 summary에 없다 — `get_market_data_kr`의 `valuation.sharesOutstanding`(시총÷현재가 도출)을 쓰고, 정확한 상장주식수가 필요하면 `get_short_balance_kr`의 `listedShares`로 보완한다.
>
> summary가 비어 있으면(은행·지주사 등 비표준 라벨) `rawLineItemsFile` 을 `read_file`로 열어 직접 찾는다. `account_nm`은 회사·연도마다 달라 **정확 일치 금지** — 부분 문자열/`account_id`로 매칭한다.

### 1.1 현금흐름 이력
**쿼리:** `"[TICKER] annual cash flow statements for the last 5 years"`

**추출:** `free_cash_flow`, `net_cash_flow_from_operations`, `capital_expenditure`

**폴백:** `free_cash_flow`가 없으면 계산: `net_cash_flow_from_operations - capital_expenditure`

### 1.2 재무 지표
**쿼리:** `"[TICKER] financial metrics snapshot"`

**추출:** `market_cap`, `enterprise_value`, `free_cash_flow_growth`, `revenue_growth`, `return_on_invested_capital`, `debt_to_equity`, `free_cash_flow_per_share`

### 1.3 재무상태표
**쿼리:** `"[TICKER] latest balance sheet"`

**추출:** `total_debt`, `cash_and_equivalents`, `current_investments`, `outstanding_shares`

**폴백:** `current_investments`가 없으면 0 사용

### 1.4 현재가
`get_market_data` 도구를 호출한다:

**쿼리:** `"[TICKER] price snapshot"`

**추출:** `price`

### 1.5 회사 정보(Company Facts)
`get_financials` 도구를 호출한다:

**쿼리:** `"[TICKER] company facts"`

**추출:** `sector`, `industry`, `market_cap`

**용도:** [sector-wacc.md](sector-wacc.md)에서 적절한 WACC 레인지 결정

> **🇰🇷 KR override:** `get_financials_kr`는 미국식 `sector` 필드를 반환하지 않는다. 회사의 주력 사업(반도체, 자동차, 2차전지, 바이오, 금융, 통신, 유틸리티, 소비재 …)으로 섹터를 추론하고 [sector-wacc-kr.md](sector-wacc-kr.md)에서 WACC 레인지를 읽어라.

## Step 2: FCF 성장률 계산

현금흐름 이력에서 5년 FCF CAGR를 계산한다.

**교차 검증:** `free_cash_flow_growth`(YoY), `revenue_growth`

**성장률 선택:**
- 안정적 FCF 이력 → CAGR에 10~20% 할인(haircut) 적용
- **15%로 상한** (지속적 고성장은 드물다)

## Step 3: 할인율(WACC) 추정

**회사 정보의 `sector`를 사용**해 [sector-wacc.md](sector-wacc.md)에서 적절한 기준 WACC 레인지를 선택한다.

**기본 가정(US):**
- 무위험금리: 4%
- 시장 위험프리미엄: 5~6%
- 부채비용: 세전 5~6% (세율 30% 기준 세후 ~4%)

자본구조 가중치는 `debt_to_equity`로 WACC를 계산한다.

> **🇰🇷 KR override — bottom-up CAPM으로 직접 계산 (정적 테이블에서 값을 바로 집어 쓰지 마라):**
> WACC를 [sector-wacc-kr.md](sector-wacc-kr.md) 레인지에서 고르지 말고 아래로 계산한 뒤, 그 레인지는 **합리성 밴드(sanity band)로만** 쓴다.
> - **무위험금리(Rf):** `get_macro_rate_kr`(series: `treasury_10y`)로 10년 국고채 수익률을 가져오고 **반환된 as-of 날짜를 표기**하라(한국은행 ECOS 공식치 — `web_search` 추론보다 우선). 이 도구가 없을 때만(ECOS 키 미설정) `web_search`로 조회·조회일 표기, 그것도 실패 시에만 **~3% 동결 가정으로 명시 라벨**(예: "Rf=3.0%(가정, 실시간 조회 실패)") — 4% 아님.
> - **시장 위험프리미엄(ERP):** **4.87%로 고정**(출처: Damodaran 한국 Total ERP, 2026년 1월 = 성숙시장 implied 4.23% + 한국 국가위험프리미엄 0.64%, Aa2; 연 1회 갱신하고 적용연도를 가정표에 표기). 사이클 저점이라 낮게 느껴져도 **주관으로 올리지 마라** — 보수성은 Step 6 민감도 그리드(WACC ±1%)와 `.dexter` override로 표면화하지 base ERP에 숨기지 않는다. 재벌 계열·상호출자·지배구조(코리아 디스카운트)는 **base ERP에 얹지 말고** [sector-wacc-kr.md](sector-wacc-kr.md)의 WACC 조정인자로만 반영하라(이중계상 금지). 사용자가 `.dexter`로 다른 값을 핀했으면 그 값을 쓰고 출처를 "user override"로 표기.
> - **베타(β):** `get_beta_kr`로 산출하라 — 상장시장(KOSPI/KOSDAQ) 대비 2년 주간수익률 회귀 + Blume 보정의 **출처있는 실측치**(web_search 추론보다 우선). 반환된 `adjustedBeta`를 WACC에 쓰고 `rSquared`·`observations`·`asOf`(측정창)를 가정표에 표기한다. `reliable=false`이거나 R²가 매우 낮으면(방어주·신규상장 등 지수 설명력이 약한 구간) 그 사실을 밝히고 섹터 대용치와 교차확인하라(맹신 금지). 도구가 없거나 실패할 때만 web_search/섹터 대용치로 폴백하고 그 출처를 명시한다. **Cost of Equity = Rf + adjustedBeta × ERP.**
> - **부채비용:** 세전 시장금리(`get_macro_rate_kr` series `corporate_aa3y` = 회사채 AA- 3년을 IG 앵커로 쓸 수 있다), **세후는 법인세율 ~22% 적용** (K-IFRS 실효; 지방소득세 포함 marginal 최대 ~24~26%) — **30% 아님**.
> - 자본구조 가중치는 `debt_to_equity`로 적용: **WACC = (E/V)·Ke + (D/V)·Kd·(1−t)**. 결과가 [sector-wacc-kr.md](sector-wacc-kr.md) 레인지를 크게 벗어나면 입력값을 재점검하라.

**합리성 점검:** 가치 창출 기업은 WACC가 `return_on_invested_capital`보다 2~4% 낮아야 한다.

**섹터 조정:** [sector-wacc.md](sector-wacc.md)(US) 또는 [sector-wacc-kr.md](sector-wacc-kr.md)(KR)의 조정 인자를 기업별 특성에 따라 적용한다.

## Step 4: 미래 현금흐름 투영

**1~5년차:** 성장률에 연 5% 감쇠 적용(2~5년차에 성장률을 0.95, 0.90, 0.85, 0.80배). 경쟁 동학을 반영한다.

**터미널 가치:** Gordon 성장 모형으로 2.5% 터미널 성장률(GDP 프록시) 사용.

> **🇰🇷 KR override:** 터미널 성장률 **~2.0%** 사용(한국의 낮은 잠재 GDP 성장률). Step 6 민감도 그리드도 이를 중심으로 — 미국의 2.0/2.5/3.0 대신 터미널 성장률을 **1.5% / 2.0% / 2.5%**로 변화시킨다.

## Step 5: 현재가치 계산

모든 FCF를 현재가치로 할인하고 합산해 **기업가치(Enterprise Value, EV)**를 구한다. 그다음 EV를 **주식가치(Equity Value)**로 전환한다:

> **Equity Value = EV − Net Debt**, 여기서 **Net Debt = Total Debt − Cash − Short-term Investments**

**부호 규칙(중요):** Net Debt가 음수이면 회사는 **순현금(net cash)** 상태다 — 현금성자산이 차입금보다 많다. 이때는 순현금을 **더하므로 Equity Value가 EV보다 커진다.** 순부채를 무조건 "차감"으로만 생각해 부호를 뒤집지 마라. **총부채(부채총계)를 순부채로 혼동하면 순현금 기업을 저평가한다** (이자부채만 Net Debt에 들어간다).

마지막으로 `outstanding_shares`로 나눠 주당 적정가치를 구한다.

- **US 경로:** Total Debt=`total_debt`, Cash=`cash_and_equivalents`, Short-term Investments=`current_investments`(없으면 0) — §1.3에서 추출.
- **🇰🇷 KR 경로:** Total Debt=`balanceSheet.totalDebt`, Cash=`balanceSheet.cashAndEquivalents`, Short-term Investments=`balanceSheet.shortTermInvestments`(없으면 0), 주식수=`valuation.sharesOutstanding`. `totalDebt`가 `null`이면 §1 KR override의 폴백(rawLineItemsFile 직접 합산 또는 보고된 EV 브리지)을 따른다.

## Step 6: 민감도 분석

3×3 행렬 생성: WACC(기준 ±1%) vs 터미널 성장률(2.0%, 2.5%, 3.0%).

> **🇰🇷 KR override:** 터미널 성장률 축 = **1.5% / 2.0% / 2.5%** (한국의 ~2.0% 터미널 성장률 중심).

## Step 7: 결과 검증

제시 전에 다음 합리성 점검을 확인하라:

1. **EV 비교**: 계산된 EV는 보고된 `enterprise_value`의 30% 이내여야 한다
   - 30% 초과로 벗어나면 WACC나 성장 가정을 재검토

2. **터미널 가치 비중**: 성숙 기업은 터미널 가치가 전체 EV의 50~80%여야 한다
   - 90% 초과면 성장률이 너무 높을 수 있음
   - 40% 미만이면 단기 투영이 공격적일 수 있음

3. **주당 교차 점검**: `free_cash_flow_per_share × 15~25`와 비교해 대략적 합리성 점검

4. **순부채 부호·규모 점검**: Net Debt 부호가 회사 실태와 맞는지 확인하라. 차입금이 현금+단기금융상품보다 작은데 양(+)의 큰 Net Debt가 나오면 총부채를 잘못 쓴 것이다(순현금 기업은 Net Debt<0, Equity Value>EV). 또 |Net Debt|가 시가총액 대비 비현실적으로 크면(예: 시총의 절반 초과) 차입금 합산 누락/과다를 의심하고 `ratios.debtToEquityPct`·`rawLineItemsFile`과 교차 확인하라.

5. **🇰🇷 컨센서스 목표주가 대조 (KR)**: 산출한 주당 내재가치를 `get_market_data_kr`의 `consensus.targetPrice`(목표주가 컨센서스)와 비교하라. ±30%를 초과해 벌어지면 그냥 두지 말고 — (a) 가정(성장률·WACC·터미널)을 재점검하거나, (b) 시장/컨센서스가 놓치고 있는 것(또는 내가 놓친 것)이 무엇인지 명시적으로 설명하라. 괴리를 설명 없이 제시하지 마라.

검증에 실패하면 결과를 제시하기 전에 가정을 재고하라.

## Step 8: 출력 형식

다음을 포함한 구조화된 요약을 제시한다:
1. **밸류에이션 요약**: 현재가 vs 적정가치, 상승/하락 여력 퍼센트
2. **핵심 입력값 표**: 모든 가정과 출처
3. **투영 FCF 표**: 5년 투영과 현재가치
4. **민감도 행렬**: WACC(±1%)와 터미널 성장률(2.0%, 2.5%, 3.0%)을 변화시킨 3×3 그리드
5. **주의사항**: 표준 DCF 한계 + 기업별 리스크

> **🇰🇷 KR override:**
> - 모든 값을 **KRW**로 표기(주당 내재가치, 시총). 주당가치 합리성 점검도 KRW로.
> - 민감도 행렬 터미널 성장률 축: **1.5% / 2.0% / 2.5%**.
> - **핵심 입력값 표는 아래 4열을 반드시 채운다 — `항목 · 값 · 출처 · as-of/방법`.** WACC를 한 줄로 요약하지 말고 구성요소를 각각 노출해 감사 가능하게 하라. 폴백을 썼으면(예: β 섹터 대용치, Rf 동결 가정) 그 사실을 숨기지 말고 출처 칸에 명시한다:
>
>   | 항목 | 값 | 출처 | as-of / 방법 |
>   |------|-----|------|------------|
>   | Rf (무위험금리) | 2.9% | 한국은행 ECOS 10Y 국고채 | get_macro_rate_kr, 2026-06-30 |
>   | ERP | 4.87% | Damodaran 한국 (2026.1) | 핀값: 성숙 4.23% + CRP 0.64%, 연 1회 갱신 |
>   | β (adjusted) | 1.14 | get_beta_kr 실측 회귀 | 2y 주간/KOSPI/Blume, R²=0.66, n=106 |
>   | Kd (세후) | 3.8% | ECOS 회사채 AA-3y × (1−0.22) | get_macro_rate_kr, 2026-06-30 |
>   | 법인세율 t | 22% | K-IFRS 실효 | 상수 |
>   | 터미널 g | 2.0% | 한국 잠재 GDP 프록시 | 상수 |
>   | WACC | (E/V)·Ke + (D/V)·Kd·(1−t) | 위 입력 도출 | bottom-up CAPM |
> - 짧은 **"세후 실현수익률 주의"** 캡션 추가: DCF 적정가치는 기업의 내재가치(투자자 세전)다. 투자자가 수익을 *실현*할 때 증권거래세(2026년 기준 매도금액의 ~0.20%: KOSPI 0.05% 거래세 + 0.15% 농어촌특별세, KOSDAQ 0.20%)와 배당소득세(거주자 15.4% 원천징수, 외국인 ~22% 또는 조세조약 세율)가 세후 실현수익을 깎는다. 이는 위에서 계산한 내재가치를 **바꾸지 않으며** 그 위에 얹히는 투자자 차원의 조정이다.
