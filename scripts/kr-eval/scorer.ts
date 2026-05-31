// Scoring: a deterministic tool-firing gate (pure, computed from the agent's
// tool calls) combined with per-dimension LLM-judge scores (judge.ts). Pure and
// side-effect-free so it's unit-testable without network or an LLM.

import type { DimensionId, KrEvalQuestion } from './questions.js';

export const DEFAULT_THRESHOLD = 0.7;

/** Raw judge output before thresholding (what judge.ts returns). */
export interface RawDimension {
  id: DimensionId;
  score: number;
  comment: string;
}

export interface DimensionResult extends RawDimension {
  pass: boolean;
}

export interface ToolsScore {
  firedTools: string[];
  missingExpected: string[];
  missingRequired: string[];
  toolsScore: number;
}

export interface QuestionResult {
  id: string;
  query: string;
  /** Set when the question's required tools aren't registered in this env. */
  skipped?: string;
  firedTools: string[];
  missingExpected: string[];
  missingRequired: string[];
  toolsScore: number;
  /** Tools the agent called in replay with no recorded output. */
  replayMisses: string[];
  dimensions: DimensionResult[];
  pass: boolean;
  /** Weighted blend for ranking/printing only — `pass` is the headline. */
  compositeScore: number;
}

/** The `requiredTools` for a question, defaulting to its full `expectedTools`. */
export function requiredTools(q: KrEvalQuestion): string[] {
  return q.requiredTools ?? q.expectedTools;
}

/** Distinct tool names from a list of tool calls, preserving first-seen order. */
export function firedToolNames(toolCalls: ReadonlyArray<{ tool: string }>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const { tool } of toolCalls) {
    if (!seen.has(tool)) {
      seen.add(tool);
      out.push(tool);
    }
  }
  return out;
}

export function scoreTools(q: KrEvalQuestion, firedTools: string[]): ToolsScore {
  const fired = new Set(firedTools);
  const missingExpected = q.expectedTools.filter((t) => !fired.has(t));
  const missingRequired = requiredTools(q).filter((t) => !fired.has(t));
  const toolsScore =
    q.expectedTools.length === 0
      ? 1
      : (q.expectedTools.length - missingExpected.length) / q.expectedTools.length;
  return { firedTools, missingExpected, missingRequired, toolsScore };
}

function thresholdFor(q: KrEvalQuestion, id: DimensionId): number {
  return q.thresholds?.[id] ?? DEFAULT_THRESHOLD;
}

function mean(nums: number[]): number {
  return nums.length === 0 ? 0 : nums.reduce((a, b) => a + b, 0) / nums.length;
}

export function buildQuestionResult(args: {
  question: KrEvalQuestion;
  firedTools: string[];
  rawDimensions: RawDimension[];
  replayMisses?: string[];
}): QuestionResult {
  const { question, firedTools, rawDimensions, replayMisses = [] } = args;
  const tools = scoreTools(question, firedTools);

  const dimensions: DimensionResult[] = rawDimensions.map((d) => ({
    ...d,
    pass: d.score >= thresholdFor(question, d.id),
  }));

  const dimsPass = dimensions.every((d) => d.pass);
  const pass = tools.missingRequired.length === 0 && dimsPass;

  const dimMean = mean(dimensions.map((d) => d.score));
  const compositeScore =
    dimensions.length === 0 ? tools.toolsScore : 0.6 * dimMean + 0.4 * tools.toolsScore;

  return {
    id: question.id,
    query: question.query,
    firedTools: tools.firedTools,
    missingExpected: tools.missingExpected,
    missingRequired: tools.missingRequired,
    toolsScore: tools.toolsScore,
    replayMisses,
    dimensions,
    pass,
    compositeScore,
  };
}

export function skippedResult(question: KrEvalQuestion, reason: string): QuestionResult {
  return {
    id: question.id,
    query: question.query,
    skipped: reason,
    firedTools: [],
    missingExpected: [],
    missingRequired: [],
    toolsScore: 0,
    replayMisses: [],
    dimensions: [],
    pass: false,
    compositeScore: 0,
  };
}

export interface AggregateReport {
  ran: number;
  passed: number;
  skipped: number;
  byDimension: Partial<Record<DimensionId, { mean: number; passRate: number }>>;
  toolFireRate: number;
  results: QuestionResult[];
  meta: { mode: string; agentModel: string; judgeModel: string };
}

export function aggregate(
  results: QuestionResult[],
  meta: AggregateReport['meta'],
): AggregateReport {
  const active = results.filter((r) => !r.skipped);
  const skipped = results.length - active.length;

  const byDimension: AggregateReport['byDimension'] = {};
  const dimIds = new Set<DimensionId>();
  for (const r of active) for (const d of r.dimensions) dimIds.add(d.id);
  for (const id of dimIds) {
    const dims = active.flatMap((r) => r.dimensions.filter((d) => d.id === id));
    byDimension[id] = {
      mean: mean(dims.map((d) => d.score)),
      passRate: dims.length === 0 ? 0 : dims.filter((d) => d.pass).length / dims.length,
    };
  }

  return {
    ran: active.length,
    passed: active.filter((r) => r.pass).length,
    skipped,
    byDimension,
    toolFireRate: mean(active.map((r) => r.toolsScore)),
    results,
    meta,
  };
}
