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

/** A saved (archived) conversion. */
export interface ConversionRecord {
  id: string;
  createdAt: number;
  title: string;
  raw: string;
  result: ConvertResult;
}

/** A persisted chat message (completed turns only — no pending/streaming state). */
export interface StoredMessage {
  role: 'user' | 'assistant';
  content: string;
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
  | { type: 'convert_result'; id: string; result: ConvertResult };

export type MainToSidecar =
  | { type: 'run'; id: string; query: string; model: string; modelProvider: string }
  | { type: 'cancel'; id: string }
  | { type: 'reset' }
  | { type: 'convert'; id: string; rawData: string; model: string; modelProvider: string };
