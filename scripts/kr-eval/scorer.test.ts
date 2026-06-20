import { describe, it, expect } from 'bun:test';
import type { KrEvalQuestion } from './questions.js';
import {
  aggregate,
  buildQuestionResult,
  checkNumericAnchors,
  checkRequiredPhrases,
  DEFAULT_THRESHOLD,
  extractKrwAmounts,
  extractPercents,
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

  it('marks the result inconclusive when replay had uncovered tool calls', () => {
    const r = buildQuestionResult({
      question: baseQ,
      firedTools: ['get_financials_kr', 'get_foreign_ownership_kr'],
      rawDimensions: dims(1),
      replayMisses: ['read_file', 'read_file'],
    });
    expect(r.inconclusive).toContain('read_file');
    // dedupes the uncovered tool names in the reason
    expect(r.inconclusive?.match(/read_file/g)?.length).toBe(1);
  });
});

describe('checkRequiredPhrases', () => {
  it('passes when all phrases appear (whitespace/case-insensitive)', () => {
    expect(checkRequiredPhrases('DX 부문과 D S 부문이 …', ['DX', 'DS'])).toEqual([]);
  });
  it('reports the phrases that are missing', () => {
    expect(checkRequiredPhrases('DX 부문만 언급', ['DX', 'DS'])).toEqual(['DS']);
  });
  it('no phrases → no misses', () => {
    expect(checkRequiredPhrases('아무말', [])).toEqual([]);
  });
});

describe('extractKrwAmounts / extractPercents', () => {
  it('parses 조 / 조-억 / 억 magnitudes to 원', () => {
    expect(extractKrwAmounts('매출 133.9조')).toContain(133.9e12);
    expect(extractKrwAmounts('57조 2,000억')).toContain(57e12 + 2000e8);
    expect(extractKrwAmounts('1,234억')).toContain(1234e8);
  });
  it('parses percentages including negatives', () => {
    expect(extractPercents('영업이익률 39.3%, 전년 -2%')).toEqual([39.3, -2]);
  });
});

describe('checkNumericAnchors', () => {
  it('passes when a stated 조 figure is within relative tolerance', () => {
    const miss = checkNumericAnchors('매출은 133.9조, 영업이익 57.2조였다.', [
      { label: '매출', value: 133.9e12, unit: 'krw', tolerancePct: 3 },
      { label: '영업이익', value: 57.2e12, unit: 'krw', tolerancePct: 5 },
    ]);
    expect(miss).toEqual([]);
  });
  it('flags a plausible-but-wrong figure the judge might miss', () => {
    const miss = checkNumericAnchors('매출은 90조였다.', [
      { label: '매출', value: 133.9e12, unit: 'krw', tolerancePct: 3 },
    ]);
    expect(miss).toEqual(['매출(133900000000000)']);
  });
  it('pct unit uses absolute percentage-point tolerance', () => {
    expect(checkNumericAnchors('외국인 지분율 50.4%', [{ label: '외인', value: 50, unit: 'pct', tolerancePct: 1 }])).toEqual([]);
    expect(checkNumericAnchors('외국인 지분율 40%', [{ label: '외인', value: 50, unit: 'pct', tolerancePct: 1 }])).toEqual(['외인(50%)']);
  });
});

describe('buildQuestionResult — accuracy gates', () => {
  const q: KrEvalQuestion = {
    ...baseQ,
    requiredTools: [],
    expectedTools: [],
    requiredPhrases: ['고려아연'],
    numericAnchors: [{ label: '매출', value: 133.9e12, unit: 'krw', tolerancePct: 3 }],
  };
  const dims = (s: number): RawDimension[] => [{ id: 'earnings_yoy', score: s, comment: 'c' }];

  it('passes when phrases present and anchors hit', () => {
    const r = buildQuestionResult({ question: q, firedTools: [], rawDimensions: dims(0.9), answer: '고려아연 매출 133.9조' });
    expect(r.phraseMisses).toEqual([]);
    expect(r.numericMisses).toEqual([]);
    expect(r.pass).toBe(true);
  });
  it('hard-fails on a missing required phrase even with a top judge score', () => {
    const r = buildQuestionResult({ question: q, firedTools: [], rawDimensions: dims(1), answer: '엉뚱회사 매출 133.9조' });
    expect(r.phraseMisses).toEqual(['고려아연']);
    expect(r.pass).toBe(false);
  });
  it('hard-fails on a wrong number even with a top judge score', () => {
    const r = buildQuestionResult({ question: q, firedTools: [], rawDimensions: dims(1), answer: '고려아연 매출 90조' });
    expect(r.numericMisses.length).toBe(1);
    expect(r.pass).toBe(false);
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
    const inconclusive = buildQuestionResult({
      question: { ...baseQ, id: 'q4' },
      firedTools: ['get_financials_kr', 'get_foreign_ownership_kr'],
      rawDimensions: [{ id: 'earnings_yoy', score: 0.1, comment: 'c' }],
      replayMisses: ['read_file'],
    });

    const report = aggregate([passing, failing, skipped, inconclusive], {
      mode: 'replay',
      agentModel: 'm',
      judgeModel: 'j',
    });

    // inconclusive (q4) is excluded from ran/passed and from dimension stats,
    // so its low score doesn't drag the earnings_yoy mean below 0.5.
    expect(report.ran).toBe(2);
    expect(report.passed).toBe(1);
    expect(report.skipped).toBe(1);
    expect(report.inconclusive).toBe(1);
    expect(report.toolFireRate).toBe(1);
    expect(report.byDimension.earnings_yoy?.mean).toBeCloseTo(0.5, 5);
    expect(report.byDimension.earnings_yoy?.passRate).toBe(0.5);
  });
});
