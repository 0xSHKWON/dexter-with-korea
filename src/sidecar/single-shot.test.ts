/**
 * The desktop is single-shot: one History row is one question and one answer.
 * These pin that the sidecar carries no prior turns into a run — and, just as
 * importantly, that the CLI still does (it threads one InMemoryChatHistory
 * through a session, and that must not be collateral damage).
 */
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { InMemoryChatHistory } from '../utils/in-memory-chat-history.js';

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf-8');

/** Prose explaining the design mentions the very names we assert are gone — look at code only. */
const stripComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');

describe('sidecar runs are single-shot', () => {
  const code = stripComments(read('./index.ts'));

  it('passes no history to agent.run', () => {
    expect(code.match(/agent\.run\([^)]*\)/)?.[0]).toBe('agent.run(req.query)');
  });

  it('keeps no conversation history at all', () => {
    const banned = ['new InMemoryChatHistory', 'in-memory-chat-history', 'saveUserQuery', 'saveAnswer'];
    // saveAnswer is what triggers the per-answer summarization LLM call.
    expect(banned.filter((needle) => code.includes(needle))).toEqual([]);
  });
});

describe('the CLI keeps multi-turn context', () => {
  it('still threads its history object through agent.run', () => {
    const source = read('../controllers/agent-runner.ts');
    expect(source).toContain('agent.run(query, this.inMemoryChatHistory)');
    expect(source).toContain('this.inMemoryChatHistory.saveAnswer(');
  });

  it('replays prior turns, most recent in full', () => {
    const history = new InMemoryChatHistory();
    history.saveUserQuery('SK하이닉스 DCF로 적정주가 계산해줘');
    // Bypass saveAnswer so the test needs no LLM call for the summary.
    const [turn] = history.getMessages();
    turn.answer = '적정주가 ₩250,000';
    turn.summary = '하이닉스 DCF 요약';

    const replayed = history.getRecentTurnsAsMessages();
    expect(replayed).toHaveLength(2);
    expect(replayed[0].content).toBe('SK하이닉스 DCF로 적정주가 계산해줘');
    expect(replayed[1].content).toBe('적정주가 ₩250,000');
  });
});
