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

describe('get_short_balance_kr registration (KRX gate)', () => {
  const KRX_VARS = ['KRX_ID', 'KRX_PW', 'KRX_COOKIE'] as const;
  const original = Object.fromEntries(KRX_VARS.map((v) => [v, process.env[v]]));
  const restore = (v: string, value: string | undefined) => {
    if (value === undefined) delete process.env[v];
    else process.env[v] = value;
  };
  afterEach(() => {
    for (const v of KRX_VARS) restore(v, original[v]);
  });
  const clear = () => {
    for (const v of KRX_VARS) delete process.env[v];
  };
  const registered = () => getToolRegistry('gpt-5.5').map((t) => t.name).includes('get_short_balance_kr');

  it('is registered with a native ID/PW', () => {
    clear();
    process.env.KRX_ID = 'id';
    process.env.KRX_PW = 'pw';
    expect(registered()).toBe(true);
  });

  // Pasting a session cookie out of DevTools asks more of a user than signing up
  // for a native account, and it expires silently — the path was dropped.
  it('ignores a pasted session cookie', () => {
    clear();
    process.env.KRX_COOKIE = 'JSESSIONID=abc';
    expect(registered()).toBe(false);
  });

  it('is absent without credentials, and for `your-` placeholders', () => {
    clear();
    expect(registered()).toBe(false);
    process.env.KRX_ID = 'your-krx-id';
    process.env.KRX_PW = 'your-krx-password';
    expect(registered()).toBe(false);
  });
});
