/**
 * Shared helpers for Korean (DART) disclosure tools.
 */

/** Convert an ISO `YYYY-MM-DD` date to DART's `YYYYMMDD` format. */
export function toDartDate(isoDate: string): string {
  return isoDate.replace(/-/g, '');
}

/**
 * Normalize the various Korean date shapes to ISO `YYYY-MM-DD`:
 * KRX returns `YYYY/MM/DD`, Naver returns `YYYYMMDD`. Empty/odd values pass
 * through unchanged.
 */
export function toIsoDate(value: unknown): string {
  const s = String(value ?? '').trim();
  if (/^\d{8}$/.test(s)) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  return s.replace(/\//g, '-');
}

/**
 * DART's majorstock/elestock endpoints return the full reporting history with
 * no server-side date filter. Sort by `rcept_dt` (YYYYMMDD string) descending
 * so the most recent disclosures come first, then cap to `limit`.
 */
export function sortByRceptDtDesc<T extends { rcept_dt?: unknown }>(
  list: T[],
  limit: number,
): T[] {
  return [...list]
    .sort((a, b) => String(b.rcept_dt ?? '').localeCompare(String(a.rcept_dt ?? '')))
    .slice(0, limit);
}

/**
 * DART status '013' (조회된 데이타가 없습니다) is a valid "no data" outcome, not
 * a failure — surfaced as an error by `dartApi`. Detect it so callers can return
 * an empty list instead of an error.
 */
export function isNoDataError(message: string): boolean {
  return message.includes('status=013');
}

/**
 * KRX (and Naver) return numbers as comma-grouped strings, sometimes with a
 * leading sign or a trailing `%` (e.g. "5,489,240", "+5,314,304", "48.27%").
 * Parse to a plain number; return null for blanks and the "-" placeholder.
 */
export function parseKrxNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const s = String(value)
    .trim()
    .replace(/,/g, '')
    .replace(/%$/, '')
    .replace(/^\+/, '');
  if (s === '' || s === '-') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/**
 * Naver's `/integration` metric strings carry Korean unit suffixes that
 * `parseKrxNumber` does not strip — e.g. "28.69배" (PER), "12,372원" (EPS),
 * "0.47%" (yield), "4.04" (recommendation), "401,250" (target price), "N/A".
 * Strip the suffix/grouping and parse; null for blanks, "-", and "N/A".
 */
export function parseNaverMetric(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const s = String(value)
    .trim()
    .replace(/,/g, '')
    .replace(/[%원배주]/g, '')
    .replace(/^\+/, '')
    .trim();
  if (s === '' || s === '-' || s.toUpperCase() === 'N/A') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/**
 * KRX getJsonData responses wrap rows in an `OutBlock_1` array (some endpoints
 * use other keys). Missing/empty is a valid "no data" outcome, not an error.
 */
export function extractOutBlock(
  data: Record<string, unknown> | null | undefined,
  key = 'OutBlock_1',
): unknown[] {
  const block = data?.[key];
  return Array.isArray(block) ? block : [];
}
