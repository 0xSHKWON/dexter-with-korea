import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { dartApi } from './api.js';
import { resolveKrSecurity } from './resolve-kr.js';
import { extractDsdBody, parseDsdTables } from './dart-document.js';
import { isNoDataError } from './utils.js';
import { formatToolResult } from '../types.js';
import { TTL_1H } from '../finance/utils.js';

export const GET_SEGMENTS_KR_DESCRIPTION = `Retrieves 사업부문별 요약 재무현황 (segment / divisional financials) for a Korean (KOSPI/KOSDAQ) listed company from its latest DART periodic report (사업/반기/분기보고서). For a 재벌/복합 기업 the segment mix IS the thesis — e.g. Samsung's DS(반도체) vs DX(가전·모바일) vs SDC, or Hyundai's 금융 vs 자동차 — yet the headline consolidated P&L hides it.

Returns the segment summary tables as structured rows (부문 × 매출액/영업이익/비중, usually across 2–3 periods), recovered from the report's narrative tables that the other tools strip. Accepts a 6-digit ticker (e.g. 005930) or a Korean company name (e.g. 삼성전자). Use this for "사업부문별 실적", "부문별 매출/영업이익", "세그먼트 비중", or to see which division drives earnings. For consolidated K-IFRS statements use get_financials_kr; for the qualitative business description use read_filings_kr.`;

const InputSchema = z.object({
  ticker: z
    .string()
    .min(1)
    .describe('6-digit Korean stock ticker (e.g. 005930) OR the company name (e.g. 삼성전자) — a name is resolved to its DART listing automatically.'),
  limit: z
    .number()
    .int()
    .min(1)
    .max(6)
    .default(3)
    .describe('Maximum number of segment tables to return (default 3, ranked best-first).'),
});

const PERIODIC_RE = /사업보고서|반기보고서|분기보고서/;
const SEGMENT_KW = /부문|세그먼트/;
const REVENUE_KW = /매출|수익/;
const OPINC_KW = /영업이익|영업손익/;

const MAX_ROWS = 30;
const MAX_COLS = 14;
const MAX_CELL = 80;

export interface SegmentTable {
  rowCount: number;
  cols: number;
  hasOperatingProfit: boolean;
  truncated: boolean;
  rows: string[][];
}

/** A cell is "numeric" if, stripped of formatting (commas, %, parens, signs), it is a number. */
export function isNumericCell(s: string): boolean {
  const t = s.replace(/[\s,()%△▲▽▼\-+]/g, '');
  return t.length > 0 && /^\d+(\.\d+)?$/.test(t);
}

/**
 * Rank and trim the parsed tables down to the segment financial-summary tables.
 *
 * A table qualifies when it mentions a segment term (부문/세그먼트) AND a revenue term,
 * is not a giant narrative table, and carries enough numeric cells. The per-부문 P&L
 * summary (매출액 + 영업이익 rows) is what an analyst wants, so tables containing
 * 영업이익 sort first; compact tables outrank sprawling product/R&D listings that merely
 * mention a 부문. Pure so it is unit-testable without a live DART fetch.
 */
export function selectSegmentTables(tables: string[][][], limit: number): SegmentTable[] {
  const scored: { score: number; table: SegmentTable }[] = [];
  for (const rows of tables) {
    const flat = rows.flat().join(' ');
    if (!SEGMENT_KW.test(flat) || !REVENUE_KW.test(flat)) continue;
    if (rows.length < 2 || rows.length > 80) continue;
    const numCount = rows.flat().filter(isNumericCell).length;
    if (numCount < 3) continue;

    const hasOp = OPINC_KW.test(flat);
    const cols = Math.min(MAX_COLS, Math.max(...rows.map((r) => r.length)));
    const trimmedRows = rows
      .slice(0, MAX_ROWS)
      .map((r) => r.slice(0, MAX_COLS).map((c) => (c.length > MAX_CELL ? c.slice(0, MAX_CELL) + '…' : c)));
    const truncated = rows.length > MAX_ROWS || rows.some((r) => r.length > MAX_COLS);

    // hasOp dominates (the segment P&L); then prefer compact tables; then numeric density.
    const score = (hasOp ? 1_000_000 : 0) + (rows.length <= 40 ? 1_000 : 0) + numCount;
    scored.push({
      score,
      table: { rowCount: rows.length, cols, hasOperatingProfit: hasOp, truncated, rows: trimmedRows },
    });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((s) => s.table);
}

function defaultRange(): { bgn_de: string; end_de: string } {
  const today = new Date();
  const start = new Date(today);
  start.setUTCMonth(today.getUTCMonth() - 18);
  const fmt = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, '');
  return { bgn_de: fmt(start), end_de: fmt(today) };
}

