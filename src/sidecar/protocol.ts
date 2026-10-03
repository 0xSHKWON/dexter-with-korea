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
import type { Question, UserAnswers } from '../tools/ask-user-question/types.js';

export type SidecarRequest =
  | {
      type: 'run';
      /** Correlates events/done/error back to this request. */
      id: string;
      query: string;
      /** Model id, e.g. "gpt-6-astra", "claude-sonnet-5", "ollama:llama3.1". */
      model: string;
      /** Provider slug, e.g. "openai", "anthropic". */
      modelProvider: string;
      maxIterations?: number;
      /** Reasoning effort for providers that support it (Claude Code, Codex). */
      effort?: string;
    }
  | { type: 'cancel'; id: string }
  | {
      /** The shell's answer to a `question` message (ask_user_question). */
      type: 'answer';
      /** Correlates to the `question` message's questionId. */
      questionId: string;
      answers: UserAnswers;
    }
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
    }
  | {
      /** Run a subscription (OAuth) login; credentials land in <DEXTER_DIR>/auth.json. */
      type: 'auth_login';
      id: string;
      provider: 'openai-codex';
      /** 'device' = user-code flow, for when the browser callback can't reach this machine. */
      mode?: 'browser' | 'device';
    }
  | { type: 'auth_cancel'; id: string }
  | {
      /** Reuse the existing Codex CLI login (shared tokens, see auth/codex-cli.ts). */
      type: 'auth_link_codex_cli';
      id: string;
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
  | { type: 'convert_result'; id: string; result: ConvertResult }
  | {
      /** The agent (ask_user_question) is waiting on the user; the shell must reply
       *  with an `answer` request carrying the same questionId. */
      type: 'question';
      /** Run this question belongs to (so the shell binds it to the active turn). */
      id: string;
      questionId: string;
      questions: Question[];
    }
  | {
      /** The shell must open `url` (browser flow) or show `userCode` (device flow). */
      type: 'auth_prompt';
      id: string;
      url: string;
      userCode?: string;
    }
  | { type: 'auth_result'; id: string; ok: true; email?: string; plan?: string }
  | { type: 'auth_result'; id: string; ok: false; error: string };
