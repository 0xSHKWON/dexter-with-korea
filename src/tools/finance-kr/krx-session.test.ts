import { describe, it, expect } from 'bun:test';
import { cookieHeader, type KrxSession } from './krx-session.js';

const session = (pairs: [string, string][]): KrxSession => ({
  cookies: new Map(pairs),
  loginAt: 0,
});

describe('cookieHeader', () => {
  it('serializes the jar in insertion order', () => {
    expect(
      cookieHeader(
        session([
          ['JSESSIONID', 'abc123'],
          ['__smVisitorID', 'xyz'],
          ['mdc.client_session', 'true'],
        ]),
      ),
    ).toBe('JSESSIONID=abc123; __smVisitorID=xyz; mdc.client_session=true');
  });

  it('handles a single cookie', () => {
    expect(cookieHeader(session([['JSESSIONID', 'only']]))).toBe('JSESSIONID=only');
  });

  it('is empty for an empty jar', () => {
    expect(cookieHeader(session([]))).toBe('');
  });
});
