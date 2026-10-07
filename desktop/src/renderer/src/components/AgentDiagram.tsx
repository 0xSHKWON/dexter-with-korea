/**
 * Help → 작동 방식: the harness end to end. Mirrors src/agent (prompts.ts, agent.ts,
 * tool-executor.ts, claude-code-runner.ts) and src/tools/registry.ts — keep in sync.
 */

const CONTEXT: [string, string][] = [
  ['성격', 'SOUL'],
  ['한국 리서치 플레이북', 'DART 키 유무로 단계 전환'],
  ['스킬 목록', '질문에 맞으면 먼저 실행'],
  ['리서치 규칙', 'RULES.md'],
  ['메모리', '저장된 선호 · 메모'],
  ['출력 형식', '데스크탑 · CLI'],
];

const LOOP: [string, string][] = [
  ['경량 압축', '오래된 도구 결과 정리'],
  ['모델 호출', '스트리밍'],
  ['도구 실행', '안전한 도구는 병렬, 위험 도구는 승인'],
  ['결과 기록', '스크래치패드 · 큰 결과는 파일로'],
];

const GUARDS: [string, string][] = [
  ['컨텍스트 관리', '한도에 가까우면 메모리에 저장 → 요약 압축'],
  ['반복 한도', '10회를 넘기면 모은 결과로 부분 답변'],
  ['후속 메시지', '작업 중 보낸 메시지는 다음 반복에 합류'],
];

// Korean first-party sources are the point of this fork, so they get the wide, solid column.
const KR_SOURCES: [string, string][] = [
  ['DART', '공시 원문 · 재무제표 · 지분 공시'],
  ['KRX', '공매도 잔고'],
  ['국민연금', '보유 종목 · 지분율'],
  ['네이버 증권', '실시간 시세 · 외국인 수급 · 컨센서스'],
  ['한국은행 ECOS', '국고채 금리 · 환율'],
];

const KR_SKILLS = ['지주사 SOTP', '물적·인적분할', '밸류업 · 주주환원', '이익의 질', '상대가치', 'DCF', '투자 메모'];

const GLOBAL = ['미국 재무 · 시세 · SEC', '웹 · X 검색', '웹 페이지 읽기'];

function Step({ n, title, sub }: { n: number; title: string; sub?: string }): JSX.Element {
  return (
    <div className="ad-head">
      <span className="ad-step">{n}</span>
      <div>
        <div className="ad-title">{title}</div>
        {sub && <div className="ad-sub">{sub}</div>}
      </div>
    </div>
  );
}

export default function AgentDiagram(): JSX.Element {
  return (
    <section className="help-sec ad">
      <div className="ad-row2">
        <div className="ad-node">
          <Step n={1} title="입력" sub="질문 + 최근 대화" />
        </div>
        <span className="ad-harrow" aria-hidden="true">→</span>
        <div className="ad-node">
          <Step n={2} title="시스템 프롬프트 조립" />
          <dl className="ad-pairs">
            {CONTEXT.map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>

      <div className="ad-link" aria-hidden="true" />

      <div className="ad-node ad-loopbox">
        <Step n={3} title="에이전트 루프" sub="도구 호출이 더 없을 때까지 반복" />
        <div className="ad-routes">
          <div className="ad-route">
            <b>API 모델 · Codex · Cursor</b>
            <span>Dexter 루프가 직접 실행</span>
          </div>
          <div className="ad-route">
            <b>Claude Code</b>
            <span>한 세션 안에서 실행 — 같은 도구를 내장 MCP 서버로 연결</span>
          </div>
        </div>
        <div className="ad-cycle">
          {LOOP.map(([t, d], i) => (
            <div className="ad-cycle-item" key={t}>
              {i > 0 && (
                <span className="ad-loop-arrow" aria-hidden="true">
                  →
                </span>
              )}
              <div className="ad-cycle-card">
                <div className="ad-cycle-title">{t}</div>
                <div className="ad-cycle-sub">{d}</div>
              </div>
            </div>
          ))}
          <span className="ad-loop-repeat">↻ 반복</span>
        </div>
        <div className="ad-guards">
          {GUARDS.map(([t, d]) => (
            <div className="ad-guard" key={t}>
              <b>{t}</b>
              <span>{d}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="ad-link" aria-hidden="true" />

      <div className="ad-sources">
        <div className="ad-source ad-source-kr">
          <div className="ad-source-title">
            한국 1차 출처 <span className="ad-badge">키 없이도 일부 작동</span>
          </div>
          <dl>
            {KR_SOURCES.map(([name, what]) => (
              <div className="ad-kr-row" key={name}>
                <dt>{name}</dt>
                <dd>{what}</dd>
              </div>
            ))}
          </dl>
        </div>
        <div className="ad-source">
          <div className="ad-source-title">한국형 분석 스킬</div>
          <ul>
            {KR_SKILLS.map((it) => (
              <li key={it}>{it}</li>
            ))}
          </ul>
        </div>
        <div className="ad-source">
          <div className="ad-source-title">글로벌 · 리서치</div>
          <ul>
            {GLOBAL.map((it) => (
              <li key={it}>{it}</li>
            ))}
          </ul>
        </div>
      </div>
      <p className="ad-note">도구는 키가 있을 때만 켜집니다 — DART 키 → 공시·재무, KRX 계정 → 공매도, 검색 키 → 웹 검색.</p>

      <div className="ad-link" aria-hidden="true" />

      <div className="ad-node">
        <Step n={4} title="답변" sub="한국어로, 숫자마다 공시·데이터 출처와 기준일을 붙여 정리" />
      </div>
    </section>
  );
}
