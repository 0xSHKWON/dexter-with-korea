import { describe, it, expect } from 'bun:test';
import { DynamicStructuredTool, type StructuredToolInterface } from '@langchain/core/tools';
import { z } from 'zod';
import { canonicalize, createReplayer, type QuestionFixture } from './replay.js';

describe('canonicalize', () => {
  it('is stable under key reordering', () => {
    expect(canonicalize({ a: 1, b: 2 })).toBe(canonicalize({ b: 2, a: 1 }));
  });

  it('sorts keys recursively', () => {
    expect(canonicalize({ x: { c: 1, a: 2 } })).toBe('{"x":{"a":2,"c":1}}');
  });

  it('treats undefined/empty args as {}', () => {
    const noArgs: unknown = undefined;
    expect(canonicalize(noArgs ?? {})).toBe('{}');
  });
});

// Two real-looking tools: one recorded (get_filings_kr), one not (get_short_balance_kr).
function realTools(): StructuredToolInterface[] {
  const schema = z.object({ ticker: z.string() });
  return [
    new DynamicStructuredTool({
      name: 'get_filings_kr',
      description: 'filings',
      schema,
      func: async () => 'LIVE_SHOULD_NOT_RUN',
    }),
    new DynamicStructuredTool({
      name: 'get_short_balance_kr',
      description: 'short',
      schema,
      func: async () => 'LIVE_SHOULD_NOT_RUN',
    }),
  ];
}

const fixture: QuestionFixture = {
  id: 't',
  query: 'q',
  toolCalls: [
    { tool: 'get_filings_kr', args: { ticker: '005930' }, result: 'RESULT_SAMSUNG' },
    { tool: 'get_filings_kr', args: { ticker: '000660' }, result: 'RESULT_HYNIX' },
  ],
};

describe('createReplayer', () => {
  it('returns the exact recorded result for matching args', async () => {
    const { transformTools } = createReplayer(fixture);
    const stubs = transformTools(realTools());
    const filings = stubs.find((t) => t.name === 'get_filings_kr')!;
    expect(await filings.invoke({ ticker: '000660' })).toBe('RESULT_HYNIX');
    expect(await filings.invoke({ ticker: '005930' })).toBe('RESULT_SAMSUNG');
  });

  it('falls back to the first recorded call when args do not match', async () => {
    const { transformTools } = createReplayer(fixture);
    const filings = transformTools(realTools()).find((t) => t.name === 'get_filings_kr')!;
    expect(await filings.invoke({ ticker: '999999' })).toBe('RESULT_SAMSUNG');
  });

  it('returns a _replay_miss sentinel and records the miss for unrecorded tools', async () => {
    const replayer = createReplayer(fixture);
    const short = replayer.transformTools(realTools()).find((t) => t.name === 'get_short_balance_kr')!;
    const out = await short.invoke({ ticker: '005930' });
    expect(JSON.parse(out as string)._replay_miss).toBe(true);
    expect(replayer.misses).toContain('get_short_balance_kr');
  });
});
