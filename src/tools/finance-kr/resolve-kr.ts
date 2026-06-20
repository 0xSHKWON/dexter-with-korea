/**
 * Unified resolver: turn a 6-digit ticker OR a Korean company name into a canonical
 * listing (6-digit stock code + DART corp_code when available).
 *
 * Why this exists: every KR tool used to accept only `^\d{6}$`, so when the user gave
 * a NAME the model had to recall the code from memory. A one-digit slip silently
 * returns a DIFFERENT company, and the agent then builds a polished, fully-cited thesis
 * on the wrong stock — the worst failure mode for a research agent. Centralizing the
 * name→code step makes resolution deterministic (DART registry / Naver), not a guess.
 *
 * Resolution order:
 *   1. 6-digit passthrough — authoritative stock code; enrich corp_code best-effort.
 *   2. DART name registry (`resolveCorpName`) — authoritative corp_code, FULL TIER ONLY
 *      (the corpCode.xml fetch needs a DART key).
 *   3. Keyless Naver autocomplete — works without any key; gives the stock code only.
 */
import { resolveTicker, resolveCorpName } from '../../data/ticker-registry.js';
import { fetchNaverAutocomplete } from './naver-api.js';

const TICKER_RE = /^\d{6}$/;

export type KrResolveSource = 'ticker' | 'registry-name' | 'naver-name';

export interface ResolvedKrSecurity {
  /** 6-digit listing code — what Naver/KRX tools key on. Always present on success. */
  stockCode: string;
  /** 8-digit DART corp_code — what DART tools key on. null when the DART registry is unavailable (keyless tier). */
  corpCode: string | null;
  /** Canonical company name when known. */
  name: string | null;
  /** Market type (KOSPI/KOSDAQ) when resolved via Naver. */
  market: string | null;
  source: KrResolveSource;
}

/** Best-effort 6-digit → DART corp_code. Swallows the "no DART key" throw so keyless callers still get a stock code. */
async function tickerToCorp(stockCode: string): Promise<{ corp_code: string; corp_name: string } | null> {
  try {
    return await resolveTicker(stockCode);
  } catch {
    return null;
  }
}

export async function resolveKrSecurity(input: string): Promise<ResolvedKrSecurity | null> {
  const q = (input ?? '').trim();
  if (!q) return null;

  // 1. Already a 6-digit code — authoritative; add corp_code if the registry is up.
  if (TICKER_RE.test(q)) {
    const reg = await tickerToCorp(q);
    return {
      stockCode: q,
      corpCode: reg?.corp_code ?? null,
      name: reg?.corp_name ?? null,
      market: null,
      source: 'ticker',
    };
  }

  // 2. Name via the DART registry (authoritative corp_code) — full tier only.
  try {
    const reg = await resolveCorpName(q);
    if (reg?.stock_code && TICKER_RE.test(reg.stock_code)) {
      return {
        stockCode: reg.stock_code,
        corpCode: reg.corp_code,
        name: reg.corp_name,
        market: null,
        source: 'registry-name',
      };
    }
  } catch {
    // registry unavailable (no DART key) — fall through to the keyless path
  }

  // 3. Keyless Naver autocomplete — stock code only (corp_code best-effort if the registry is up).
  const hit = await fetchNaverAutocomplete(q);
  if (hit) {
    const reg = await tickerToCorp(hit.code);
    return {
      stockCode: hit.code,
      corpCode: reg?.corp_code ?? null,
      name: hit.name ?? reg?.corp_name ?? null,
      market: hit.market,
      source: 'naver-name',
    };
  }

  return null;
}
