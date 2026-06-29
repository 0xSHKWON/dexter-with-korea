/**
 * Bank of Korea ECOS (경제통계시스템) OpenAPI client.
 *
 * Source of authoritative Korean macro reference rates — the inputs that DCF/
 * valuation previously sourced via `web_search` (risk-free rate, FX). ECOS is
 * the official Bank of Korea statistics feed, so a dated, sourced number
 * replaces a web-inferred one.
 *
 * Endpoint:
 *   https://ecos.bok.or.kr/api/StatisticSearch/{KEY}/json/kr/{start}/{end}/
 *     {STAT_CODE}/{CYCLE}/{START_TIME}/{END_TIME}/{ITEM_CODE1}
 * Auth: ECOS_API_KEY embedded in the path (not a query param).
 *
 * The (STAT_CODE, ITEM_CODE) pairs below are ECOS's documented series codes;
 * a wrong/retired code surfaces loudly as an ECOS RESULT error (parseEcosResponse
 * throws with the ECOS message) rather than a silent wrong number, so it is a
 * one-line fix if ECOS ever renumbers a series.
 */
import { readCache, writeCache } from '../../utils/cache.js';
import { logger } from '../../utils/logger.js';
import { parseKrxNumber, toIsoDate } from '../../tools/finance-kr/utils.js';

export type EcosCycle = 'D' | 'M';

export type EcosSeriesKey =
  | 'treasury_10y'
  | 'treasury_5y'
  | 'treasury_3y'
  | 'treasury_1y'
  | 'corporate_aa3y'
  | 'usdkrw'
  | 'base_rate';

interface SeriesSpec {
  statCode: string;
  itemCode: string;
  cycle: EcosCycle;
  label: string;
}

/**
 * 817Y002 = 시장금리(일별); 731Y001 = 환율(일별); 722Y001 = 한국은행 기준금리.
 * Item codes per ECOS's 통계항목 listing for each table.
 */
export const ECOS_SERIES: Record<EcosSeriesKey, SeriesSpec> = {
  treasury_10y: { statCode: '817Y002', itemCode: '010210000', cycle: 'D', label: '국고채(10년) 수익률' },
  treasury_5y: { statCode: '817Y002', itemCode: '010200001', cycle: 'D', label: '국고채(5년) 수익률' },
  treasury_3y: { statCode: '817Y002', itemCode: '010200000', cycle: 'D', label: '국고채(3년) 수익률' },
  treasury_1y: { statCode: '817Y002', itemCode: '010190000', cycle: 'D', label: '국고채(1년) 수익률' },
  corporate_aa3y: { statCode: '817Y002', itemCode: '010300000', cycle: 'D', label: '회사채(3년, AA-) 수익률' },
  usdkrw: { statCode: '731Y001', itemCode: '0000001', cycle: 'D', label: '원/달러 환율(매매기준율)' },
  base_rate: { statCode: '722Y001', itemCode: '0101000', cycle: 'D', label: '한국은행 기준금리' },
};

export interface EcosRow {
  date: string; // ISO YYYY-MM-DD (daily) or YYYYMM (monthly)
  value: number;
}

export interface EcosSeriesResult {
  series: EcosSeriesKey;
  label: string;
  statCode: string;
  statName: string;
  itemCode: string;
  itemName: string;
  unit: string;
  cycle: EcosCycle;
  rows: EcosRow[]; // ascending by date
}

const ECOS_BASE = 'https://ecos.bok.or.kr/api/StatisticSearch';
const DEFAULT_TTL_MS = 6 * 60 * 60 * 1000; // rates/FX move at most once per business day

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function ymd(d: Date): string {
  return `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}`;
}

function ym(d: Date): string {
  return `${d.getFullYear()}${pad2(d.getMonth() + 1)}`;
}

