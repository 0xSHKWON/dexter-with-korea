import { describe, it, expect } from 'bun:test';
import { isLogoutBody } from './krx-api.js';

describe('isLogoutBody', () => {
  it('detects the literal LOGOUT body (with surrounding whitespace)', () => {
    expect(isLogoutBody('LOGOUT')).toBe(true);
    expect(isLogoutBody('  LOGOUT\n')).toBe(true);
  });

  it('treats an HTML page (block/error) as not-authenticated', () => {
    expect(isLogoutBody('<!DOCTYPE html><html>...')).toBe(true);
  });

  it('returns false for a JSON payload', () => {
    expect(isLogoutBody('{"OutBlock_1":[]}')).toBe(false);
  });
});
