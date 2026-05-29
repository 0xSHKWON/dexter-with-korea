---
name: dcf-valuation
description: Performs discounted cash flow (DCF) valuation analysis to estimate intrinsic value per share. Triggers when user asks for fair value, intrinsic value, DCF, valuation, "what is X worth", price target, undervalued/overvalued analysis, or wants to compare current price to fundamental value.
---

# DCF Valuation Skill

## Workflow Checklist

Copy and track progress:
```
DCF Analysis Progress:
- [ ] Step 0: Detect market (US vs KR) and pick the matching path
- [ ] Step 1: Gather financial data
- [ ] Step 2: Calculate FCF growth rate
- [ ] Step 3: Estimate discount rate (WACC)
- [ ] Step 4: Project future cash flows (Years 1-5 + Terminal)
- [ ] Step 5: Calculate present value and fair value per share
- [ ] Step 6: Run sensitivity analysis
- [ ] Step 7: Validate results
- [ ] Step 8: Present results with caveats
```

## Step 0: Detect Market

Decide which path to follow before gathering data:

- **KR path** — if the ticker is a 6-digit number (e.g. `005930`, `035420`) or the company is identified by a Korean name (삼성전자, 네이버). Korean listings report under **K-IFRS** and trade in **KRW**.
- **US path** — if the ticker is an ASCII symbol (`AAPL`, `MSFT`). Reports under US GAAP, trades in USD.

Each step below states **US default** and, where it differs, a **🇰🇷 KR override**. Follow the override only on the KR path; otherwise use the US default unchanged.

## Step 1: Gather Financial Data

**US path** — call the `get_financials` tool with these queries:

> **🇰🇷 KR override:** 대신 `get_financials_kr`를 호출한다(DART 사업/반기/분기보고서로 라우팅). 자연어 쿼리 하나면 충분하다. 예: `"005930 최근 5년 연결 재무제표 현금흐름·손익·재무상태표"`. 그다음 현재가는 `get_market_data`가 한국 티커를 반환하면 그걸 쓰고, 아니면 `web_search`/`get_foreign_ownership_kr`로 최근 종가를 보완한다.
>
> DART 계정 라벨(`account_nm`)은 회사·연도마다 다르다 — **정확 일치 금지**. 영업수익 vs 매출액, 당기순이익(손실) 접미사 등. 부분 문자열 / 표준 `account_id`(있을 때)로 매칭하고 기간 간 정합성을 맞춘다.

### 1.1 Cash Flow History
**Query:** `"[TICKER] annual cash flow statements for the last 5 years"`

**Extract:** `free_cash_flow`, `net_cash_flow_from_operations`, `capital_expenditure`

**Fallback:** If `free_cash_flow` missing, calculate: `net_cash_flow_from_operations - capital_expenditure`

### 1.2 Financial Metrics
**Query:** `"[TICKER] financial metrics snapshot"`

**Extract:** `market_cap`, `enterprise_value`, `free_cash_flow_growth`, `revenue_growth`, `return_on_invested_capital`, `debt_to_equity`, `free_cash_flow_per_share`

### 1.3 Balance Sheet
**Query:** `"[TICKER] latest balance sheet"`

**Extract:** `total_debt`, `cash_and_equivalents`, `current_investments`, `outstanding_shares`

**Fallback:** If `current_investments` missing, use 0

### 1.4 Current Price
Call the `get_market_data` tool:

**Query:** `"[TICKER] price snapshot"`

**Extract:** `price`

### 1.5 Company Facts
Call the `get_financials` tool:

**Query:** `"[TICKER] company facts"`

**Extract:** `sector`, `industry`, `market_cap`

**Use:** Determine appropriate WACC range from [sector-wacc.md](sector-wacc.md)

> **🇰🇷 KR override:** `get_financials_kr`는 미국식 `sector` 필드를 반환하지 않는다. 회사의 주력 사업(반도체, 자동차, 2차전지, 바이오, 금융, 통신, 유틸리티, 소비재 …)으로 섹터를 추론하고 [sector-wacc-kr.md](sector-wacc-kr.md)에서 WACC 레인지를 읽어라.

## Step 2: Calculate FCF Growth Rate

Calculate 5-year FCF CAGR from cash flow history.

**Cross-validate with:** `free_cash_flow_growth` (YoY), `revenue_growth`

**Growth rate selection:**
- Stable FCF history → Use CAGR with 10-20% haircut
- **Cap at 15%** (sustained higher growth is rare)