/** Lookback window wide enough to clear weekends/holidays and still land a fresh print. */
function windowFor(cycle: EcosCycle): { start: string; end: string } {
  const now = new Date();
  if (cycle === 'M') {
    const start = new Date(now.getFullYear() - 1, now.getMonth(), 1);
    return { start: ym(start), end: ym(now) };
  }
  const start = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);
  return { start: ymd(start), end: ymd(now) };
}

/**
 * Parse an ECOS StatisticSearch body into a sorted series. ECOS returns a
 * `{ RESULT: { CODE, MESSAGE } }` envelope for both auth failures (INFO-100) and
 * empty results (INFO-200) — surface either as an error so a bad code never
 * masquerades as "no data". Pure (no I/O) for deterministic tests.
 */
export function parseEcosResponse(
  seriesKey: EcosSeriesKey,
  spec: SeriesSpec,
  body: Record<string, unknown>,
): EcosSeriesResult {
  const result = body?.RESULT as { CODE?: string; MESSAGE?: string } | undefined;
  if (result?.CODE) {
    throw new Error(`[ECOS] ${result.CODE}: ${result.MESSAGE ?? 'unknown'}`);
  }

  const search = body?.StatisticSearch as { row?: unknown[] } | undefined;
  const rawRows = Array.isArray(search?.row) ? (search.row as Record<string, unknown>[]) : [];

  const rows: EcosRow[] = rawRows
    .map((r) => ({ date: toIsoDate(r.TIME), value: parseKrxNumber(r.DATA_VALUE) }))
    .filter((r): r is EcosRow => Boolean(r.date) && r.value !== null)
    .sort((a, b) => a.date.localeCompare(b.date));

  const first = rawRows[0] ?? {};
  return {
    series: seriesKey,
    label: spec.label,
    statCode: spec.statCode,
    statName: String(first.STAT_NAME ?? ''),
    itemCode: spec.itemCode,
    itemName: String(first.ITEM_NAME1 ?? spec.label),
    unit: String(first.UNIT_NAME ?? ''),
    cycle: spec.cycle,
    rows,
  };
}

/** Fetch one ECOS series (cached). Throws on missing key, network, or ECOS error. */
export async function fetchEcosSeries(
  seriesKey: EcosSeriesKey,
  opts?: { ttlMs?: number },
): Promise<EcosSeriesResult> {
  const spec = ECOS_SERIES[seriesKey];
  if (!spec) throw new Error(`[ECOS] unknown series: ${seriesKey}`);

  const apiKey = process.env.ECOS_API_KEY || '';
  if (!apiKey) throw new Error('[ECOS] ECOS_API_KEY not set');

  const { start, end } = windowFor(spec.cycle);
  const endpoint = '/ecos/StatisticSearch';
  const params = { stat: spec.statCode, item: spec.itemCode, cycle: spec.cycle, start, end };
  const ttlMs = opts?.ttlMs ?? DEFAULT_TTL_MS;

  const cached = readCache(endpoint, params, ttlMs);
  if (cached) return parseEcosResponse(seriesKey, spec, cached.data);

  const path = [
    ECOS_BASE,
    encodeURIComponent(apiKey),
    'json',
    'kr',
    '1',
    '100',
    spec.statCode,
    spec.cycle,
    start,
    end,
    spec.itemCode,
  ].join('/');

  let response: Response;
  try {
    response = await fetch(path);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`[ECOS] network error: ${seriesKey} — ${message}`);
    throw new Error(`[ECOS] request failed: ${message}`);
  }
  if (!response.ok) {
    throw new Error(`[ECOS] request failed: ${response.status} ${response.statusText}`);
  }
  const body = (await response.json().catch(() => {
    throw new Error('[ECOS] request failed: invalid JSON');
  })) as Record<string, unknown>;

  // Cache only valid payloads; keep the key out of the stored URL.
  const safeUrl = path.replace(encodeURIComponent(apiKey), '***');
  const parsed = parseEcosResponse(seriesKey, spec, body);
  writeCache(endpoint, params, body, safeUrl);
  return parsed;
}
