---
name: kr-relative-valuation
description: 한국 상장사를 동종업계 멀티플과 비교하는 상대가치 밸류에이션. 경기민감주(반도체·철강·조선·화학·해운)나 이익 변동이 커 DCF가 불안정한 종목의 "적정주가/싸냐 비싸냐"를, PER·PBR·EV 멀티플을 peer·자기 과거와 비교해 답한다. 상대가치·peer/동종업계 비교·멀티플·PER/PBR 밴드·경기민감주 적정가치·"피어 대비 싸냐"와 함께 트리거. (Triggers on relative valuation, peer comps, multiples, cyclical fair value.)
---

# 한국 주식 상대가치(Comps) 밸류에이션 스킬

목표: 대상 종목이 **동종업계 대비** 싼지 비싼지, 그리고 그 프리미엄/디스카운트가 **정당한지**를 멀티플로 답한다. 결론(저평가/적정/고평가 + 근거)을 먼저 제시하라. DCF가 단일 시나리오의 내재가치라면, 이 스킬은 시장이 유사 기업에 매기는 값과의 비교다.

## 언제 이 스킬이 DCF보다 나은가 (Step 0 라우팅)

- **경기민감주**(반도체·철강·조선·화학·해운·건설): 이익이 사이클을 크게 타 단일-시점 DCF가 왜곡된다 → 상대가치(특히 **PBR·EV/EBITDA**)와 through-cycle 정상이익이 더 신뢰성 있다.
- **금융주**(은행·증권·보험): FCF 개념이 약하다 → **PBR·ROE** 기반 비교가 표준.
- peer 그룹이 뚜렷하고 사용자가 "동종 대비", "싸냐"를 물을 때.
순현금흐름이 안정적인 성장·소비재라면 DCF(`dcf-valuation`)를 우선하고 이 스킬은 교차검증으로 쓴다.

## 워크플로 체크리스트

```
KR 상대가치 분석 진행:
- [ ] Step 1: 대상 멀티플 + peer 후보 수집
- [ ] Step 2: peer별 멀티플로 comp 표 구성
- [ ] Step 3: 멀티플 격차를 펀더멘털로 정규화(성장·마진·ROE·지배구조)
- [ ] Step 4: 적정 멀티플 × 대상 지표 → 적정가치 밴드
- [ ] Step 5: 평가 + 주의사항
```

## Step 1: 대상 + peer 수집

대상 티커(또는 회사명)로 `get_market_data_kr`를 호출한다. 반환에서 `valuation.{per, pbr, eps, bps, forwardPer, forwardEps}`, `quote.{price, high52w, low52w}`, 그리고 `peers[]`(동종 ticker·시총)를 읽는다. `peers`가 비었거나 부적절하면 `web_search`로 동종 2~4개를 보완한다(같은 KRX 업종·사업모델).

## Step 2: comp 표 구성

각 peer 티커로 `get_market_data_kr`를 **다시** 호출해 멀티플을 채운다(peers[] 자체에는 price·시총만 있고 PER/PBR은 없다 — peer당 1콜). 한 표로 정리: 종목 | PER | forwardPER | PBR | 배당수익률 | 시총. 동종 **중앙값**을 같이 적는다(평균은 이상치에 끌린다).

## Step 3: 격차를 펀더멘털로 정규화

멀티플 차이를 그냥 두지 말고 설명하라. `get_financials_kr`(multi-year)로 대상·주요 peer의 `ratios.{revenueYoYPct, operatingProfitYoYPct, operatingMarginPct, netMarginPct, roePct}`를 비교:
- 더 높은 성장/마진/ROE → 프리미엄 멀티플 **정당**. 낮은데 프리미엄이면 고평가 신호.
- 지배구조(계열·순환출자: `get_large_holders_kr`) 열위 → 디스카운트 **정당**.
- 경기민감주는 **PER 함정** 주의: 이익 고점에서 PER이 낮아 보이고(저평가 착시), 저점에서 높아 보인다 → PBR과 정상이익(through-cycle 평균 영업이익) 기준 PER로 교차 점검.

## Step 4: 적정가치 밴드

적정 멀티플(동종 중앙값을 펀더멘털 격차로 조정)을 대상 지표에 곱한다:
- 적정주가(PER 기준) = 적정 PER × 대상 EPS. PBR 기준 = 적정 PBR × BPS.
- 보수/기본/낙관 3개 멀티플로 **밴드**를 제시하고 현재가 대비 상승/하락 여력(%)을 계산한다.
- 가능하면 `get_market_data_kr`의 `consensus.targetPrice`와 대조해 내 밴드가 컨센서스와 얼마나 다른지 밝힌다.

## Step 5: 출력 형식

1. **평가**(1~2문장): 동종 대비 저평가/적정/고평가 + 가장 큰 이유.
2. **comp 표**: 대상 + peers + 중앙값(PER/PBR/배당/성장·ROE).
3. **정규화 논리**: 프리미엄/디스카운트가 정당한지.
4. **적정가치 밴드**: 멀티플 기준별 적정주가 + 상승여력.
5. **주의사항**: 경기 위치(사이클 고/저점), 멀티플 기준의 한계, 코리아 디스카운트는 일부 구조적. 거래세·배당세 세후 수익은 별도.
