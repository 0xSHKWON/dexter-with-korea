import { type KeyboardEvent, useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import ThreeLogo from './ThreeLogo';
import type { AgentEvent, ChatConversation, ChatStep, SidecarToMain } from '../../../shared/sidecar';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  /** Reasoning timeline (tool calls + thoughts) shown before the final answer. */
  steps?: ChatStep[];
  pending?: boolean;
  status?: string;
}

interface Props {
  conversation: ChatConversation | null;
  onSaved: (conv: ChatConversation) => void;
  onOpenSettings: () => void;
  /** A prompt to prefill into the composer (e.g. from a Help example). */
  seed?: string | null;
  onSeedConsumed?: () => void;
}

const EXAMPLES = [
  '삼성전자 사업보고서에서 핵심 리스크와 사업 현황 정리해줘',
  '에코프로비엠 외국인 지분율·공매도 잔고 추이 같이 보여줘',
  'SK하이닉스 DCF로 적정주가 계산해줘',
  '국민연금이 보유한 현대차 지분과 5% 이상 대량보유 현황 알려줘',
];

const TOOL_LABELS: Record<string, string> = {
  get_financials: '재무제표 조회',
  get_financials_kr: '재무제표 조회',
  get_market_data: '시세 조회',
  get_market_data_kr: '시세 조회',
  read_filings: '공시 정독',
  read_filings_kr: '공시 정독',
  get_filings_kr: '공시 검색',
  get_foreign_ownership_kr: '외국인 지분 조회',
  get_short_balance_kr: '공매도 잔고 조회',
  get_nps_holdings: '국민연금 보유 조회',
  get_large_holders_kr: '대량보유 조회',
  get_insider_trades_kr: '임원 거래 조회',
  stock_screener: '종목 스크리닝',
  web_search: '웹 검색',
  web_fetch: '웹 페이지 읽기',
  skill: '분석 스킬 로드',
};

function argSummary(args?: Record<string, unknown>): string {
  if (!args) return '';
  for (const k of ['ticker', 'symbol', 'corp', 'skill', 'query', 'name']) {
    const v = args[k];
    if (typeof v === 'string' && v) return v;
  }
  return '';
}

