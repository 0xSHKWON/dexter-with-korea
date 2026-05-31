import { DynamicStructuredTool } from '@langchain/core/tools';
import type { RunnableConfig } from '@langchain/core/runnables';
import { z } from 'zod';
import { existsSync, mkdirSync, writeFileSync, readdirSync, statSync, unlinkSync } from 'fs';
import { callLlm } from '../../model/llm.js';
import { formatToolResult } from '../types.js';
import { getCurrentDate } from '../../agent/prompts.js';
import { resolveTicker } from '../../data/ticker-registry.js';
import { dexterPath } from '../../utils/paths.js';
import { readCache, writeCache } from '../../utils/cache.js';
import { withTimeout, TTL_1H, TTL_24H } from '../finance/utils.js';
import { isNoDataError } from './utils.js';
import { dartApi } from './api.js';
import {
  fetchAndExtractSections,
  type SectionCategory,
  type ExtractedSections,
} from './dart-document.js';

export const READ_FILINGS_KR_DESCRIPTION = `Intelligent meta-tool for reading the QUALITATIVE narrative of a Korean (KOSPI/KOSDAQ) company's DART 정기보고서 (사업/반기/분기보고서). Takes a natural-language query, finds the right report, extracts the relevant narrative sections from the original filing, and returns a grounded Korean analyst summary.

## When to Use
- "회사 사업이 어떻게 구성돼 있어" — business structure / segments (II. 사업의 내용)
- "주요 제품/매출 구성" — main products & services (prose; for tables use get_financials_kr)
- "주요 리스크가 뭐야" — risk narrative (II.5 위험관리 및 파생거래 + XI 투자자 보호)
- "경영진단 의견 / MD&A" — management discussion (IV. 이사의 경영진단 및 분석의견)
- Company overview (I. 회사의 개요)

## When NOT to Use
- Financial line items / numbers → get_financials_kr
- Disclosure metadata / filing history → get_filings_kr
- Shareholders, short interest, foreign ownership → the dedicated *_kr tools

## Usage Notes
- Call ONCE with the full natural-language query. Accepts company names (삼성전자 → 005930).
- Returns a grounded summary in 'summary'; full extracted sections are persisted to rawSectionsFile for drill-down (read_file).
- 6-digit Korean tickers only. The narrative is qualitative — numeric tables route to get_financials_kr.`;

// ---------------------------------------------------------------------------
// Plan schema (LLM call #1)
// ---------------------------------------------------------------------------

type ReportType = 'annual' | 'semiannual' | 'quarterly_1' | 'quarterly_3';

const PlanSchema = z.object({
  ticker: z
    .string()
    .describe('6-digit Korean stock ticker (e.g. 005930 for Samsung). Resolve company names to tickers yourself.'),
  report_type: z
    .enum(['annual', 'semiannual', 'quarterly_1', 'quarterly_3'])
    .describe(
      "Which periodic report to read: 'annual' (사업보고서, default), 'semiannual' (반기보고서), " +
        "'quarterly_1' (1분기보고서), 'quarterly_3' (3분기보고서). Use 'annual' unless the query names a quarter/half.",
    ),
  year: z
    .number()
    .int()
    .min(2015)
    .max(2100)
    .nullable()
    .describe('Business (fiscal) year of the report, e.g. 2025 for the FY2025 사업보고서. null for the most recent.'),
  sections: z
    .array(z.enum(['overview', 'business', 'products', 'risks', 'mdna']))
    .min(1)
    .describe(
      'Narrative section categories to read. Map intent: 사업 구성/세그먼트→["business"], 주요 제품/매출구성→["products"], ' +
        '주요 리스크→["risks"], 경영진단/MD&A→["mdna"], 회사 개요→["overview"]. Pick the minimum set.',
    ),
});

type Plan = z.infer<typeof PlanSchema>;

function buildPlanPrompt(): string {
  return `You are a Korean DART filing planning assistant.
Current date: ${getCurrentDate()}

Given a user query about a Korean company's report narrative, return a structured plan:
- ticker (6-digit; resolve names: 삼성전자→005930, SK하이닉스→000660, 네이버→035420, LG화학→051910, 현대차→005380, 카카오→035720)
- report_type (annual unless the query names a quarter/half)
- year (fiscal year, or null for most recent)
- sections (which narrative categories answer the query)

Section mapping:
- 사업 구성 / 사업부문 / 세그먼트 / "무슨 사업" → business
- 주요 제품 / 제품군 / 매출 구성(정성) → products
- 리스크 / 위험 / 위험요인 → risks
- 경영진단 / MD&A / 경영진 분석 → mdna
- 회사 개요 / 연혁 → overview
Choose the minimum set that answers the query.`;
}

