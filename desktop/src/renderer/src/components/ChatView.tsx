import { type KeyboardEvent, useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import ThreeLogo from './ThreeLogo';
import type { AgentEvent, ChatConversation, SidecarToMain } from '../../../shared/sidecar';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  pending?: boolean;
  status?: string;
}

interface Props {
  conversation: ChatConversation | null;
  onSaved: (conv: ChatConversation) => void;
  onOpenSettings: () => void;
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

export default function ChatView({ conversation, onSaved, onOpenSettings }: Props): JSX.Element {
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
        ? conversation.messages.map((m) => ({ id: crypto.randomUUID(), role: m.role, content: m.content }))
        : [],
    );
  }, [conversation?.id]);

  function persist(msgs: ChatMessage[]): void {
    const id = currentIdRef.current;
    if (!id) return;
    const stored = msgs
      .filter((m) => !m.pending && m.content.trim())
      .map((m) => ({ role: m.role, content: m.content }));
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
            if (typeof ev.text === 'string') {
              patch((m) => ({ ...m, content: m.content + ev.text, status: undefined }));
            }
            break;
          case 'thinking':
            patch((m) => ({ ...m, status: m.content ? undefined : '분석 중…' }));
            break;
          case 'tool_start':
            patch((m) => ({ ...m, content: '', status: toolStatus(ev) }));
            break;
          case 'tool_end':
          case 'tool_error':
            patch((m) => ({ ...m, status: '정리 중…' }));
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
                  m.content ? (
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content}</ReactMarkdown>
                  ) : (
                    <span className="typing">{m.status ?? '●●●'}</span>
                  )
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
