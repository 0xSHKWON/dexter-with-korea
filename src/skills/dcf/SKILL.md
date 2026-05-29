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

## Step 1: 재무 데이터 수집

**US 경로** — `get_financials` 도구를 다음 쿼리로 호출한다:

> **🇰🇷 KR override:** 대신 `get_financials_kr`를 호출한다(DART 사업/반기/분기보고서로 라우팅). 자연어 쿼리 하나면 충분하다. 예: `"005930 최근 5년 연결 재무제표 현금흐름·손익·재무상태표"`. 그다음 현재가는 `get_market_data`가 한국 티커를 반환하면 그걸 쓰고, 아니면 `web_search`/`get_foreign_ownership_kr`로 최근 종가를 보완한다.
>
> DART 계정 라벨(`account_nm`)은 회사·연도마다 다르다 — **정확 일치 금지**. 영업수익 vs 매출액, 당기순이익(손실) 접미사 등. 부분 문자열 / 표준 `account_id`(있을 때)로 매칭하고 기간 간 정합성을 맞춘다.

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

> **🇰🇷 KR override — 한국 시장 입력값 사용:**
> - 무위험금리: **~3%** (10년 국고채), 4% 아님
> - 시장 위험프리미엄: 5~7% (재벌 계열·상호출자 종목은 코리아 디스카운트/지배구조 우려로 상단에 가깝게)
> - 부채비용: 세전 시장금리, **세후는 법인세율 ~22% 적용** (K-IFRS 실효; 지방소득세 포함 marginal 최대 ~24~26%) — **30% 아님**
> - 기준 WACC 레인지는 [sector-wacc-kr.md](sector-wacc-kr.md) 참조

**합리성 점검:** 가치 창출 기업은 WACC가 `return_on_invested_capital`보다 2~4% 낮아야 한다.

**섹터 조정:** [sector-wacc.md](sector-wacc.md)(US) 또는 [sector-wacc-kr.md](sector-wacc-kr.md)(KR)의 조정 인자를 기업별 특성에 따라 적용한다.

## Step 4: 미래 현금흐름 투영

**1~5년차:** 성장률에 연 5% 감쇠 적용(2~5년차에 성장률을 0.95, 0.90, 0.85, 0.80배). 경쟁 동학을 반영한다.

**터미널 가치:** Gordon 성장 모형으로 2.5% 터미널 성장률(GDP 프록시) 사용.

> **🇰🇷 KR override:** 터미널 성장률 **~2.0%** 사용(한국의 낮은 잠재 GDP 성장률). Step 6 민감도 그리드도 이를 중심으로 — 미국의 2.0/2.5/3.0 대신 터미널 성장률을 **1.5% / 2.0% / 2.5%**로 변화시킨다.

## Step 5: 현재가치 계산

모든 FCF를 할인 → 합산해 기업가치(Enterprise Value) → 순부채(Net Debt) 차감 → `outstanding_shares`로 나눠 주당 적정가치를 구한다.

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
> - 짧은 **"세후 실현수익률 주의"** 캡션 추가: DCF 적정가치는 기업의 내재가치(투자자 세전)다. 투자자가 수익을 *실현*할 때 증권거래세(2026년 기준 매도금액의 ~0.20%: KOSPI 0.05% 거래세 + 0.15% 농어촌특별세, KOSDAQ 0.20%)와 배당소득세(거주자 15.4% 원천징수, 외국인 ~22% 또는 조세조약 세율)가 세후 실현수익을 깎는다. 이는 위에서 계산한 내재가치를 **바꾸지 않으며** 그 위에 얹히는 투자자 차원의 조정이다.
