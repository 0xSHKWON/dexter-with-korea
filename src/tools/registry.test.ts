import { describe, it, expect, afterEach } from 'bun:test';
import { getToolRegistry } from './registry.js';

const KEY = 'DART_API_KEY';

describe('read_filings_kr registration (DART gate)', () => {
  const original = process.env[KEY];
  afterEach(() => {
    if (original === undefined) delete process.env[KEY];
    else process.env[KEY] = original;
  });

  it('is registered when DART_API_KEY is set', () => {
    process.env[KEY] = 'test-key';
    const names = getToolRegistry('gpt-5.5').map((t) => t.name);
    expect(names).toContain('read_filings_kr');
  });

  it('is absent when DART_API_KEY is missing', () => {
    delete process.env[KEY];
    const names = getToolRegistry('gpt-5.5').map((t) => t.name);
    expect(names).not.toContain('read_filings_kr');
  });

  it('is absent for a `your-` placeholder key', () => {
    process.env[KEY] = 'your-dart-key';
    const names = getToolRegistry('gpt-5.5').map((t) => t.name);
    expect(names).not.toContain('read_filings_kr');
  });
});
