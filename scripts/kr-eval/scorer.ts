// Scoring: a deterministic tool-firing gate (pure, computed from the agent's
// tool calls) combined with per-dimension LLM-judge scores (judge.ts). Pure and
// side-effect-free so it's unit-testable without network or an LLM.

import type { DimensionId, KrEvalQuestion, NumericAnchor } from './questions.js';

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
  /**
   * Set when replay wasn't faithful — the live agent called tool(s) with no
   * recorded output (replayMisses). The score isn't comparable, so the result is
   * excluded from pass/fail rather than counted as a regression.
   */
  inconclusive?: string;
  firedTools: string[];
  missingExpected: string[];
  missingRequired: string[];
  toolsScore: number;
  /** Tools the agent called in replay with no recorded output. */
  replayMisses: string[];
  /** requiredPhrases that did NOT appear in the answer (hard gate). */
  phraseMisses: string[];
  /** numericAnchors whose value the answer did NOT state within tolerance (hard gate). */
  numericMisses: string[];
  dimensions: DimensionResult[];
  pass: boolean;
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

// --- Deterministic accuracy gates (pure; complement the LLM judge) -----------

/** Substrings that must appear in the answer (whitespace- and case-insensitive). */
export function checkRequiredPhrases(answer: string, phrases: string[] = []): string[] {
  const norm = (s: string) => s.replace(/\s+/g, '').toLowerCase();
  const a = norm(answer);
  return phrases.filter((p) => !a.includes(norm(p)));
}

/** Parse KRW magnitudes mentioned in prose ("133.9조", "57조 2,000억", "1,234억") → 원. */
export function extractKrwAmounts(text: string): number[] {
  const out: number[] = [];
  const num = (s: string) => parseFloat(s.replace(/,/g, ''));
  // 조 (optionally followed by 억) — captures "133.9조", "57조 2,000억".
  for (const m of text.matchAll(/(\d[\d,]*(?:\.\d+)?)\s*조(?:\s*(\d[\d,]*(?:\.\d+)?)\s*억)?/g)) {
    out.push(num(m[1]) * 1e12 + (m[2] ? num(m[2]) * 1e8 : 0));
  }
  // standalone 억 (also re-matches the 억 inside a 조-억 phrase — harmless extra candidate).
  for (const m of text.matchAll(/(\d[\d,]*(?:\.\d+)?)\s*억/g)) out.push(num(m[1]) * 1e8);
  return out;
}

/** Percentages stated in the answer ("39.3%", "-2%"). */
export function extractPercents(text: string): number[] {
  return [...text.matchAll(/(-?\d+(?:\.\d+)?)\s*%/g)].map((m) => parseFloat(m[1]));
}

/** Comma-grouped integers not carrying a 조/억/만/% unit (e.g. raw share counts). */
export function extractPlainNumbers(text: string): number[] {
  return [...text.matchAll(/(\d{1,3}(?:,\d{3})+)(?!\s*[조억만%])/g)].map((m) => parseFloat(m[1].replace(/,/g, '')));
}

/** numericAnchors whose value is NOT stated in the answer within tolerance. */
export function checkNumericAnchors(answer: string, anchors: NumericAnchor[] = []): string[] {
  const krw = extractKrwAmounts(answer);
  const pct = extractPercents(answer);
  const plain = extractPlainNumbers(answer);
  const misses: string[] = [];
  for (const a of anchors) {
    const tol = a.tolerancePct ?? (a.unit === 'pct' ? 1 : 5);
    let hit: boolean;
    if (a.unit === 'pct') {
      hit = pct.some((v) => Math.abs(v - a.value) <= tol); // tol = absolute percentage-points
    } else {
      const pool = a.unit === 'count' ? plain : krw;
      hit = a.value !== 0 && pool.some((v) => Math.abs(v - a.value) / Math.abs(a.value) <= tol / 100);
    }
    if (!hit) misses.push(`${a.label}(${a.value}${a.unit === 'pct' ? '%' : ''})`);
  }
  return misses;
}

function mean(nums: number[]): number {
  return nums.length === 0 ? 0 : nums.reduce((a, b) => a + b, 0) / nums.length;
}

export function buildQuestionResult(args: {
  question: KrEvalQuestion;
  firedTools: string[];
  rawDimensions: RawDimension[];
  replayMisses?: string[];
  /** The agent's final answer — needed for the requiredPhrases / numericAnchors gates. */
  answer?: string;
}): QuestionResult {
  const { question, firedTools, rawDimensions, replayMisses = [], answer = '' } = args;
  const tools = scoreTools(question, firedTools);

  const dimensions: DimensionResult[] = rawDimensions.map((d) => ({
    ...d,
    pass: d.score >= thresholdFor(question, d.id),
  }));

  const phraseMisses = checkRequiredPhrases(answer, question.requiredPhrases);
  const numericMisses = checkNumericAnchors(answer, question.numericAnchors);

  const dimsPass = dimensions.every((d) => d.pass);
  const pass =
    tools.missingRequired.length === 0 && dimsPass && phraseMisses.length === 0 && numericMisses.length === 0;

  // A replay with uncovered tool calls didn't fully pin the data → the score is
  // not comparable. Flag inconclusive so it's excluded from pass/fail counts.
  const uncovered = [...new Set(replayMisses)];
  const inconclusive =
    uncovered.length > 0 ? `replay not faithful — uncovered tool calls: ${uncovered.join(', ')}` : undefined;

  return {
    id: question.id,
    query: question.query,
    inconclusive,
    firedTools: tools.firedTools,
    missingExpected: tools.missingExpected,
    missingRequired: tools.missingRequired,
    toolsScore: tools.toolsScore,
    replayMisses,
    phraseMisses,
    numericMisses,
    dimensions,
    pass,
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
    phraseMisses: [],
    numericMisses: [],
    dimensions: [],
    pass: false,
  };
}

export interface AggregateReport {
  ran: number;
  passed: number;
  skipped: number;
  inconclusive: number;
  byDimension: Partial<Record<DimensionId, { mean: number; passRate: number }>>;
  toolFireRate: number;
  results: QuestionResult[];
  meta: { mode: string; agentModel: string; judgeModel: string };
}

export function aggregate(
  results: QuestionResult[],
  meta: AggregateReport['meta'],
): AggregateReport {
  // "active" = scored runs: not skipped (couldn't run) and not inconclusive
  // (replay wasn't faithful). Both are excluded from pass/fail and dim stats.
  const active = results.filter((r) => !r.skipped && !r.inconclusive);
  const skipped = results.filter((r) => r.skipped).length;
  const inconclusive = results.filter((r) => !r.skipped && r.inconclusive).length;

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
    inconclusive,
    byDimension,
    toolFireRate: mean(active.map((r) => r.toolsScore)),
    results,
    meta,
  };
}
