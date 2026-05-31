import { describe, it, expect } from 'bun:test';
import { toolDigest } from './judge.js';

describe('toolDigest', () => {
  it('returns a placeholder when no tools were called', () => {
    expect(toolDigest([])).toBe('(no tools were called)');
  });

  it('represents EVERY tool even when results exceed the budget', () => {
    // 4 tools, each result far larger than the per-call slice — none should be dropped.
    const calls = ['a', 'b', 'c', 'd'].map((t) => ({
      tool: `tool_${t}`,
      args: { ticker: '005930' },
      result: 'x'.repeat(10_000),
    }));
    const digest = toolDigest(calls, 4000);
    for (const t of ['tool_a', 'tool_b', 'tool_c', 'tool_d']) {
      expect(digest).toContain(`### ${t}(`);
    }
    // each oversized result is truncated (carries the …[N chars] marker)
    expect(digest).toContain('chars]');
  });

  it('does not truncate results that fit within the per-call budget', () => {
    const digest = toolDigest([{ tool: 'get_filings_kr', args: { ticker: '005380' }, result: '{"filings":3}' }]);
    expect(digest).toContain('{"filings":3}');
    expect(digest).not.toContain('chars]');
  });
});