## Step 3: Estimate Discount Rate (WACC)

**Use the `sector` from company facts** to select the appropriate base WACC range from [sector-wacc.md](sector-wacc.md).

**Default assumptions (US):**
- Risk-free rate: 4%
- Equity risk premium: 5-6%
- Cost of debt: 5-6% pre-tax (~4% after-tax at 30% tax rate)

Calculate WACC using `debt_to_equity` for capital structure weights.

> **🇰🇷 KR override — 한국 시장 입력값 사용:**
> - 무위험금리: **~3%** (10년 국고채), 4% 아님
> - 시장 위험프리미엄: 5~7% (재벌 계열·상호출자 종목은 코리아 디스카운트/지배구조 우려로 상단에 가깝게)
> - 부채비용: 세전 시장금리, **세후는 법인세율 ~22% 적용** (K-IFRS 실효; 지방소득세 포함 marginal 최대 ~24~26%) — **30% 아님**
> - 기준 WACC 레인지는 [sector-wacc-kr.md](sector-wacc-kr.md) 참조

**Reasonableness check:** WACC should be 2-4% below `return_on_invested_capital` for value-creating companies.

**Sector adjustments:** Apply adjustment factors from [sector-wacc.md](sector-wacc.md) (US) or [sector-wacc-kr.md](sector-wacc-kr.md) (KR) based on company-specific characteristics.

## Step 4: Project Future Cash Flows

**Years 1-5:** Apply growth rate with 5% annual decay (multiply growth rate by 0.95, 0.90, 0.85, 0.80 for years 2-5). This reflects competitive dynamics.

**Terminal value:** Use Gordon Growth Model with 2.5% terminal growth (GDP proxy).

> **🇰🇷 KR override:** 터미널 성장률 **~2.0%** 사용(한국의 낮은 잠재 GDP 성장률). Step 6 민감도 그리드도 이를 중심으로 — 미국의 2.0/2.5/3.0 대신 터미널 성장률을 **1.5% / 2.0% / 2.5%**로 변화시킨다.

## Step 5: Calculate Present Value

Discount all FCFs → sum for Enterprise Value → subtract Net Debt → divide by `outstanding_shares` for fair value per share.

## Step 6: Sensitivity Analysis

Create 3×3 matrix: WACC (base ±1%) vs terminal growth (2.0%, 2.5%, 3.0%).

> **🇰🇷 KR override:** 터미널 성장률 축 = **1.5% / 2.0% / 2.5%** (한국의 ~2.0% 터미널 성장률 중심).

## Step 7: Validate Results

Before presenting, verify these sanity checks:

1. **EV comparison**: Calculated EV should be within 30% of reported `enterprise_value`
   - If off by >30%, revisit WACC or growth assumptions

2. **Terminal value ratio**: Terminal value should be 50-80% of total EV for mature companies
   - If >90%, growth rate may be too high
   - If <40%, near-term projections may be aggressive

3. **Per-share cross-check**: Compare to `free_cash_flow_per_share × 15-25` as rough sanity check

If validation fails, reconsider assumptions before presenting results.

## Step 8: Output Format

Present a structured summary including:
1. **Valuation Summary**: Current price vs. fair value, upside/downside percentage
2. **Key Inputs Table**: All assumptions with their sources
3. **Projected FCF Table**: 5-year projections with present values
4. **Sensitivity Matrix**: 3×3 grid varying WACC (±1%) and terminal growth (2.0%, 2.5%, 3.0%)
5. **Caveats**: Standard DCF limitations plus company-specific risks

> **🇰🇷 KR override:**
> - 모든 값을 **KRW**로 표기(주당 내재가치, 시총). 주당가치 합리성 점검도 KRW로.
> - 민감도 행렬 터미널 성장률 축: **1.5% / 2.0% / 2.5%**.
> - 짧은 **"세후 실현수익률 주의"** 캡션 추가: DCF 적정가치는 기업의 내재가치(투자자 세전)다. 투자자가 수익을 *실현*할 때 증권거래세(2026년 기준 매도금액의 ~0.20%: KOSPI 0.05% 거래세 + 0.15% 농어촌특별세, KOSDAQ 0.20%)와 배당소득세(거주자 15.4% 원천징수, 외국인 ~22% 또는 조세조약 세율)가 세후 실현수익을 깎는다. 이는 위에서 계산한 내재가치를 **바꾸지 않으며** 그 위에 얹히는 투자자 차원의 조정이다.
