/**
 * Bridges the agent's `ask_user_question` (which awaits a Promise) to the
 * desktop shell over the newline-JSON protocol.
 *
 * The agent calls `requestUserInput(runId)(request)` and blocks on the returned
 * Promise. We stash its resolver keyed by a fresh questionId and emit a
 * `question` message; when the shell replies with an `answer` request we resolve
 * the matching Promise. If a run is cancelled/errors while a question is still
 * open, the resolver would otherwise leak (the agent hangs), so `abandonRun`
 * settles every pending question for that run as `declined` — the tool's
 * documented "proceed with defaults" path.
 *
 * Pure of I/O (emit + id-gen are injected) so the resolve/abandon routing is
 * unit-testable without spawning a process.
 */
import type { Question, UserAnswers } from '../tools/ask-user-question/types.js';

export interface EmittedQuestion {
  runId: string;
  questionId: string;
  questions: Question[];
}

interface Pending {
  runId: string;
  resolve: (answers: UserAnswers) => void;
}

const DECLINED: UserAnswers = { answers: [], declined: true };

export interface UserInputBridge {
  /** Build the `requestUserInput` callback for a given run (passed to Agent.create). */
  requestUserInput(runId: string): (request: { questions: Question[] }) => Promise<UserAnswers>;
  /** Resolve the pending question with the shell's answer. Returns false if unknown/stale. */
  resolveAnswer(questionId: string, answers: UserAnswers): boolean;
  /** Settle every pending question for a run as declined (cancel/error/completion). */
  abandonRun(runId: string): void;
  /** Settle all pending questions as declined (e.g. history reset). */
  abandonAll(): void;
  /** Count of open questions — for tests/diagnostics. */
  size(): number;
}

export function createUserInputBridge(opts: {
  emitQuestion: (q: EmittedQuestion) => void;
  genId: () => string;
}): UserInputBridge {
  const pending = new Map<string, Pending>();

  return {
    requestUserInput(runId) {
      return (request) =>
        new Promise<UserAnswers>((resolve) => {
          const questionId = opts.genId();
          pending.set(questionId, { runId, resolve });
          opts.emitQuestion({ runId, questionId, questions: request.questions });
        });
    },

    resolveAnswer(questionId, answers) {
      const p = pending.get(questionId);
      if (!p) return false;
      pending.delete(questionId);
      p.resolve(answers);
      return true;
    },

    abandonRun(runId) {
      for (const [questionId, p] of pending) {
        if (p.runId === runId) {
          pending.delete(questionId);
          p.resolve(DECLINED);
        }
      }
    },

    abandonAll() {
      for (const p of pending.values()) p.resolve(DECLINED);
      pending.clear();
    },

    size() {
      return pending.size;
    },
  };
}
