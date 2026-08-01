/**
 * Cases taken from real answers. `**...42.8%**로` and `**...71.5%**와` both shipped
 * to the window with the asterisks visible; a prompt rule telling the model to
 * write them differently did not hold, so the renderer normalizes instead.
 */
import { describe, expect, it } from 'bun:test';
import { normalizeKoreanBold } from './markdown.js';

describe('normalizeKoreanBold', () => {
  it('pulls a trailing particle inside a bold that ends in %', () => {
    expect(normalizeKoreanBold('최근 분기인 **2026년 1분기 영업이익률은 42.8%**로, 높았습니다.')).toBe(
      '최근 분기인 **2026년 1분기 영업이익률은 42.8%로**, 높았습니다.',
    );
    expect(normalizeKoreanBold('하이닉스의 **영업이익률 71.5%**와 ROE')).toBe(
      '하이닉스의 **영업이익률 71.5%와** ROE',
    );
    expect(normalizeKoreanBold('공시상 **반도체 부문 매출 100%**입니다')).toBe(
      '공시상 **반도체 부문 매출 100%입니다**',
    );
  });

  it('leaves spans that already parse untouched', () => {
    // Closing ** preceded by a letter: emphasis closes fine.
    const letterEnd = '핵심 변수는 **AI 서버 투자 지속성**입니다';
    // Followed by a space or punctuation: also fine.
    const spaced = '**영업이익률 71.5%** 와 ROE';
    const punctuated = '**삼성전자 ROE 10.4%**, 하이닉스 35.6%';
    for (const md of [letterEnd, spaced, punctuated]) {
      expect(normalizeKoreanBold(md)).toBe(md);
    }
  });

  it('does not swallow a whole clause or cross lines', () => {
    expect(normalizeKoreanBold('**42.8%**\n로 시작하는 줄')).toBe('**42.8%**\n로 시작하는 줄');
    // Only the adjacent Korean run moves, not the words after the space.
    expect(normalizeKoreanBold('**42.8%**로 크게 높았습니다')).toBe('**42.8%로** 크게 높았습니다');
  });

  it('is a no-op for text with no emphasis', () => {
    expect(normalizeKoreanBold('영업이익률은 42.8%로 높았습니다')).toBe('영업이익률은 42.8%로 높았습니다');
  });
});
