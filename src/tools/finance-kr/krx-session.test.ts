import { describe, it, expect } from 'bun:test';
import { sessionFromCookie, cookieHeader } from './krx-session.js';

describe('sessionFromCookie', () => {
  it('parses a Cookie header into a jar and round-trips via cookieHeader', () => {
    const session = sessionFromCookie('JSESSIONID=abc123; __smVisitorID=xyz; mdc.client_session=true');
    expect(session.cookies.get('JSESSIONID')).toBe('abc123');
    expect(session.cookies.get('__smVisitorID')).toBe('xyz');
    expect(session.cookies.get('mdc.client_session')).toBe('true');
    expect(cookieHeader(session)).toBe('JSESSIONID=abc123; __smVisitorID=xyz; mdc.client_session=true');
  });

  it('tolerates a single cookie and stray whitespace', () => {
    const session = sessionFromCookie('  JSESSIONID=only  ');
    expect(session.cookies.get('JSESSIONID')).toBe('only');
  });

  it('skips malformed segments without a value', () => {
    const session = sessionFromCookie('JSESSIONID=ok; garbage; =novalue');
    expect(session.cookies.get('JSESSIONID')).toBe('ok');
    expect(session.cookies.size).toBe(1);
  });
});