function toolStatus(ev: AgentEvent): string {
  const label = TOOL_LABELS[ev.tool ?? ''] ?? ev.tool ?? '데이터 조회';
  const arg = argSummary(ev.args);
  return arg ? `${label} · ${arg} …` : `${label} …`;
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

/** Commit any interim narration that streamed into `content` as a text step. */
function flushText(steps: ChatStep[], content: string): ChatStep[] {
  const t = content.trim();
  return t ? [...steps, { kind: 'text', text: t }] : steps;
}

function appendTool(steps: ChatStep[], ev: AgentEvent): ChatStep[] {
  return [
    ...steps,
    {
      kind: 'tool',
      id: typeof ev.toolCallId === 'string' ? ev.toolCallId : undefined,
      tool: ev.tool,
      arg: argSummary(ev.args),
      state: 'running',
    },
  ];
}

/** Patch the tool step a tool_end/error/progress belongs to (by id, else last running). */
function patchTool(steps: ChatStep[], ev: AgentEvent, change: Partial<ChatStep>): ChatStep[] {
  const id = typeof ev.toolCallId === 'string' ? ev.toolCallId : undefined;
  let idx = -1;
  for (let i = steps.length - 1; i >= 0; i--) {
    const s = steps[i];
    if (s.kind !== 'tool') continue;
    if (id ? s.id === id : s.state === 'running' && (!ev.tool || s.tool === ev.tool)) {
      idx = i;
      break;
    }
  }
  if (idx < 0) return steps;
  const next = steps.slice();
  next[idx] = { ...next[idx], ...change };
  return next;
}

function stepLabel(step: ChatStep): string {
  if (step.kind === 'text') return '추론';
  const label = TOOL_LABELS[step.tool ?? ''] ?? step.tool ?? '데이터 조회';
  return step.arg ? `${label} · ${step.arg}` : label;
}

function stepGlyph(state?: ChatStep['state']): string {
  if (state === 'done') return '✓';
  if (state === 'error') return '✕';
  return '◐'; // running
}

/**
 * Collapsible reasoning timeline. Each tool call / thought lands as its own
 * row, one by one, while the turn is live (block stays expanded). Once the
 * answer arrives it auto-collapses into a toggle; manual toggle wins after.
 */
function StepsBlock({ steps, live }: { steps: ChatStep[]; live: boolean }): JSX.Element {
  const [open, setOpen] = useState(live);
  const wasLive = useRef(live);
  useEffect(() => {
    if (wasLive.current && !live) setOpen(false); // run finished → collapse
    if (!wasLive.current && live) setOpen(true); // run (re)started → expand
    wasLive.current = live;
  }, [live]);

  return (
    <div className={`reasoning${open ? ' open' : ''}`}>
      <button type="button" className="reasoning-toggle" onClick={() => setOpen((o) => !o)}>
        <span className="reasoning-caret">{open ? '▾' : '▸'}</span>
        <span className="reasoning-label">사고 과정 · {steps.length}단계</span>
        {live && <span className="reasoning-live">진행 중…</span>}
      </button>
      {open && (
        <div className="reasoning-body">
          {steps.map((s, i) =>
            s.kind === 'text' ? (
              <div key={i} className="reasoning-step reasoning-text">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{s.text ?? ''}</ReactMarkdown>
              </div>
            ) : (
              <div key={i} className={`reasoning-step reasoning-tool state-${s.state ?? 'running'}`}>
                <span className="step-glyph">{stepGlyph(s.state)}</span>
                <span className="step-label">{stepLabel(s)}</span>
                {s.detail && <span className="step-detail">{s.detail}</span>}
              </div>
            ),
          )}
        </div>
      )}
    </div>
  );
}

export default function ChatView({ conversation, onSaved, onOpenSettings, seed, onSeedConsumed }: Props): JSX.Element {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [hasLlmKey, setHasLlmKey] = useState<boolean | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const activeRef = useRef<{ runId: string; pendingId: string } | null>(null);
  const currentIdRef = useRef<string | null>(null);

  // LLM key check (drives empty-state guidance).
  useEffect(() => {
    (async () => {
      try {
        const [provs, statuses] = await Promise.all([
          window.dexter.providers.list(),
          window.dexter.secrets.statusAll(),
        ]);
        const llmEnvs = new Set(provs.filter((p) => p.apiKeyEnvVar).map((p) => p.apiKeyEnvVar as string));
        setHasLlmKey(statuses.some((s) => llmEnvs.has(s.envVar) && s.exists));
      } catch {
        setHasLlmKey(false);
      }
    })();
  }, []);

  // Load messages when the selected conversation changes (or new chat = null).
  useEffect(() => {
    currentIdRef.current = conversation?.id ?? null;
    setMessages(
      conversation
        ? conversation.messages.map((m) => ({
            id: crypto.randomUUID(),
            role: m.role,
            content: m.content,
            steps: m.steps,
          }))
        : [],
    );
  }, [conversation?.id]);

  // Prefill a prompt handed in from elsewhere (e.g. a Help example), then clear it.
  const seedConsumedRef = useRef(onSeedConsumed);
  seedConsumedRef.current = onSeedConsumed;
  useEffect(() => {
    if (!seed) return;
    setInput(seed);
    taRef.current?.focus();
    seedConsumedRef.current?.();
  }, [seed]);

  function persist(msgs: ChatMessage[]): void {
    const id = currentIdRef.current;
    if (!id) return;
    const stored = msgs
      .filter((m) => !m.pending && m.content.trim())
      .map((m) => ({
        role: m.role,
        content: m.content,
        ...(m.steps && m.steps.length ? { steps: m.steps } : {}),
      }));
    if (stored.length < 2) return;
    const title = (stored.find((m) => m.role === 'user')?.content ?? '대화').slice(0, 40);
    const conv: ChatConversation = { id, createdAt: Date.now(), updatedAt: Date.now(), title, messages: stored };
    void window.dexter.chat
      .saveConversation(conv)
      .then(() => onSaved(conv))
      .catch(() => {});
  }

  // Subscribe once to sidecar messages.
  useEffect(() => {
    function patch(patchFn: (msg: ChatMessage) => ChatMessage): void {
      const active = activeRef.current;
      if (!active) return;
      setMessages((m) => m.map((msg) => (msg.id === active.pendingId ? patchFn(msg) : msg)));
    }

    function handle(msg: SidecarToMain): void {
      const active = activeRef.current;
      if (!active) return;
      if ('id' in msg && msg.id !== active.runId) return;

      if (msg.type === 'event') {
        const ev = msg.event;
        switch (ev.type) {
          case 'text_delta':
            // Streams live into the bubble. If a tool_start follows, this text
            // turns out to be interim narration and gets flushed into a step;
            // otherwise it's the final answer and stays put.
            if (typeof ev.text === 'string') {
              patch((m) => ({ ...m, content: m.content + ev.text, status: undefined }));
            }
            break;
          case 'thinking':
            // Some models emit reasoning text alongside tool calls — record it
            // as its own step (the same text may have streamed into `content`).
            if (typeof ev.message === 'string' && ev.message.trim()) {
              const text = ev.message.trim();
              patch((m) => ({
                ...m,
                steps: [...flushText(m.steps ?? [], m.content), { kind: 'text', text }],
                content: '',
                status: undefined,
              }));
            }
            break;
          case 'tool_start':
            patch((m) => ({
              ...m,
              steps: appendTool(flushText(m.steps ?? [], m.content), ev),
              content: '',
              status: undefined,
            }));
            break;
          case 'tool_progress':
            if (typeof ev.message === 'string' && ev.message.trim()) {
              const detail = truncate(ev.message.trim(), 80);
              patch((m) => ({ ...m, steps: patchTool(m.steps ?? [], ev, { detail }) }));
            }
            break;
          case 'tool_end':
            patch((m) => ({
              ...m,
              steps: patchTool(m.steps ?? [], ev, {
                state: 'done',
                detail: typeof ev.duration === 'number' ? `${(ev.duration / 1000).toFixed(1)}s` : undefined,
              }),
            }));
            break;
          case 'tool_error':
            patch((m) => ({
              ...m,
              steps: patchTool(m.steps ?? [], ev, {
                state: 'error',
                detail: typeof ev.error === 'string' ? truncate(ev.error, 80) : '오류',
              }),
            }));
            break;
          case 'done':
            if (typeof ev.answer === 'string') {
              patch((m) => ({ ...m, content: ev.answer as string, pending: false, status: undefined }));
            }
            break;
        }
      } else if (msg.type === 'done') {
        activeRef.current = null;
        setSending(false);
        setMessages((prev) => {
          persist(prev);
          return prev;
        });
      } else if (msg.type === 'error') {
        patch((m) => ({ ...m, content: `오류: ${msg.message}`, pending: false, status: undefined }));
        activeRef.current = null;
        setSending(false);
      }
    }

    return window.dexter.chat.onEvent(handle);
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  async function send(): Promise<void> {
    const text = input.trim();
    if (!text || sending) return;
    setInput('');
    if (!currentIdRef.current) currentIdRef.current = crypto.randomUUID();
    const pendingId = crypto.randomUUID();
    setMessages((m) => [
      ...m,
      { id: crypto.randomUUID(), role: 'user', content: text },
      { id: pendingId, role: 'assistant', content: '', pending: true, status: '시작하는 중…' },
    ]);
    setSending(true);
    try {
      const { runId } = await window.dexter.chat.send(text);
      activeRef.current = { runId, pendingId };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setMessages((m) =>
        m.map((msg) => (msg.id === pendingId ? { ...msg, content: `오류: ${message}`, pending: false } : msg)),
      );
      setSending(false);
    }
  }

  function cancel(): void {
    const active = activeRef.current;
    if (active) {
      void window.dexter.chat.cancel(active.runId);
      setMessages((m) =>
        m.map((msg) =>
          msg.id === active.pendingId
            ? { ...msg, content: msg.content || '중단됨', pending: false, status: undefined }
            : msg,
        ),
      );
      activeRef.current = null;
    }
    setSending(false);
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>): void {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  }

  function useExample(text: string): void {
    setInput(text);
    taRef.current?.focus();
  }

  const empty = messages.length === 0;

  return (
    <div className="chat">
      <div className="chat-messages" ref={scrollRef}>
        {empty ? (
          <div className="chat-empty">
            <ThreeLogo />
            <h2>무엇이든 물어보세요</h2>
            <p className="muted">DART·KRX에 직접 가지 않아도, 질문하면 데이터를 모아 정리해 드립니다.</p>
            {hasLlmKey === false ? (
              <div className="empty-cta">
                <p className="muted">시작하려면 LLM API 키가 필요합니다.</p>
                <button className="btn primary" onClick={onOpenSettings}>
                  설정 열기
                </button>
              </div>
            ) : (
              <div className="example-chips">
                {EXAMPLES.map((ex) => (
                  <button key={ex} className="chip" onClick={() => useExample(ex)}>
                    {ex}
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="chat-thread">
            {messages.map((m) => (
              <div key={m.id} className={`msg msg-${m.role}`}>
                {m.role === 'assistant' ? (
                  <>
                    {m.steps && m.steps.length > 0 && <StepsBlock steps={m.steps} live={!!m.pending} />}
                    {m.content ? (
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content}</ReactMarkdown>
                    ) : (
                      m.pending &&
                      (!m.steps || m.steps.length === 0) && <span className="typing">{m.status ?? '●●●'}</span>
                    )}
                  </>
                ) : (
                  m.content
                )}
                {m.pending && m.content && <span className="stream-caret" />}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="composer">
        <div className="composer-inner">
          <textarea
            ref={taRef}
            rows={1}
            placeholder="질문을 입력하세요  (Enter 전송 · Shift+Enter 줄바꿈)"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
          />
          {sending ? (
            <button className="btn ghost send-btn" onClick={cancel}>
              중단
            </button>
          ) : (
            <button className="btn primary send-btn" onClick={() => void send()} disabled={!input.trim()}>
              전송
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
