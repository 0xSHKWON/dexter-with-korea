import { describe, it, expect } from 'bun:test';
import type { KrEvalQuestion } from './questions.js';
import {
  aggregate,
  buildQuestionResult,
  DEFAULT_THRESHOLD,
  firedToolNames,
  scoreTools,
  skippedResult,
  type RawDimension,
} from './scorer.js';

const baseQ: KrEvalQuestion = {
  id: 'q1',
  query: '삼성전자 어때?',
  expectedTools: ['get_financials_kr', 'get_foreign_ownership_kr'],
  requiredTools: ['get_financials_kr'],
  dimensions: ['earnings_yoy'],
};

describe('firedToolNames', () => {
  it('dedupes while preserving first-seen order', () => {
    const fired = firedToolNames([
      { tool: 'a' },
      { tool: 'b' },
      { tool: 'a' },
    ]);
    expect(fired).toEqual(['a', 'b']);
  });
});

describe('scoreTools', () => {
  it('full coverage → toolsScore 1, nothing missing', () => {
    const s = scoreTools(baseQ, ['get_financials_kr', 'get_foreign_ownership_kr']);
    expect(s.toolsScore).toBe(1);
    expect(s.missingExpected).toEqual([]);
    expect(s.missingRequired).toEqual([]);
  });

  it('partial coverage → fractional score; required still met', () => {
    const s = scoreTools(baseQ, ['get_financials_kr']);
    expect(s.toolsScore).toBe(0.5);
    expect(s.missingExpected).toEqual(['get_foreign_ownership_kr']);
    expect(s.missingRequired).toEqual([]);
  });

  it('required tool absent → reported as missingRequired', () => {
    const s = scoreTools(baseQ, ['get_foreign_ownership_kr']);
    expect(s.missingRequired).toEqual(['get_financials_kr']);
  });

  it('requiredTools defaults to expectedTools when omitted', () => {
    const q: KrEvalQuestion = { ...baseQ, requiredTools: undefined };
    const s = scoreTools(q, ['get_financials_kr']);
    expect(s.missingRequired).toEqual(['get_foreign_ownership_kr']);
  });
});

describe('buildQuestionResult', () => {
  const dims = (score: number): RawDimension[] => [
    { id: 'earnings_yoy', score, comment: 'c' },
  ];

  it('passes when required tools fired and every dimension clears threshold', () => {
    const r = buildQuestionResult({
      question: baseQ,
      firedTools: ['get_financials_kr', 'get_foreign_ownership_kr'],
      rawDimensions: dims(0.9),
    });
    expect(r.pass).toBe(true);
    expect(r.dimensions[0].pass).toBe(true);
  });

  it('hard-fails when a required tool is missing, regardless of judge score', () => {
    const r = buildQuestionResult({
      question: baseQ,
      firedTools: ['get_foreign_ownership_kr'],
      rawDimensions: dims(1),
    });
    expect(r.pass).toBe(false);
    expect(r.missingRequired).toEqual(['get_financials_kr']);
  });

  it('fails when a dimension is below threshold', () => {
    const r = buildQuestionResult({
      question: baseQ,
      firedTools: ['get_financials_kr', 'get_foreign_ownership_kr'],
      rawDimensions: dims(DEFAULT_THRESHOLD - 0.01),
    });
    expect(r.pass).toBe(false);
    expect(r.dimensions[0].pass).toBe(false);
  });

  it('honors a per-question threshold override', () => {
    const q: KrEvalQuestion = { ...baseQ, thresholds: { earnings_yoy: 0.5 } };
    const r = buildQuestionResult({
      question: q,
      firedTools: ['get_financials_kr', 'get_foreign_ownership_kr'],
      rawDimensions: dims(0.6),
    });
    expect(r.dimensions[0].pass).toBe(true);
    expect(r.pass).toBe(true);
  });
});

describe('aggregate', () => {
  it('counts passes/skips and computes per-dimension stats', () => {
    const passing = buildQuestionResult({
      question: baseQ,
      firedTools: ['get_financials_kr', 'get_foreign_ownership_kr'],
      rawDimensions: [{ id: 'earnings_yoy', score: 0.8, comment: 'c' }],
    });
    const failing = buildQuestionResult({
      question: { ...baseQ, id: 'q2' },
      firedTools: ['get_financials_kr', 'get_foreign_ownership_kr'],
      rawDimensions: [{ id: 'earnings_yoy', score: 0.2, comment: 'c' }],
    });
    const skipped = skippedResult({ ...baseQ, id: 'q3' }, 'n/a');

    const report = aggregate([passing, failing, skipped], {
      mode: 'replay',
      agentModel: 'm',
      judgeModel: 'j',
    });

    expect(report.ran).toBe(2);
    expect(report.passed).toBe(1);
    expect(report.skipped).toBe(1);
    expect(report.toolFireRate).toBe(1);
    expect(report.byDimension.earnings_yoy?.mean).toBeCloseTo(0.5, 5);
    expect(report.byDimension.earnings_yoy?.passRate).toBe(0.5);
  });
});