export const getSegmentsKr = new DynamicStructuredTool({
  name: 'get_segments_kr',
  description: GET_SEGMENTS_KR_DESCRIPTION,
  schema: InputSchema,
  func: async (input) => {
    const sec = await resolveKrSecurity(input.ticker);
    if (!sec?.corpCode) {
      return formatToolResult(
        { ticker: input.ticker, _error: `Could not resolve "${input.ticker}" to a DART corp_code — pass a 6-digit ticker or an exact company name` },
        [],
      );
    }
    const identity = { ticker: sec.stockCode, corp_code: sec.corpCode, corp_name: sec.name ?? '' };

    // 1. Find the most recent periodic report (사업/반기/분기보고서).
    const range = defaultRange();
    let filings: Record<string, unknown>[] = [];
    let listUrl = '';
    try {
      const { data, url } = await dartApi.get(
        '/list.json',
        {
          corp_code: sec.corpCode,
          bgn_de: range.bgn_de,
          end_de: range.end_de,
          pblntf_ty: 'A',
          page_count: 100,
          page_no: 1,
          sort: 'date',
          sort_mth: 'desc',
        },
        { cacheable: true, ttlMs: TTL_1H },
      );
      listUrl = url;
      filings = Array.isArray(data.list) ? (data.list as Record<string, unknown>[]) : [];
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!isNoDataError(message)) {
        return formatToolResult({ ...identity, _error: `DART filing search failed: ${message}` }, []);
      }
    }

    const report = filings.find((f) => PERIODIC_RE.test(String(f.report_nm ?? '')));
    if (!report?.rcept_no) {
      return formatToolResult(
        { ...identity, segments: [], note: '최근 18개월 내 정기보고서(사업/반기/분기)를 찾지 못했습니다.' },
        listUrl ? [listUrl] : [],
      );
    }
    const reportNm = String(report.report_nm ?? '');
    const rceptNo = String(report.rcept_no);

    // 2. Fetch the document, recover its tables, and keep the segment summaries.
    let segments: SegmentTable[];
    let docUrl = '';
    try {
      const { bytes, url } = await dartApi.getBinary('/document.xml', { rcept_no: rceptNo });
      docUrl = url;
      const body = extractDsdBody(bytes);
      segments = selectSegmentTables(parseDsdTables(body), input.limit);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return formatToolResult(
        { ...identity, report_nm: reportNm, rcept_no: rceptNo, _error: `Failed to read DART document: ${message}` },
        listUrl ? [listUrl] : [],
      );
    }

    const sourceUrls = [docUrl, listUrl].filter(Boolean);
    if (segments.length === 0) {
      return formatToolResult(
        {
          ...identity,
          report_nm: reportNm,
          rcept_no: rceptNo,
          segments: [],
          note: '이 보고서에서 사업부문별 요약 재무현황 표를 찾지 못했습니다(단일 사업부문 기업이거나 표 형식 상이). 정성적 사업 구성은 read_filings_kr["business"]로 확인하세요.',
        },
        sourceUrls,
      );
    }

    return formatToolResult(
      {
        ...identity,
        report_nm: reportNm,
        rcept_no: rceptNo,
        note: '부문별 요약 재무현황 표(원문 추출). 금액 단위는 보통 백만원이며 표 머리글/원보고서로 확인하세요. 1순위 표가 부문별 매출액·영업이익 요약일 가능성이 높습니다.',
        segments,
      },
      sourceUrls,
    );
  },
});
