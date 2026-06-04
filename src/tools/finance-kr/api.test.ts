import { describe, it, expect, afterEach } from 'bun:test';
import { assertDartOk } from './api.js';
import { isQuotaLatched, resetDartThrottle } from './dart-throttle.js';

afterEach(() => resetDartThrottle());

describe('assertDartOk', () => {
  it('passes on status 000 without latching', () => {
    resetDartThrottle();
    expect(() => assertDartOk('ok', { status: '000', message: '정상' })).not.toThrow();
    expect(isQuotaLatched()).toBe(false);
  });

  it('passes when there is no status field (data payload)', () => {
    resetDartThrottle();
    expect(() => assertDartOk('list', { list: [{ a: 1 }] })).not.toThrow();
  });

  it('throws on 013 (no data) but does NOT latch the quota breaker', () => {
    resetDartThrottle();
    expect(() => assertDartOk('nodata', { status: '013', message: '조회된 데이타가 없습니다.' })).toThrow(/013/);
    expect(isQuotaLatched()).toBe(false);
  });

  it('throws a quota-specific error AND latches on 020 사용한도초과', () => {
    resetDartThrottle();
    expect(() =>
      assertDartOk('quota', { status: '020', message: '사용한도를 초과하였습니다.' }),
    ).toThrow(/사용한도 초과/);
    expect(isQuotaLatched()).toBe(true);
  });
});
