---
name: kr-earnings-quality
description: 한국 상장사 이익의 질(earnings quality) 점검 — 보고된 순이익이 실제 현금과 지배주주 몫으로 뒷받침되는지 검증한다. 영업현금흐름 대비 순이익(현금 전환), 지배 vs 비지배 순이익, accrual, 연결 vs 별도를 본다. 이익의 질·어닝퀄리티·실적의 질·현금흐름 vs 순이익·accrual·"이익이 진짜냐"와 함께 트리거. (Triggers on earnings quality, cash conversion, accruals.)
---

# 한국 주식 이익의 질(Earnings Quality) 스킬

목표: 보고된 순이익이 **현금**으로 뒷받침되고 **지배주주(소액주주 포함)**에게 귀속되는지 검증한다. 결론(이익의 질 高/中/低 + 핵심 근거)을 먼저. 같은 PER라도 현금으로 받쳐진 이익과 회계적 이익은 가치가 다르다 — 이 스킬은 그 차이를 드러낸다.

## 워크플로 체크리스트

```
KR 이익의 질 점검 진행:
- [ ] Step 1: 다년 재무 수집(연결)
- [ ] Step 2: 현금 전환(OCF/NI) + FCF 점검
- [ ] Step 3: 지배 vs 비지배 순이익 괴리
- [ ] Step 4: 연결 vs 별도(배당재원) 비교
- [ ] Step 5: accrual 점검 + 종합 평가
```

## Step 1: 데이터 수집

대상 티커(또는 회사명)로 `get_financials_kr`를 호출해 다년 연결(CFS) `periods[].summary`를 받는다. 핵심 필드(각 값은 `{ current, prior }`):
`incomeStatement.{netIncome, controllingNetIncome, operatingProfit}`, `cashFlow.operating`, `ratios.{freeCashFlow, roePct, netMarginPct}`, `balanceSheet.totalAssets`.

## Step 2: 현금 전환 (가장 중요)

- **현금 전환비율 = cashFlow.operating ÷ netIncome.** 여러 해에 걸쳐 1.0을 **지속적으로 밑돌면** 적신호 — 이익이 현금이 아니라 매출채권·재고로 묶여 있다(밀어내기·가공 매출 의심). 1.0 내외~상회면 양호.
- **FCF 부호**(`ratios.freeCashFlow`): 흑자인데 FCF가 만성 적자면 자본적지출/운전자본이 이익을 잠식 — 질 낮음.

## Step 3: 지배 vs 비지배 순이익

`controllingNetIncome` vs `netIncome`을 비교한다. 비지배지분(소수주주) 몫이 크면, 연결 순이익이 커 보여도 **실제 주주 귀속 이익은 작다.** 지배지분 비율 = controllingNetIncome ÷ netIncome. 자회사 지분이 낮은 지배구조에서 흔하다 — PER을 controllingNetIncome 기준으로 다시 보라.

## Step 4: 연결 vs 별도 (배당재원)

`fs_div: "OFS"`로 한 번 더 호출해 **별도** 순이익을 본다. 배당은 보통 별도 이익에서 나오므로, 연결 이익이 크더라도 별도가 약하면 배당 여력이 제한된다. 연결≫별도 괴리는 지분법이익(미실현 현금) 비중이 크다는 뜻.

## Step 5: accrual 점검 + 종합

- **Accrual 근사 = (netIncome − cashFlow.operating) ÷ totalAssets.** 높고 양(+)일수록 이익이 발생주의(회계적)에 의존 — 미래 이익 반전 위험. 음(−)이면 현금이 이익을 초과(보수적).
- 종합: 위 신호(현금전환·지배지분·별도·accrual)를 하나의 판단으로 묶어 이익의 질을 등급화한다.

## 출력 형식

1. **평가**(1~2문장): 이익의 질 高/中/低 + 가장 큰 근거.
2. **현금 전환 표**: 연도별 NI / OCF / 전환비율 / FCF.
3. **귀속·재원**: 지배 vs 비지배, 연결 vs 별도 괴리.
4. **accrual 신호**: 수치 + 해석.
5. **주의사항**: 단년 변동은 운전자본 타이밍일 수 있으니 추세로 보라. 은행·지주사는 OCF 개념이 달라 이 프레임이 부분적으로만 적용된다.
