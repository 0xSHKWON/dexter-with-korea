import { describe, expect, it } from 'bun:test';
import { MAIN_PROMPTS, sampleMainPrompts } from './promptExamples';

describe('main prompt rotation', () => {
  it('draws four distinct prompts', () => {
    const prompts = sampleMainPrompts([], 4, () => 0.42);
    expect(prompts).toHaveLength(4);
    expect(new Set(prompts.map((item) => item.prompt)).size).toBe(4);
  });

  it('does not repeat a prompt from the immediately previous new chat', () => {
    const first = sampleMainPrompts([], 4, () => 0.2);
    const second = sampleMainPrompts(first, 4, () => 0.2);
    const firstTexts = new Set(first.map((item) => item.prompt));

    expect(second.every((item) => !firstTexts.has(item.prompt))).toBe(true);
  });

  it('keeps the catalog large enough for two non-overlapping screens', () => {
    expect(MAIN_PROMPTS.length).toBeGreaterThanOrEqual(8);
  });
});
