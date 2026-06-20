/**
 * National Pension Service (국민연금공단) domestic equity holdings.
 *
 * Source: data.go.kr dataset 3070507 "국민연금공단_국내주식 투자정보", served as
 * an odcloud REST JSON API (UTF-8). Year-end snapshot. Columns: 종목명,
 * 평가액(억원), 자산군 내 비중(%), 지분율(%). Requires DATA_GO_KR_SERVICE_KEY.
 *
 * The dataset exposes no ticker column — only the Korean stock name — so the
 * tool layer matches a queried ticker to its name. Column keys carry units in
 * their header text and have drifted across versions, so parsing matches by
 * substring rather than exact key.
 */
import { logger } from '../../utils/logger.js';
import { parseKrxNumber } from '../../tools/finance-kr/utils.js';

const ODCLOUD_BASE =
  'https://api.odcloud.kr/api/3070507/v1/uddi:cc757223-fdc0-45b2-a617-dcbecec3fe1f';
const PER_PAGE = 1000;
const MAX_PAGES = 20; // safety bound; NPS holds well under PER_PAGE * MAX_PAGES names

export interface NpsHoldingEntry {
  name: string; // 종목명
  evalAmount: number | null; // 평가액 (억원)
  weightPct: number | null; // 자산군 내 비중 (%)
  shareRatioPct: number | null; // 지분율 (%)
}

interface OdcloudPage {
  currentCount?: number;
  totalCount?: number;
  data?: Record<string, unknown>[];
}

function getServiceKey(): string {
  return process.env.DATA_GO_KR_SERVICE_KEY || '';
}

function normalize(value: unknown): string {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

function findKey(row: Record<string, unknown>, substrings: string[]): string | undefined {
  return Object.keys(row).find((key) => substrings.some((s) => key.includes(s)));
}

export function parseNpsRows(rows: Record<string, unknown>[]): NpsHoldingEntry[] {
  const out: NpsHoldingEntry[] = [];
  for (const row of rows) {
    const nameKey = findKey(row, ['종목명', '종목']);
    const name = nameKey ? normalize(row[nameKey]) : '';
    if (!name) continue;
    const evalKey = findKey(row, ['평가액']);
    const weightKey = findKey(row, ['비중']);
    const shareKey = findKey(row, ['지분율']);
    out.push({
      name,
      evalAmount: evalKey ? parseKrxNumber(row[evalKey]) : null,
      weightPct: weightKey ? parseKrxNumber(row[weightKey]) : null,
      shareRatioPct: shareKey ? parseKrxNumber(row[shareKey]) : null,
    });
  }
  return out;
}

export async function fetchNpsHoldings(): Promise<NpsHoldingEntry[]> {
  const serviceKey = getServiceKey();
  if (!serviceKey) {
    throw new Error('[NPS] DATA_GO_KR_SERVICE_KEY not set');
  }

  const all: NpsHoldingEntry[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const url = new URL(ODCLOUD_BASE);
    url.searchParams.set('page', String(page));
    url.searchParams.set('perPage', String(PER_PAGE));
    url.searchParams.set('returnType', 'JSON');
    url.searchParams.set('serviceKey', serviceKey);

    let response: Response;
    try {
      response = await fetch(url.toString());
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(`[NPS] network error (page ${page}) — ${message}`);
      throw new Error(`[NPS] request failed: ${message}`);
    }
    if (!response.ok) {
      throw new Error(`[NPS] request failed: ${response.status} ${response.statusText}`);
    }
    const body = (await response.json().catch(() => {
      throw new Error('[NPS] request failed: invalid JSON');
    })) as OdcloudPage;

    const rows = Array.isArray(body.data) ? body.data : [];
    all.push(...parseNpsRows(rows));

    const total = typeof body.totalCount === 'number' ? body.totalCount : undefined;
    if (rows.length < PER_PAGE || (total !== undefined && page * PER_PAGE >= total)) {
      break;
    }
  }
  return all;
}
