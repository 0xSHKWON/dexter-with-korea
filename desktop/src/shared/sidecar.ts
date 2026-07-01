/**
 * Sidecar wire types (desktop side). Mirrors the core's src/sidecar/protocol.ts.
 * AgentEvent is kept loose here — the renderer only reads a few fields and we
 * don't want to duplicate the full core union.
 */

export interface AgentEvent {
  type: string;
  text?: string;
  answer?: string;
  message?: string;
  tool?: string;
  args?: Record<string, unknown>;
  toolCallId?: string;
  [key: string]: unknown;
}

export interface AccountMapping {
  original: string;
  standard: string;
  amount: number;
  statement: string;
  note?: string;
}

export interface ConvertResult {
  mappings: AccountMapping[];
  warnings: string[];
}

// ── ask_user_question (mirrors core src/tools/ask-user-question/types.ts) ─────

export interface QuestionOption {
  label: string;
  description: string;
}

export interface Question {
  question: string;
  /** Short chip/tab label (<=12 chars). */
  header: string;
  multiSelect: boolean;
  /** Model-supplied options; the "Other" free-text choice is added by the UI. */
  options: QuestionOption[];
}

export interface QuestionAnswer {
  header: string;
  question: string;
  /** Chosen option label(s). */
  selected: string[];
  /** Free text from the "Other" choice, if used. */
  otherText?: string;
  notes?: string;
}

export interface UserAnswers {
  answers: QuestionAnswer[];
  /** True when the user dismissed the prompt without answering. */
  declined?: boolean;
}

/** A saved (archived) conversion. */
export interface ConversionRecord {
  id: string;
  createdAt: number;
  title: string;
  raw: string;
  result: ConvertResult;
}

/**
 * One entry in an assistant turn's reasoning timeline — either a tool call
 * (with its live/finished state) or a chunk of the model's reasoning text.
 */
export interface ChatStep {
  kind: 'tool' | 'text';
  /** Runtime correlation id (tool_call id); persisted but only used live. */
  id?: string;
  /** tool steps */
  tool?: string;
  arg?: string;
  state?: 'running' | 'done' | 'error';
  detail?: string;
  /** text steps */
  text?: string;
}

/** A persisted chat message (completed turns only — no pending/streaming state). */
export interface StoredMessage {
  role: 'user' | 'assistant';
  content: string;
  /** The reasoning timeline (tool calls + thoughts) shown before the answer. */
  steps?: ChatStep[];
}

/** An archived chat conversation. */
export interface ChatConversation {
  id: string;
  createdAt: number;
  updatedAt: number;
  title: string;
  messages: StoredMessage[];
}

export type SidecarToMain =
  | { type: 'ready' }
  | { type: 'event'; id: string; event: AgentEvent }
  | { type: 'done'; id: string; answer: string }
  | { type: 'error'; id: string; message: string }
  | { type: 'convert_result'; id: string; result: ConvertResult }
  | { type: 'question'; id: string; questionId: string; questions: Question[] };

export type MainToSidecar =
  | { type: 'run'; id: string; query: string; model: string; modelProvider: string }
  | { type: 'cancel'; id: string }
  | { type: 'reset' }
  | { type: 'convert'; id: string; rawData: string; model: string; modelProvider: string }
  | { type: 'answer'; questionId: string; answers: UserAnswers };
