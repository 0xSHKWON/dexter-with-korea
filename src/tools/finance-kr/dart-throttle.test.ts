import { describe, it, expect, afterEach } from 'bun:test';
import {
  runWithDartSlot,
  acquireDartSlot,
  activeDartRequests,
  resetDartThrottle,
  isQuotaLatched,
  tripQuotaLatch,
  assertNotQuotaLatched,
  QUOTA_COOLDOWN_MS,
} from './dart-throttle.js';

const flush = () => new Promise((r) => setTimeout(r, 0));

afterEach(() => {
  delete process.env.DART_MAX_CONCURRENCY;
  resetDartThrottle();
});

describe('runWithDartSlot concurrency cap', () => {
  it('reaches but never exceeds the cap, and runs every task', async () => {
    process.env.DART_MAX_CONCURRENCY = '3';
    resetDartThrottle();
    let inFlight = 0;
    let peak = 0;
    let done = 0;
    const task = () =>
      runWithDartSlot(async () => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 5));
        inFlight--;
        done++;
      });
    await Promise.all(Array.from({ length: 20 }, task));
    expect(peak).toBe(3); // parallel up to the cap…
    expect(done).toBe(20); // …and nothing dropped
    expect(activeDartRequests()).toBe(0); // all slots released
  });

  it('blocks callers past the cap; one release admits exactly one waiter (no timer magic)', async () => {
    process.env.DART_MAX_CONCURRENCY = '2';
    resetDartThrottle();
    let started = 0;
    const resolvers: Array<() => void> = [];
    const block = () => new Promise<void>((res) => { started++; resolvers.push(res); });
    const tasks = Array.from({ length: 4 }, () => runWithDartSlot(block));

    await flush();
    expect(started).toBe(2); // only the cap is admitted…
    expect(activeDartRequests()).toBe(2); // …the other two are genuinely gated

    resolvers.shift()!(); // free exactly one slot
    await flush();
    expect(started).toBe(3); // exactly one queued task admitted (one-for-one handoff)
    expect(activeDartRequests()).toBe(2);

    while (resolvers.length || activeDartRequests() > 0) {
      resolvers.shift()?.();
      await flush();
    }
    await Promise.all(tasks);
    expect(activeDartRequests()).toBe(0);
  });

  it('releases the slot even when the task throws', async () => {
    process.env.DART_MAX_CONCURRENCY = '1';
    resetDartThrottle();
    await expect(
      runWithDartSlot(async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(activeDartRequests()).toBe(0);
    let ran = false;
    await runWithDartSlot(async () => {
      ran = true;
    });
    expect(ran).toBe(true); // the released slot is reusable
  });

  it('a releaser is single-use — a double call cannot drive the count negative or over-admit', async () => {
    process.env.DART_MAX_CONCURRENCY = '1';
    resetDartThrottle();
    const release = await acquireDartSlot();
    expect(activeDartRequests()).toBe(1);
    release();
    expect(activeDartRequests()).toBe(0);
    release(); // extra call — must be a no-op
    expect(activeDartRequests()).toBe(0); // not -1

    let inFlight = 0;
    let peak = 0;
    await Promise.all(
      Array.from({ length: 4 }, () =>
        runWithDartSlot(async () => {
          inFlight++;
          peak = Math.max(peak, inFlight);
          await flush();
          inFlight--;
        }),
      ),
    );
    expect(peak).toBe(1); // would exceed 1 if the double-release had corrupted the count
  });
});

describe('quota circuit-breaker', () => {
  it('lifts exactly at the cooldown boundary (exclusive) and re-trips half-open', () => {
    resetDartThrottle();
    expect(isQuotaLatched(1000)).toBe(false);
    tripQuotaLatch(1000);
    expect(isQuotaLatched(1000 + QUOTA_COOLDOWN_MS - 1)).toBe(true);
    expect(isQuotaLatched(1000 + QUOTA_COOLDOWN_MS)).toBe(false); // boundary: lifted
    tripQuotaLatch(1000 + QUOTA_COOLDOWN_MS); // a probe 020s again → re-latch
    expect(isQuotaLatched(1000 + QUOTA_COOLDOWN_MS + 1)).toBe(true); // window re-extended
  });

  it('assertNotQuotaLatched throws a quota-specific error only while latched', () => {
    resetDartThrottle();
    expect(() => assertNotQuotaLatched('x')).not.toThrow();
    tripQuotaLatch();
    expect(() => assertNotQuotaLatched('list.json')).toThrow(/사용한도 초과/);
    resetDartThrottle();
    expect(() => assertNotQuotaLatched('x')).not.toThrow();
  });

  it('a caller queued behind a sibling fails fast once the sibling trips the 020 latch', async () => {
    process.env.DART_MAX_CONCURRENCY = '1';
    resetDartThrottle();
    let releaseT1!: () => void;
    const t1 = runWithDartSlot(() => new Promise<void>((res) => { releaseT1 = res; }));
    // t2 queues behind t1 and re-checks the latch after it finally gets a slot (as api.ts does).
    const t2 = runWithDartSlot(async () => {
      assertNotQuotaLatched('queued');
    });
    await flush();
    expect(activeDartRequests()).toBe(1); // t1 holds the only slot, t2 is queued

    tripQuotaLatch(); // a sibling 020s while t2 is still waiting
    releaseT1(); // free the slot → t2 acquires, re-checks, and fails fast
    await t1;
    await expect(t2).rejects.toThrow(/사용한도/);
  });
});