// ---------------------------------------------------------------------------
// rcept_no selection (deterministic, pure — exported for tests)
// ---------------------------------------------------------------------------

export interface DartFiling {
  rcept_no?: string;
  report_nm?: string;
  rcept_dt?: string;
}

const REPORT_NM_PATTERN: Record<ReportType, RegExp> = {
  annual: /사업보고서/,
  semiannual: /반기보고서/,
  quarterly_1: /분기보고서/,
  quarterly_3: /분기보고서/,
};

/** Period month/year encoded in `report_nm` like "사업보고서 (2025.12)". */
function periodMonth(f: DartFiling): string | null {
  const m = String(f.report_nm ?? '').match(/\(\d{4}\.(\d{2})\)/);
  return m ? m[1] : null;
}
function periodYear(f: DartFiling): number | null {
  const m = String(f.report_nm ?? '').match(/\((\d{4})\.\d{2}\)/);
  return m ? Number(m[1]) : null;
}

/**
 * Pick the single rcept_no for the requested report. Filters by report-name type,
 * disambiguates 1분기/3분기 by the period month (.03 vs .09, filing month as fallback),
 * filters by fiscal year when given, and prefers a [기재정정] amendment (it supersedes
 * the original) then the most recently received.
 */
export function pickRceptNo(
  list: DartFiling[],
  reportType: ReportType,
  year?: number | null,
): DartFiling | null {
  const pattern = REPORT_NM_PATTERN[reportType];
  let candidates = list.filter((f) => pattern.test(String(f.report_nm ?? '')));

  if (reportType === 'quarterly_1' || reportType === 'quarterly_3') {
    const wantMonth = reportType === 'quarterly_1' ? '03' : '09';
    const byPeriod = candidates.filter((f) => periodMonth(f) === wantMonth);
    if (byPeriod.length > 0) {
      candidates = byPeriod;
    } else {
      const wantFilingMonths = reportType === 'quarterly_1' ? ['04', '05', '06'] : ['10', '11', '12'];
      const byFiling = candidates.filter((f) => wantFilingMonths.includes(String(f.rcept_dt ?? '').slice(4, 6)));
      if (byFiling.length > 0) candidates = byFiling;
    }
  }

  if (year != null) {
    const byYear = candidates.filter((f) => {
      const py = periodYear(f);
      return py != null ? py === year : String(f.rcept_dt ?? '').slice(0, 4) === String(year + 1);
    });
    if (byYear.length > 0) candidates = byYear;
  }

  if (candidates.length === 0) return null;

  const sorted = candidates
    .slice()
    .sort((a, b) => String(b.rcept_dt ?? '').localeCompare(String(a.rcept_dt ?? '')));
  const amended = sorted.find((f) => String(f.report_nm ?? '').includes('기재정정'));
  return amended ?? sorted[0];
}

function listRange(year?: number | null): { bgn_de: string; end_de: string } {
  if (year != null) {
    // Report for FY `year` is filed in `year`+1 (annual ~Mar). Cover both years.
    return { bgn_de: `${year}0101`, end_de: `${year + 1}0630` };
  }
  const today = new Date();
  const past = new Date(today);
  past.setUTCMonth(today.getUTCMonth() - 18);
  const fmt = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, '');
  return { bgn_de: fmt(past), end_de: fmt(today) };
}

// ---------------------------------------------------------------------------
// Extraction (cached) + summarization input
// ---------------------------------------------------------------------------

const CACHE_ENDPOINT = '/_dsd_sections'; // synthetic — caches parsed text, never hits network
const DART_DOCUMENT_TIMEOUT_MS = 30_000; // the 5MB ZIP leg is slower than other sub-tools
const PER_SECTION_CHARS = 40_000;
const TOTAL_CHARS = 120_000;

async function getOrExtractSections(
  rceptNo: string,
  categories: SectionCategory[],
): Promise<ExtractedSections> {
  const cacheParams = { rcept_no: rceptNo, sections: categories.slice().sort().join(',') };
  const cached = readCache(CACHE_ENDPOINT, cacheParams, TTL_24H);
  if (cached) {
    return {
      sections: (cached.data.sections as Record<string, string>) ?? {},
      allTitles: (cached.data.allTitles as string[]) ?? [],
      url: cached.url,
    };
  }
  const fresh = await withTimeout(
    fetchAndExtractSections(rceptNo, categories),
    DART_DOCUMENT_TIMEOUT_MS,
    'read_filings_kr document.xml',
  );
  writeCache(CACHE_ENDPOINT, cacheParams, { sections: fresh.sections, allTitles: fresh.allTitles }, fresh.url);
  return fresh;
}

