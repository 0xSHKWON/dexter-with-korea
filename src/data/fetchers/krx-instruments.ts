/**
 * KRX 전종목 기본정보 (all-listed instruments) — provides the ticker ↔ ISIN map.
 *
 * KRX statistical endpoints key on ISIN (`isuCd`, e.g. KR7005930003), not the
 * 6-digit ticker, so tools that hit KRX must resolve the ticker first. This
 * fetcher pulls the full listing via bld `MDCSTAT01901` (requires an
 * authenticated KRX session — see krx-api/krx-session).
 */
import { krxApi } from '../../tools/finance-kr/krx-api.js';
import { extractOutBlock } from '../../tools/finance-kr/utils.js';

export interface KrxInstrumentEntry {
  ticker: string; // 6-digit short code (ISU_SRT_CD)
  isin: string; // full ISIN (ISU_CD)
  name: string; // abbreviated name (ISU_ABBRV), falling back to ISU_NM
  market: string; // KOSPI / KOSDAQ / KONEX (MKT_TP_NM)
}

function normalize(value: unknown): string {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

export function parseKrxInstruments(data: Record<string, unknown>): KrxInstrumentEntry[] {
  const rows = extractOutBlock(data);
  const out: KrxInstrumentEntry[] = [];
  for (const raw of rows) {
    const row = raw as Record<string, unknown>;
    const ticker = normalize(row.ISU_SRT_CD);
    const isin = normalize(row.ISU_CD);
    // Drop rows without a 6-digit ticker or an ISIN (field drift / odd rows).
    if (!/^\d{6}$/.test(ticker) || !isin) continue;
    out.push({
      ticker,
      isin,
      name: normalize(row.ISU_ABBRV) || normalize(row.ISU_NM),
      market: normalize(row.MKT_TP_NM),
    });
  }
  return out;
}

export async function fetchKrxInstruments(): Promise<KrxInstrumentEntry[]> {
  const { data } = await krxApi.get('dbms/MDC/STAT/standard/MDCSTAT01901', {
    mktId: 'ALL',
    segTpCd: 'ALL',
  });
  return parseKrxInstruments(data);
}
