/**
 * Wire protocol between the desktop shell (Electron main) and the headless
 * Bun core sidecar. Newline-delimited JSON over stdin/stdout.
 *
 * main → sidecar: SidecarRequest (one JSON object per line on stdin)
 * sidecar → main: SidecarMessage (one JSON object per line on stdout)
 *
 * stdout is reserved exclusively for SidecarMessage lines; all logging goes
 * to stderr (the sidecar entry redirects console.* to stderr).
 */
import type { AgentEvent } from '../agent/types.js';

export type SidecarRequest =
  | {
      type: 'run';
      /** Correlates events/done/error back to this request. */
      id: string;
      query: string;
      /** Model id, e.g. "gpt-5.5", "claude-sonnet-4-6", "ollama:llama3.1". */
      model: string;
      /** Provider slug, e.g. "openai", "anthropic". */
      modelProvider: string;
      maxIterations?: number;
    }
  | { type: 'cancel'; id: string }
  | {
      /** Clear the in-memory conversation history (new chat / switched chat). */
      type: 'reset';
    }
  | {
      /** Convert raw ledger/trial-balance data into DART standard accounts. */
      type: 'convert';
      id: string;
      rawData: string;
      model: string;
      modelProvider: string;
    };

/** One mapped account line in the converted financial statements. */
export interface AccountMapping {
  /** Original account name from the user's data. */
  original: string;
  /** DART standard account (taxonomy) the LLM mapped it to. */
  standard: string;
  amount: number;
  /** Statement bucket: BS (재무상태표) / IS (손익계산서) / CF (현금흐름표) / 기타. */
  statement: string;
  /** Optional note when the mapping is uncertain or needs review. */
  note?: string;
}

export interface ConvertResult {
  mappings: AccountMapping[];
  /** Overall warnings: missing items, anomalies, things to double-check. */
  warnings: string[];
}

export type SidecarMessage =
  | { type: 'ready' }
  | { type: 'event'; id: string; event: AgentEvent }
  | { type: 'done'; id: string; answer: string }
  | { type: 'error'; id: string; message: string }
  | { type: 'convert_result'; id: string; result: ConvertResult };
