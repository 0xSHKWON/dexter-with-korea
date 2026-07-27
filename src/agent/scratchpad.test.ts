import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Scratchpad } from './scratchpad.js';

// Scratchpad persists JSONL files under dexterPath('scratchpad');
// point DEXTER_DIR at a temp dir so tests never touch the real .dexter/.
let tmpDir: string;
let prevDexterDir: string | undefined;

beforeAll(() => {
  prevDexterDir = process.env.DEXTER_DIR;
  tmpDir = mkdtempSync(join(tmpdir(), 'scratchpad-test-'));
  process.env.DEXTER_DIR = tmpDir;
});

afterAll(() => {
  if (prevDexterDir === undefined) {
    delete process.env.DEXTER_DIR;
  } else {
    process.env.DEXTER_DIR = prevDexterDir;
  }
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('Scratchpad query similarity detection', () => {
  describe('Korean queries', () => {
    it('detects near-identical Korean queries — 2-char Hangul words (삼성, 배당) survive tokenization', () => {
      const pad = new Scratchpad('삼성 배당 리서치');
      pad.recordToolCall('web_search', '삼성 배당 얼마?');
      const check = pad.canCallTool('web_search', '삼성 배당 얼마!');
      expect(check.allowed).toBe(true);
      expect(check.warning).toContain('very similar to a previous');
    });

    it('detects similar Korean queries above the default threshold', () => {
      const pad = new Scratchpad('삼성전자 배당 리서치');
      pad.recordToolCall('web_search', '삼성전자 배당 수익률 얼마야');
      // {삼성전자,배당,수익률,얼마야} vs +{알려줘} → Jaccard 4/5 = 0.8 ≥ 0.7
      const check = pad.canCallTool('web_search', '삼성전자 배당 수익률 얼마야 알려줘');
      expect(check.warning).toContain('very similar to a previous');
    });

    it('scores Korean paraphrases > 0 (was 0 when Hangul tokenized to empty sets)', () => {
      // "삼성전자 배당 얼마야" vs "삼성전자 배당금 알려줘": Jaccard 1/5 = 0.2 — under the
      // old ASCII tokenizer both sides were empty and similarity was permanently 0.
      const pad = new Scratchpad('삼성전자 배당 리서치 저임계', { similarityThreshold: 0.2 });
      pad.recordToolCall('web_search', '삼성전자 배당 얼마야');
      const check = pad.canCallTool('web_search', '삼성전자 배당금 알려줘');
      expect(check.warning).toContain('very similar to a previous');
    });

    it('does not flag unrelated Korean queries', () => {
      const pad = new Scratchpad('종목 리서치');
      pad.recordToolCall('web_search', '삼성전자 배당 얼마야');
      const check = pad.canCallTool('web_search', '현대차 수소 트럭 판매량');
      expect(check.allowed).toBe(true);
      expect(check.warning).toBeUndefined();
    });
  });

  describe('empty / punctuation-only queries', () => {
    it('returns 0 (not NaN) when both queries tokenize to nothing', () => {
      const pad = new Scratchpad('빈 쿼리 가드');
      const sim = pad['calculateSimilarity'](new Set<string>(), new Set<string>());
      expect(Number.isNaN(sim)).toBe(false);
      expect(sim).toBe(0);
    });

    it('does not warn or throw on punctuation-only queries', () => {
      const pad = new Scratchpad('특수문자 쿼리');
      pad.recordToolCall('web_search', '!!! ???');
      const check = pad.canCallTool('web_search', '??? !!!');
      expect(check.allowed).toBe(true);
      expect(check.warning).toBeUndefined();
    });
  });

  describe('English queries (regression)', () => {
    it('still detects similar English queries', () => {
      const pad = new Scratchpad('apple research');
      pad.recordToolCall('web_search', 'apple stock price today');
      // {apple,stock,price,today} vs +{please} → Jaccard 4/5 = 0.8 ≥ 0.7
      const check = pad.canCallTool('web_search', 'apple stock price today please');
      expect(check.warning).toContain('very similar to a previous');
    });

    it('still drops 1–2 char Latin words', () => {
      const pad = new Scratchpad('apple research short words');
      pad.recordToolCall('web_search', 'apple stock price is up');
      // is/up/of/it are filtered out; both reduce to {apple, stock, price} → 1.0
      const check = pad.canCallTool('web_search', 'apple stock price of it');
      expect(check.warning).toContain('very similar to a previous');
    });

    it('does not flag unrelated English queries', () => {
      const pad = new Scratchpad('apple vs tesla');
      pad.recordToolCall('web_search', 'apple stock price today');
      const check = pad.canCallTool('web_search', 'tesla delivery numbers 2026');
      expect(check.allowed).toBe(true);
      expect(check.warning).toBeUndefined();
    });
  });
});
