import { unzipSync, strFromU8 } from 'fflate';
import { XMLParser } from 'fast-xml-parser';
import { logger } from '../../utils/logger.js';

const CORP_CODE_URL = 'https://opendart.fss.or.kr/api/corpCode.xml';
const CORP_CODE_XML_FILENAME = 'CORPCODE.xml';

export interface CorpCodeEntry {
  corp_code: string;
  corp_name: string;
  stock_code: string | null;
  modify_date: string;
}

interface RawCorpListEntry {
  corp_code: string | number;
  corp_name: string;
  stock_code?: string | number;
  modify_date: string | number;
}

function getApiKey(): string {
  return process.env.DART_API_KEY || '';
}

function normalize(value: string | number | undefined): string {
  if (value === undefined || value === null) return '';
  const s = String(value).trim();
  return s;
}

export function parseCorpCodeXml(xml: string): CorpCodeEntry[] {
  const parser = new XMLParser({
    ignoreAttributes: true,
    trimValues: true,
    parseTagValue: false,
  });
  const doc = parser.parse(xml) as { result?: { list?: RawCorpListEntry | RawCorpListEntry[] } };
  const list = doc.result?.list;
  if (!list) return [];

  const rows = Array.isArray(list) ? list : [list];
  return rows.map((row) => {
    const stockCode = normalize(row.stock_code);
    return {
      corp_code: normalize(row.corp_code),
      corp_name: normalize(row.corp_name),
      stock_code: stockCode === '' ? null : stockCode,
      modify_date: normalize(row.modify_date),
    };
  });
}

export function extractCorpCodeXmlFromZip(zipBytes: Uint8Array): string {
  const files = unzipSync(zipBytes);
  const entry = files[CORP_CODE_XML_FILENAME] ?? Object.values(files)[0];
  if (!entry) {
    throw new Error('[DART corpCode] ZIP did not contain any files');
  }
  return strFromU8(entry);
}

export async function fetchDartCorpCodes(): Promise<CorpCodeEntry[]> {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error('[DART corpCode] DART_API_KEY not set');
  }

  const url = `${CORP_CODE_URL}?crtfc_key=${encodeURIComponent(apiKey)}`;
  let response: Response;
  try {
    response = await fetch(url);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`[DART corpCode] network error — ${message}`);
    throw new Error(`[DART corpCode] request failed: ${message}`);
  }

  if (!response.ok) {
    const detail = `${response.status} ${response.statusText}`;
    logger.error(`[DART corpCode] HTTP error — ${detail}`);
    throw new Error(`[DART corpCode] request failed: ${detail}`);
  }

  const contentType = response.headers.get('content-type') ?? '';
  // DART returns XML error payload (application/xml) for bad keys instead of a ZIP
  if (contentType.includes('xml') || contentType.includes('text')) {
    const body = await response.text();
    throw new Error(`[DART corpCode] expected ZIP, got ${contentType}: ${body.slice(0, 200)}`);
  }

  const buffer = await response.arrayBuffer();
  const xml = extractCorpCodeXmlFromZip(new Uint8Array(buffer));
  return parseCorpCodeXml(xml);
}
