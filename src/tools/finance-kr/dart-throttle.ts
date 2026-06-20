/**
 * Shared throttle + daily-quota circuit-breaker for every OpenDART call.
 *
 * Why this exists: get_business_report_kr fans out over years (Promise.all),
 * get_financials_kr fans out over routed sub-tool calls (Promise.all again), and
 * the agent runs the concurrency-safe KR DART tools in parallel. Multiplied
 * together, a single "이 종목 분석해줘" sweep can fire dozens of DART requests at
 * once — wasteful against the free key's 20,000/day quota and prone to transient
 * 020 사용한도초과. So we:
 *   1. Bound the number of in-flight DART requests (a counting semaphore), and
 *   2. Latch a circuit-breaker on the first 020 so the rest of a burst fails fast
 *      with a clear message instead of each doing a doomed round-trip.
 *
 * Retrying with backoff would NOT help: 020 is a daily cap, not a per-second rate
 * limit, so the right response is throttle + a quota-aware error, not retry.
 */

const DEFAULT_MAX_CONCURRENCY = 4;
/** How long to keep the breaker latched after a 020 before probing again. */
export const QUOTA_COOLDOWN_MS = 5 * 60_000;

function readCap(): number {
  const raw = Number(process.env.DART_MAX_CONCURRENCY);
  return Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : DEFAULT_MAX_CONCURRENCY;
}

let maxConcurrency = readCap();
let active = 0;
const queue: Array<() => void> = [];

/**
 * Free a held slot: hand it straight to the next waiter (count unchanged so the
 * cap is conserved), or drop the count when none waits. The `active > 0` floor is
 * defensive — with single-use releasers it can't be hit, but it guarantees the
 * count can never go negative (and thus never over-admit) even under misuse.
 */
function releaseSlot(): void {
  const next = queue.shift();
  if (next) next();
  else if (active > 0) active--;
}

/** Acquire a slot, resolving to its SINGLE-USE releaser (extra calls are no-ops). */
export function acquireDartSlot(): Promise<() => void> {
  const makeReleaser = (): (() => void) => {
    let released = false;
    return () => {
      if (released) return; // idempotent — double-release can't corrupt the count
      released = true;
      releaseSlot();
    };
  };
  if (active < maxConcurrency) {
    active++;
    return Promise.resolve(makeReleaser());
  }
  return new Promise<() => void>((resolve) => {
    queue.push(() => resolve(makeReleaser()));
  });
}

/** Run `fn` holding one of the bounded DART request slots. */
export async function runWithDartSlot<T>(fn: () => Promise<T>): Promise<T> {
  const release = await acquireDartSlot();
  try {
    return await fn();
  } finally {
    release();
  }
}

let quotaExhaustedUntil = 0;

export function isQuotaLatched(now: number = Date.now()): boolean {
  return quotaExhaustedUntil > now;
}

/** Latch the breaker after a 020 사용한도초과; it lifts after QUOTA_COOLDOWN_MS. */
export function tripQuotaLatch(now: number = Date.now()): void {
  quotaExhaustedUntil = now + QUOTA_COOLDOWN_MS;
}

export const QUOTA_EXHAUSTED_MESSAGE =
  'DART 일일 사용한도 초과(020). 무료 키는 일 20,000건 한도이며 자정(KST) 이후 리셋됩니다 — 잠시 후 재시도하세요.';

/** Throw a clear quota error (no network call) while the breaker is latched. */
export function assertNotQuotaLatched(label: string): void {
  if (isQuotaLatched()) {
    throw new Error(`[DART API] ${label} — ${QUOTA_EXHAUSTED_MESSAGE}`);
  }
}

/** Test seam: reset throttle + latch and re-read the cap from env. */
export function resetDartThrottle(): void {
  maxConcurrency = readCap();
  active = 0;
  queue.length = 0;
  quotaExhaustedUntil = 0;
}

/** Test seam: current in-flight DART request count. */
export function activeDartRequests(): number {
  return active;
}
