import { describe, it, expect } from 'bun:test';
import { createUserInputBridge, type EmittedQuestion } from './user-input-bridge.js';
import type { Question, UserAnswers } from '../tools/ask-user-question/types.js';

const QUESTIONS: Question[] = [
  { question: 'β 측정법?', header: 'β 측정법', multiSelect: false, options: [{ label: '2y 주간', description: '표준' }] },
];

function makeBridge() {
  const emitted: EmittedQuestion[] = [];
  let n = 0;
  const bridge = createUserInputBridge({
    emitQuestion: (q) => emitted.push(q),
    genId: () => `q${++n}`,
  });
  return { bridge, emitted };
}

const ANSWER: UserAnswers = { answers: [{ header: 'β 측정법', question: 'β 측정법?', selected: ['2y 주간'] }] };

describe('createUserInputBridge', () => {
  it('emits a question and resolves the promise when answered', async () => {
    const { bridge, emitted } = makeBridge();
    const promise = bridge.requestUserInput('run-1')({ questions: QUESTIONS });

    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toMatchObject({ runId: 'run-1', questionId: 'q1', questions: QUESTIONS });
    expect(bridge.size()).toBe(1);

    const ok = bridge.resolveAnswer('q1', ANSWER);
    expect(ok).toBe(true);
    await expect(promise).resolves.toEqual(ANSWER);
    expect(bridge.size()).toBe(0);
  });

  it('resolveAnswer returns false for an unknown/stale questionId', () => {
    const { bridge } = makeBridge();
    expect(bridge.resolveAnswer('nope', ANSWER)).toBe(false);
  });

  it('abandonRun settles only that run’s questions as declined', async () => {
    const { bridge } = makeBridge();
    const p1 = bridge.requestUserInput('run-1')({ questions: QUESTIONS });
    const p2 = bridge.requestUserInput('run-2')({ questions: QUESTIONS });
    expect(bridge.size()).toBe(2);

    bridge.abandonRun('run-1');
    await expect(p1).resolves.toEqual({ answers: [], declined: true });
    expect(bridge.size()).toBe(1); // run-2 still open

    bridge.resolveAnswer('q2', ANSWER);
    await expect(p2).resolves.toEqual(ANSWER);
  });

  it('abandonAll declines every pending question', async () => {
    const { bridge } = makeBridge();
    const p1 = bridge.requestUserInput('run-1')({ questions: QUESTIONS });
    const p2 = bridge.requestUserInput('run-2')({ questions: QUESTIONS });
    bridge.abandonAll();
    expect(bridge.size()).toBe(0);
    await expect(p1).resolves.toEqual({ answers: [], declined: true });
    await expect(p2).resolves.toEqual({ answers: [], declined: true });
  });

  it('supports concurrent questions within one run (distinct ids)', async () => {
    const { bridge, emitted } = makeBridge();
    const p1 = bridge.requestUserInput('run-1')({ questions: QUESTIONS });
    const p2 = bridge.requestUserInput('run-1')({ questions: QUESTIONS });
    expect(emitted.map((e) => e.questionId)).toEqual(['q1', 'q2']);

    bridge.resolveAnswer('q2', ANSWER);
    await expect(p2).resolves.toEqual(ANSWER);
    expect(bridge.size()).toBe(1); // q1 still open
    bridge.abandonRun('run-1');
    await expect(p1).resolves.toEqual({ answers: [], declined: true });
  });
});
