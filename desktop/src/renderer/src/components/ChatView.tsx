import { type KeyboardEvent, useEffect, useRef, useState } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { normalizeKoreanBold } from '../markdown';
import ThreeLogo from './ThreeLogo';
import QuestionPrompt from './QuestionPrompt';
import ModelPicker from './ModelPicker';
import type {
  AgentEvent,
  ChatConversation,
  ChatStep,
  Question,
  SidecarToMain,
  UserAnswers,
} from '../../../shared/sidecar';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  /** Reasoning timeline (tool calls + thoughts) shown before the final answer. */
  steps?: ChatStep[];
  pending?: boolean;
  status?: string;
  /** Epoch ms: sent (user) / finished (assistant). */
  at?: number;
}

interface Props {
  conversation: ChatConversation | null;
  onSaved: (conv: ChatConversation) => void;
  onOpenSettings: () => void;
  /** A prompt to prefill into the composer (e.g. from a Help example). */
  seed?: string | null;
  onSeedConsumed?: () => void;
  /** Start a fresh conversation — one History row holds one question and one answer. */
  onNewChat: () => void;
  /** The default model was switched from the composer picker. */
  onModelChanged?: () => void;
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
  get_beta: '베타 조회',
  get_beta_kr: '베타 산출',
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
  // get_beta takes a peer set as an array.
  const tickers = args.tickers;
  if (Array.isArray(tickers)) {
    const names = tickers.filter((t): t is string => typeof t === 'string' && t.length > 0);
    if (names.length > 0) {
      const head = names.slice(0, 3).join(', ');
      return names.length > 3 ? `${head} 외 ${names.length - 3}개` : head;
    }
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
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{normalizeKoreanBold(s.text ?? '')}</ReactMarkdown>
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

export default function ChatView({
  conversation,
  onSaved,
  onOpenSettings,
  seed,
  onSeedConsumed,
  onNewChat,
  onModelChanged,
}: Props): JSX.Element {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [hasLlmKey, setHasLlmKey] = useState<boolean | null>(null);
  const [pendingQuestion, setPendingQuestion] = useState<{ questionId: string; questions: Question[] } | null>(null);
  const [exporting, setExporting] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  // Follow the stream only while the reader is at the bottom; scrolling up to
  // reread must not be yanked back down by every incoming token.
  const pinnedRef = useRef(true);
  const [pinned, setPinned] = useState(true);
  const lastScrollTopRef = useRef(0);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const activeRef = useRef<{ runId: string; pendingId: string } | null>(null);
  const currentIdRef = useRef<string | null>(null);

  // LLM key check (drives empty-state guidance).
  useEffect(() => {
    (async () => {
      try {
        const [provs, statuses, codex, claude] = await Promise.all([
          window.dexter.providers.list(),
          window.dexter.secrets.statusAll(),
          window.dexter.auth.status(),
          window.dexter.claudeCode.status(),
        ]);
        const llmEnvs = new Set(provs.filter((p) => p.apiKeyEnvVar).map((p) => p.apiKeyEnvVar as string));
        setHasLlmKey(codex.loggedIn || claude.loggedIn || statuses.some((s) => llmEnvs.has(s.envVar) && s.exists));
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
            at: m.at,
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
        ...(m.at ? { at: m.at } : {}),
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
      } else if (msg.type === 'question') {
        // Agent paused on ask_user_question — show the inline choice panel.
        setPendingQuestion({ questionId: msg.questionId, questions: msg.questions });
      } else if (msg.type === 'done') {
        patch((m) => ({ ...m, at: m.at ?? Date.now() }));
        activeRef.current = null;
        setSending(false);
        setPendingQuestion(null);
        setMessages((prev) => {
          persist(prev);
          return prev;
        });
      } else if (msg.type === 'error') {
        patch((m) => ({ ...m, content: `오류: ${msg.message}`, pending: false, status: undefined }));
        activeRef.current = null;
        setSending(false);
        setPendingQuestion(null);
      }
    }

    return window.dexter.chat.onEvent(handle);
  }, []);

  function setPin(value: boolean): void {
    pinnedRef.current = value;
    setPinned(value);
  }

  // Only an upward move unpins. Judging by distance-from-bottom alone misfires:
  // by the time our own scrollTo's event fires, more tokens have grown the
  // content, so it looks like the user left the bottom. Growth and our
  // scroll-to-bottom never decrease scrollTop; a wheel/drag/key up does.
  function onScroll(): void {
    const el = scrollRef.current;
    if (!el) return;
    const top = el.scrollTop;
    const movedUp = top < lastScrollTopRef.current - 2;
    lastScrollTopRef.current = top;
    if (movedUp) {
      if (pinnedRef.current) setPin(false);
    } else if (!pinnedRef.current && el.scrollHeight - top - el.clientHeight < 48) {
      setPin(true);
    }
  }

  function scrollToBottom(): void {
    setPin(true);
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }

  useEffect(() => {
    if (pinnedRef.current) scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, pendingQuestion]);

  // Opening another conversation starts at its latest message. A new chat also
  // gets its id mid-stream (first save) — that must not re-pin a reader who
  // scrolled up, hence the in-flight check.
  useEffect(() => {
    if (!activeRef.current) setPin(true);
  }, [conversation?.id]);

  async function send(): Promise<void> {
    const text = input.trim();
    if (!text || sending) return;
    setInput('');
    setPin(true);
    if (!currentIdRef.current) currentIdRef.current = crypto.randomUUID();
    const pendingId = crypto.randomUUID();
    setMessages((m) => [
      ...m,
      { id: crypto.randomUUID(), role: 'user', content: text, at: Date.now() },
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
    setPendingQuestion(null); // sidecar declines it on cancel; just drop the panel
    setSending(false);
  }

  function answerQuestion(answers: UserAnswers): void {
    if (!pendingQuestion) return;
    void window.dexter.chat.answer(pendingQuestion.questionId, answers);
    setPendingQuestion(null);
  }

  function dismissQuestion(): void {
    if (!pendingQuestion) return;
    void window.dexter.chat.answer(pendingQuestion.questionId, { answers: [], declined: true });
    setPendingQuestion(null);
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

  /**
   * Clear this view, then let the parent switch conversations. Resetting locally
   * matters because the load effect keys on `conversation?.id`: a turn that never
   * persisted (cancelled, or a sidecar-level error — neither calls persist) leaves
   * chatId already null, so null → null is not a change, the effect never runs,
   * and the "새 질문하기" button silently does nothing.
   */
  function startNewChat(): void {
    currentIdRef.current = null;
    setMessages([]);
    setInput('');
    onNewChat();
  }

  async function exportPdf(): Promise<void> {
    const question = messages.find((m) => m.role === 'user');
    const answer = [...messages].reverse().find((m) => m.role === 'assistant' && m.content.trim());
    if (!question || !answer || exporting) return;
    const sources = [
      ...new Set((answer.steps ?? []).filter((s) => s.kind === 'tool' && s.state === 'done').map(stepLabel)),
    ];
    setExporting(true);
    try {
      await window.dexter.chat.exportPdf({
        title: conversation?.title ?? question.content.slice(0, 40),
        question: question.content,
        answerHtml: renderToStaticMarkup(
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{normalizeKoreanBold(answer.content)}</ReactMarkdown>,
        ),
        askedAt: question.at,
        // Rows saved before timestamps existed: the first save lands right after the answer.
        answeredAt: answer.at ?? conversation?.createdAt,
        sources,
      });
    } catch (e) {
      window.alert(`PDF 저장 실패: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setExporting(false);
    }
  }

  const empty = messages.length === 0;
  // This thread has had its answer — a settled assistant turn with content. Covers
  // errors and cancellations too: both land as non-pending assistant text, and
  // retrying belongs in a new conversation just as much as a new question does.
  const answered =
    !sending && !pendingQuestion && messages.some((m) => m.role === 'assistant' && !m.pending && m.content.trim());

  return (
    <div className="chat">
      <div className="chat-messages" ref={scrollRef} onScroll={onScroll}>
        {empty ? (
          <div className="chat-empty">
            <ThreeLogo />
            <h2>무엇이든 물어보세요</h2>
            <p className="muted">DART·KRX에 직접 가지 않아도, 질문하면 데이터를 모아 정리해 드립니다.</p>
            {hasLlmKey === false ? (
              <div className="empty-cta">
                <p className="muted">시작하려면 Claude·ChatGPT 로그인 또는 LLM API 키가 필요합니다.</p>
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
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{normalizeKoreanBold(m.content)}</ReactMarkdown>
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
        {pendingQuestion && (
          <QuestionPrompt
            questions={pendingQuestion.questions}
            onSubmit={answerQuestion}
            onDismiss={dismissQuestion}
          />
        )}
      </div>

      <div className="composer">
        {!pinned && !empty && (
          <button className="jump-latest" onClick={scrollToBottom}>
            ↓ {sending ? '최신 내용' : '맨 아래로'}
          </button>
        )}
        {answered ? (
          // One History row is one question and one answer: the row's title is its
          // first question, so a follow-up here would be filed under an unrelated
          // heading and be undiscoverable later. The engine matches this — a run
          // carries no prior turns (src/sidecar/index.ts).
          <div className="composer-inner composer-done">
            <span className="composer-note">답변이 끝났습니다. 다음 질문은 새 대화로 시작하세요.</span>
            <div className="composer-actions">
              <button className="btn send-btn" onClick={() => void exportPdf()} disabled={exporting}>
                {exporting ? 'PDF 만드는 중…' : 'PDF로 저장'}
              </button>
              <button className="btn primary send-btn" onClick={startNewChat}>
                새 질문하기
              </button>
            </div>
          </div>
        ) : (
          <div className="composer-inner">
            <ModelPicker disabled={sending} onChanged={onModelChanged} onOpenSettings={onOpenSettings} />
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
        )}
      </div>
    </div>
  );
}
