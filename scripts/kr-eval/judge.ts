// Per-dimension LLM judges. Mirrors src/evals/run.ts's correctnessEvaluator
// (callLlm + a Zod {score,comment} schema), but scores the KR-specific
// dimensions from the Korean playbook in src/agent/prompts.ts. The agent's own
// answer is what's under test; this is the judge for answer quality.

import { z } from 'zod';
import { callLlm } from '../../src/model/llm.js';
import type { DimensionId } from './questions.js';
import type { RawDimension } from './scorer.js';

export const DEFAULT_JUDGE_MODEL = 'gpt-5.5';

const DimensionScoreSchema = z.object({
  score: z.number().min(0).max(1),
  comment: z.string(),
});

const JUDGE_SYSTEM_PROMPT =
  'You are a meticulous equity-research reviewer scoring a Korean-stock research ' +
  'answer on ONE dimension. Be strict and concrete. Output a score in [0,1] and a ' +
  'one-sentence comment citing specific evidence (or its absence) from the answer.';

/** What each dimension rewards. Grounded in src/agent/prompts.ts (Korean playbook). */
const DIMENSION_RUBRICS: Record<DimensionId, string> = {
  earnings_yoy:
    'DIMENSION = 실적(손익) with YoY. Reward the answer ONLY if it states revenue (매출), ' +
    '영업이익, 순이익, margins, or ROE with concrete numbers AND a year-over-year (YoY / 전년대비 / ' +
    '전년동기) comparison, grounded in the financial figures the tools returned. Score 1.0 for dated, ' +
    'numeric YoY figures; ~0.5 if numbers but no YoY (or vice-versa); 0 if vague or missing.',
  cross_signal:
    'DIMENSION = 교차신호 종합 (cross-signal synthesis). Reward the answer ONLY if it weaves 수급' +
    '(외국인·공매도·기관 방향) · 실적(매출/이익/마진/ROE) · 지배구조(대량보유·계열 지분) into ONE integrated ' +
    'investment thesis where the signals are explicitly cross-referenced (do they agree or conflict?) ' +
    'and it ends with an evidence-anchored verdict and specific triggers. Score low for three ' +
    'disconnected bullet lists with no synthesis, even if each bullet is individually correct.',
  governance:
    'DIMENSION = 지배구조 (governance) as a valuation factor. Reward the answer if it treats 대량보유/' +
    '계열 지분/물적분할·인적분할 as valuation-relevant (순환출자, 승계, 지주사 할인, 소액주주 영향, 더블카운팅) ' +
    'rather than a throwaway footnote. Score 0 if governance is ignored or merely name-dropped.',
  grounding:
    'DIMENSION = grounding / no-hallucination. Reward the answer if its specific figures, dates, and ' +
    'claims are supported by (or directly derivable from) the TOOL RESULTS below. Penalize any number, ' +
    'name, or fact that does not appear in the tool data. NOTE: YoY %s computed from two reported ' +
    'figures are legitimately derived and acceptable. Score 1.0 if fully grounded; drop sharply for ' +
    'each unsupported quantitative claim.',
};

const preview = (s: string, n = 1500): string =>
  s.length > n ? s.slice(0, n).replace(/\s+/g, ' ') + ` …[${s.length} chars]` : s.replace(/\s+/g, ' ');

/**
 * Compact, token-bounded digest of the tool results for the judge to ground against.
 * The budget is split EVENLY across calls (not greedy first-fit) so a later tool's
 * data is never dropped wholesale — every tool the agent used is represented, which
 * matters for grounding/cross_signal judging of multi-tool answers.
 */
export function toolDigest(
  toolCalls: ReadonlyArray<{ tool: string; args: Record<string, unknown>; result: string }>,
  maxTotal = 12000,
): string {
  if (toolCalls.length === 0) return '(no tools were called)';
  const perCall = Math.max(400, Math.floor(maxTotal / toolCalls.length));
  return toolCalls
    .map((c) => `### ${c.tool}(${preview(JSON.stringify(c.args), 200)})\n${preview(c.result, perCall)}`)
    .join('\n\n');
}

export async function judgeDimension(
  dimension: DimensionId,
  args: { question: string; answer: string; digest: string; model: string },
): Promise<RawDimension> {
  const prompt = `${DIMENSION_RUBRICS[dimension]}

QUESTION (Korean):
${args.question}

ANSWER UNDER TEST:
${args.answer}

TOOL RESULTS (what the agent saw):
${args.digest}

Score this single dimension now.`;

  try {
    const res = await callLlm(prompt, {
      model: args.model,
      systemPrompt: JUDGE_SYSTEM_PROMPT,
      outputSchema: DimensionScoreSchema,
    });
    // With outputSchema, callLlm returns the parsed structured object as `response`
    // (typed loosely as AIMessage|string upstream). Re-parse to validate at runtime —
    // same pattern as src/tools/finance/screen-stocks.ts; a bad shape lands in catch.
    const parsed = DimensionScoreSchema.parse(res.response);
    return { id: dimension, score: parsed.score, comment: parsed.comment };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { id: dimension, score: 0, comment: `judge error: ${message}` };
  }
}

/** Score every dimension applicable to a question (concurrently). */
export async function judgeAll(args: {
  dimensions: DimensionId[];
  question: string;
  answer: string;
  toolCalls: ReadonlyArray<{ tool: string; args: Record<string, unknown>; result: string }>;
  model: string;
}): Promise<RawDimension[]> {
  const digest = toolDigest(args.toolCalls);
  return Promise.all(
    args.dimensions.map((d) =>
      judgeDimension(d, { question: args.question, answer: args.answer, digest, model: args.model }),
    ),
  );
}