/** Concatenate extracted sections under a per-section / total char budget. */
function buildSummaryInput(sections: Record<string, string>): string {
  const parts: string[] = [];
  let total = 0;
  for (const [cat, text] of Object.entries(sections)) {
    if (total >= TOTAL_CHARS) break;
    let t = text.length > PER_SECTION_CHARS ? `${text.slice(0, PER_SECTION_CHARS)}\n…(이하 생략)` : text;
    if (total + t.length > TOTAL_CHARS) {
      t = `${t.slice(0, Math.max(0, TOTAL_CHARS - total))}\n…(이하 생략)`;
    }
    total += t.length;
    parts.push(`<<${cat}>>\n${t}`);
  }
  return parts.join('\n\n');
}

// Escape curly braces so LangChain's ChatPromptTemplate (OpenAI/Gemini path in
// callLlm) doesn't treat filing text as template variables.
function escapeTemplateVars(str: string): string {
  return str.replace(/\{/g, '{{').replace(/\}/g, '}}');
}

function buildSummaryPrompt(
  corpName: string,
  reportNm: string,
  rceptNo: string,
  body: string,
): string {
  return `당신은 한국 주식 리서치 애널리스트입니다.
오늘 날짜: ${getCurrentDate()}

아래는 ${corpName}의 ${reportNm} (DART 접수번호 ${rceptNo}) 본문에서 추출한 정성적 내용입니다.
사용자 질문에 대해 아래 발췌 내용에만 근거하여 한국어로 답하세요.

원칙:
- 발췌에 있는 구체적 사업부문·제품·리스크·수치만 인용하세요. 발췌에 없는 사실을 지어내지 마세요(환각 금지).
- 발췌가 질문을 다루지 않으면 모른다고 명시하세요.
- 단순 나열이 아니라 핵심을 종합·분석하세요.
- 표/수치 데이터의 정밀 집계는 get_financials_kr 영역이므로, 여기서는 정성적 해석에 집중하세요.

[발췌 본문]
${body}`;
}

// ---------------------------------------------------------------------------
// Raw-section persistence (mirrors get-business-report's prune idiom)
// ---------------------------------------------------------------------------

const RAW_FILE_KEEP = 30;

function pruneRawFilingFiles(dir: string, keepName: string): void {
  try {
    const entries = readdirSync(dir)
      .filter((f) => f.startsWith('kr-filing-') && f.endsWith('.json') && f !== keepName)
      .map((f) => {
        try {
          return { f, mtime: statSync(`${dir}/${f}`).mtimeMs };
        } catch {
          return null;
        }
      })
      .filter((e): e is { f: string; mtime: number } => e !== null)
      .sort((a, b) => b.mtime - a.mtime);
    for (const { f } of entries.slice(RAW_FILE_KEEP)) {
      try {
        unlinkSync(`${dir}/${f}`);
      } catch {
        /* already removed */
      }
    }
  } catch {
    /* best-effort */
  }
}

function persistRawSections(
  meta: { ticker: string; corp_code: string; corp_name: string; report_nm: string; rcept_no: string },
  sections: Record<string, string>,
): string | undefined {
  try {
    const dir = dexterPath('tool-results');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const safeCorp = meta.corp_code.replace(/[^a-zA-Z0-9_-]/g, '_');
    const safeRcept = meta.rcept_no.replace(/[^a-zA-Z0-9_-]/g, '_');
    const fileName = `kr-filing-${safeCorp}-${safeRcept}.json`;
    const filePath = `${dir}/${fileName}`;
    writeFileSync(filePath, JSON.stringify({ ...meta, sections }, null, 2), 'utf-8');
    pruneRawFilingFiles(dir, fileName);
    return filePath;
  } catch {
    return undefined; // best-effort; the summary is the source of truth
  }
}

// ---------------------------------------------------------------------------
// Tool factory
// ---------------------------------------------------------------------------

