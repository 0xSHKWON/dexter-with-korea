// KR eval harness entrypoint — runs the question bank through the REAL agent and
// scores each `done` event (tool-firing gate + LLM-judge dimensions).
//
//   bun run scripts/kr-eval/runner.ts                  # live (hits DART/KRX/Naver/...)
//   KR_EVAL_MODE=record bun run scripts/kr-eval/runner.ts   # live + write fixtures
//   KR_EVAL_MODE=replay bun run scripts/kr-eval/runner.ts   # replay recorded tool outputs
//
// Flags: --question <id>  --scenario <id>  --model <agent>  --judge-model <m>  --repeat N
// Agent model defaults to KR_RUNNER_MODEL (like the seed); judge to KR_EVAL_JUDGE_MODEL.
import { config } from 'dotenv';
config({ quiet: true });

import type { StructuredToolInterface } from '@langchain/core/tools';
import { Agent } from '../../src/agent/agent.js';
import { getToolRegistry } from '../../src/tools/registry.js';
import { KR_EVAL_QUESTIONS, type KrEvalQuestion } from './questions.js';
import { createReplayer, loadFixture, saveFixture } from './replay.js';
import { judgeAll } from './judge.js';
import { DEFAULT_JUDGE_MODEL } from './judge.js';
import {
  aggregate,
  buildQuestionResult,
  firedToolNames,
  requiredTools,
  skippedResult,
  type QuestionResult,
  type RawDimension,
} from './scorer.js';
import { printReport } from './report.js';

type Mode = 'live' | 'record' | 'replay';
type ToolCall = { tool: string; args: Record<string, unknown>; result: string };

interface RunCtx {
  mode: Mode;
  scenario: string;
  agentModel: string;
  judgeModel: string;
  repeat: number;
}

function getFlag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

/** In replay, set dummy KR keys (if absent) so env-gated tools still register. */
function ensureReplayEnv(): void {
  for (const key of ['DART_API_KEY', 'KRX_ID', 'KRX_PW', 'DATA_GO_KR_SERVICE_KEY']) {
    const v = process.env[key];
    if (!v || v.startsWith('your-')) process.env[key] = 'replay';
  }
}

async function runOnce(
  q: KrEvalQuestion,
  ctx: RunCtx,
): Promise<{ answer: string; toolCalls: ToolCall[]; replayMisses: string[] }> {
  let transformTools: ((tools: StructuredToolInterface[]) => StructuredToolInterface[]) | undefined;
  let misses: string[] = [];

  if (ctx.mode === 'replay') {
    const replayer = createReplayer(loadFixture(ctx.scenario, q.id));
    transformTools = replayer.transformTools;
    misses = replayer.misses;
  }

  const agent = await Agent.create({
    model: ctx.agentModel,
    channel: 'cli',
    memoryEnabled: false,
    maxIterations: 10,
    transformTools,
  });

  let answer = '';
  let toolCalls: ToolCall[] = [];
  for await (const ev of agent.run(q.query)) {
    if (ev.type === 'done') {
      answer = ev.answer;
      toolCalls = ev.toolCalls as ToolCall[];
    }
  }

  if (ctx.mode === 'record') {
    const file = saveFixture(ctx.scenario, {
      id: q.id,
      query: q.query,
      meta: { model: ctx.agentModel },
      toolCalls,
    });
    console.log(`  ↳ recorded ${toolCalls.length} tool calls → ${file}`);
  }

  return { answer, toolCalls, replayMisses: misses };
}

async function evaluateQuestion(q: KrEvalQuestion, ctx: RunCtx): Promise<QuestionResult> {
  const runs: { firedTools: string[]; rawDims: RawDimension[]; replayMisses: string[]; answer: string }[] = [];

  for (let i = 0; i < ctx.repeat; i++) {
    const { answer, toolCalls, replayMisses } = await runOnce(q, ctx);
    const rawDims = await judgeAll({
      dimensions: q.dimensions,
      question: q.query,
      answer,
      toolCalls,
      model: ctx.judgeModel,
    });
    runs.push({ firedTools: firedToolNames(toolCalls), rawDims, replayMisses, answer });
  }

  // Average judge scores across repeats. Tool-firing / replayMisses are taken from
  // the first run only; with repeat>1 they under-represent if runs diverge (N=1 default).
  const avgDims: RawDimension[] = q.dimensions.map((id) => {
    const scores = runs.map((r) => r.rawDims.find((d) => d.id === id)?.score ?? 0);
    const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
    const comment = runs[0].rawDims.find((d) => d.id === id)?.comment ?? '';
    return { id, score: avg, comment: ctx.repeat > 1 ? `[avg×${ctx.repeat}] ${comment}` : comment };
  });

  return buildQuestionResult({
    question: q,
    firedTools: runs[0].firedTools,
    rawDimensions: avgDims,
    replayMisses: runs[0].replayMisses,
    answer: runs[0].answer,
  });
}

async function main(): Promise<void> {
  const mode = (process.env.KR_EVAL_MODE as Mode) || 'live';
  const ctx: RunCtx = {
    mode,
    scenario: getFlag('scenario') ?? 'default',
    agentModel: getFlag('model') ?? process.env.KR_RUNNER_MODEL ?? 'gpt-5.5',
    judgeModel: getFlag('judge-model') ?? process.env.KR_EVAL_JUDGE_MODEL ?? DEFAULT_JUDGE_MODEL,
    repeat: Math.max(1, parseInt(getFlag('repeat') ?? '1', 10) || 1),
  };

  if (mode === 'replay') ensureReplayEnv();

  const only = getFlag('question');
  const questions = only ? KR_EVAL_QUESTIONS.filter((q) => q.id === only) : KR_EVAL_QUESTIONS;
  if (questions.length === 0) {
    console.error(only ? `No question with id "${only}".` : 'No questions defined.');
    process.exit(1);
  }

  const registered = new Set(getToolRegistry(ctx.agentModel).map((t) => t.name));

  console.log(
    `KR EVAL starting — mode=${ctx.mode} agent=${ctx.agentModel} judge=${ctx.judgeModel} ` +
      `questions=${questions.length} repeat=${ctx.repeat}`,
  );

  const results: QuestionResult[] = [];
  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    const missing = requiredTools(q).filter((t) => !registered.has(t));

    // Live/record can't run a question whose required tools aren't registered.
    if (mode !== 'replay' && missing.length > 0) {
      console.log(`\n▶ [${i + 1}/${questions.length}] ${q.id} — SKIP (needs ${missing.join(', ')})`);
      results.push(skippedResult(q, `n/a — requires ${missing.join(', ')} (not registered)`));
      continue;
    }

    console.log(`\n▶ [${i + 1}/${questions.length}] ${q.id}: ${q.query}`);
    try {
      results.push(await evaluateQuestion(q, ctx));
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.log(`  ↳ error: ${msg}`);
      results.push(skippedResult(q, `error: ${msg}`));
    }
  }

  const report = aggregate(results, {
    mode: ctx.mode,
    agentModel: ctx.agentModel,
    judgeModel: ctx.judgeModel,
  });
  printReport(report);

  // Non-zero exit when an active question failed — a CI/regression signal. record
  // mode is a capture action, so it always exits 0 regardless of rubric scores.
  const failed = report.ran > 0 && report.passed < report.ran;
  process.exit(ctx.mode !== 'record' && failed ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