function errMsg(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Create a read_filings_kr tool configured with the given model.
 * Workflow: (1) structured-output plan → (2) deterministic rcept_no lookup via
 * /list.json → (3) document.xml fetch + DSD parse (cached) → (4) grounded Korean
 * summary. Raw sections are persisted for drill-down.
 */
export function createReadFilingsKr(model: string): DynamicStructuredTool {
  return new DynamicStructuredTool({
    name: 'read_filings_kr',
    description: READ_FILINGS_KR_DESCRIPTION,
    schema: z.object({
      query: z
        .string()
        .describe('Natural-language query about a Korean company report narrative (e.g. "삼성전자 사업 구성", "주요 리스크").'),
    }),
    func: async (input, _runManager, config?: RunnableConfig) => {
      const onProgress = config?.metadata?.onProgress as ((msg: string) => void) | undefined;

      // 1. Plan ticker + report + sections.
      onProgress?.('Planning DART filing read...');
      let plan: Plan;
      try {
        const { response } = await callLlm(input.query, {
          model,
          systemPrompt: buildPlanPrompt(),
          outputSchema: PlanSchema,
        });
        plan = PlanSchema.parse(response);
      } catch (error) {
        return formatToolResult({ error: 'Failed to plan filing read', details: errMsg(error) }, []);
      }

      const ticker = plan.ticker.trim();
      const resolved = await resolveTicker(ticker);
      if (!resolved) {
        return formatToolResult({ error: `Ticker ${ticker} not found in DART corp registry` }, []);
      }
      const identity = { ticker, corp_code: resolved.corp_code, corp_name: resolved.corp_name };

      // 2. Find the report's rcept_no via /list.json (정기공시).
      onProgress?.(`Finding ${plan.report_type} report for ${resolved.corp_name}...`);
      const range = listRange(plan.year);
      let filings: DartFiling[] = [];
      let listUrl = '';
      try {
        const { data, url } = await dartApi.get(
          '/list.json',
          {
            corp_code: resolved.corp_code,
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
        filings = Array.isArray(data.list) ? (data.list as DartFiling[]) : [];
      } catch (error) {
        const message = errMsg(error);
        if (!isNoDataError(message)) {
          return formatToolResult({ ...identity, error: 'DART filing search failed', details: message }, []);
        }
      }

      const picked = pickRceptNo(filings, plan.report_type, plan.year);
      if (!picked?.rcept_no) {
        return formatToolResult(
          {
            ...identity,
            error: `No ${plan.report_type} report found for ${ticker}${plan.year != null ? ` (${plan.year})` : ''}`,
            availableReports: filings.map((f) => f.report_nm).filter(Boolean).slice(0, 20),
          },
          listUrl ? [listUrl] : [],
        );
      }
      const rceptNo = String(picked.rcept_no);
      const reportNm = String(picked.report_nm ?? '');

      // 3. Fetch + parse the document body (cached).
      onProgress?.(`Reading ${reportNm}...`);
      let extracted: ExtractedSections;
      try {
        extracted = await getOrExtractSections(rceptNo, plan.sections as SectionCategory[]);
      } catch (error) {
        return formatToolResult(
          { ...identity, report_nm: reportNm, rcept_no: rceptNo, error: 'Failed to read DART document', details: errMsg(error) },
          listUrl ? [listUrl] : [],
        );
      }

      const sourceUrls = [extracted.url, listUrl].filter(Boolean);
      const found = Object.keys(extracted.sections);
      if (found.length === 0) {
        return formatToolResult(
          {
            ...identity,
            report_nm: reportNm,
            rcept_no: rceptNo,
            sections_found: [],
            availableTitles: extracted.allTitles,
            note: 'Requested narrative sections were not located in this report. See availableTitles and retry with a different focus, or use get_financials_kr for numeric data.',
          },
          sourceUrls,
        );
      }

      // 4. Persist raw sections for drill-down.
      const rawSectionsFile = persistRawSections(
        { ...identity, report_nm: reportNm, rcept_no: rceptNo },
        extracted.sections,
      );

      // 5. Summarize (grounded analyst answer).
      onProgress?.('Summarizing report narrative...');
      let summary: string;
      try {
        const systemPrompt = escapeTemplateVars(
          buildSummaryPrompt(resolved.corp_name, reportNm, rceptNo, buildSummaryInput(extracted.sections)),
        );
        const { response } = await callLlm(input.query, { model, systemPrompt });
        summary = typeof response === 'string' ? response : String(response);
      } catch (error) {
        return formatToolResult(
          {
            ...identity,
            report_nm: reportNm,
            rcept_no: rceptNo,
            sections_found: found,
            ...(rawSectionsFile ? { rawSectionsFile } : {}),
            _error: `summarization failed: ${errMsg(error)}`,
          },
          sourceUrls,
        );
      }

      return formatToolResult(
        {
          ...identity,
          report_nm: reportNm,
          rcept_no: rceptNo,
          sections_found: found,
          summary,
          ...(rawSectionsFile
            ? {
                rawSectionsFile,
                note: 'summary is grounded in the report narrative. Use read_file on rawSectionsFile for the full extracted sections.',
              }
            : {}),
        },
        sourceUrls,
      );
    },
  });
}
