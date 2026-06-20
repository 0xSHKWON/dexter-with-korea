import { DynamicStructuredTool, StructuredToolInterface } from '@langchain/core/tools';
import type { RunnableConfig } from '@langchain/core/runnables';
import { AIMessage, ToolCall } from '@langchain/core/messages';
import { z } from 'zod';
import { callLlm } from '../../model/llm.js';
import { formatToolResult } from '../types.js';
import { getCurrentDate } from '../../agent/prompts.js';
import { withTimeout, SUB_TOOL_TIMEOUT_MS } from '../finance/utils.js';
import { getBusinessReport } from './sub-tools/get-business-report.js';

export const GET_FINANCIALS_KR_DESCRIPTION = `
Intelligent meta-tool for retrieving Korean (KOSPI/KOSDAQ) listed company financial data from DART (Korea's official disclosure system). Takes a natural language query and routes to DART data sources.

## When to Use

- Any Korean stock query identified by a 6-digit ticker (e.g. 005930 = Samsung Electronics, 005380 = Hyundai Motor)
- 사업보고서 / 반기보고서 / 분기보고서 (annual / semiannual / quarterly statements)
- K-IFRS income statement, balance sheet, cash flow data
- Multi-year Korean financial trend analysis

## When NOT to Use

- US-listed stocks (use get_financials for AAPL, MSFT, etc.)
- Korean stock prices or news (Phase 2 — not yet implemented)
- 5%룰, 임원 거래, 국민연금 보유 (Phase 2/3 — not yet implemented)
- General web searches (use web_search)

## Usage Notes

- Call ONCE with the complete natural language query — the router handles internal complexity
- Ticker must be the 6-digit Korean code (e.g. 005930, not "005930.KS" or "삼성전자")
- Handles year inference: "작년", "올해", "지난 분기" — converts to bsns_year + reprt_code
- Returns a normalized per-period \`summary\` (revenue, operating profit, net income, EPS, assets/liabilities/equity, cash flow, capex, plus margins, ROE, FCF, YoY) in KRW. Full raw DART line items are saved to \`rawLineItemsFile\` for drill-down into non-standard accounts.
`.trim();

const KR_SUB_TOOLS: StructuredToolInterface[] = [getBusinessReport];
const KR_SUB_TOOL_MAP = new Map(KR_SUB_TOOLS.map((t) => [t.name, t]));

function formatSubToolName(name: string): string {
  return name.split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

function buildRouterPrompt(): string {
  return `You are a Korean financial data routing assistant.
Current date: ${getCurrentDate()}

Given a user's natural language query about a Korean (KOSPI/KOSDAQ) listed company, call the appropriate DART tool(s).

## Guidelines

1. **Ticker / name** — get_business_report_kr's \`ticker\` field accepts EITHER a 6-digit code OR a Korean company name; it resolves names to codes deterministically (DART registry / Naver). So:
   - If the user gave a 6-digit code, pass it (strip any ".KS"/".KQ" suffix → just the 6 digits).
   - Otherwise pass the company NAME verbatim (e.g. "삼성전자", "고려아연"). Do NOT guess a code from memory for less-common names — a wrong guess silently returns a different company.

2. **Report Type Selection** (report_type):
   - "사업보고서" / "annual" / "연간" → annual (reprt_code 11011, typically filed in March)
   - "반기보고서" / "반기" / "semiannual" → semiannual (11012, ~August)
   - "1분기" / "Q1" → quarterly_1 (11013, ~May)
   - "3분기" / "Q3" → quarterly_3 (11014, ~November)
   - DART does NOT publish a standalone Q2/Q4 report — Q2 data is inside the 반기보고서, Q4 inside the 사업보고서.

3. **Year Inference**:
   - "작년" / "last year" → year = currentYear - 1
   - "최근 사업보고서" → year = currentYear - 1 (annual reports for year N publish in March of year N+1)
   - "지난 5년" / "past 5 years" → period_count: 5, year: currentYear - 1

4. **Statement Scope (fs_div)**:
   - Default 'CFS' (연결재무제표, consolidated)
   - Use 'OFS' (개별재무제표) only if user explicitly asks for separate/non-consolidated

5. **Efficiency**: For multi-year trend questions, use period_count rather than calling multiple times.

Call the tool(s) now.`;
}

const InputSchema = z.object({
  query: z.string().describe('Natural language query about Korean company financial data'),
});

export function createGetFinancialsKr(model: string): DynamicStructuredTool {
  return new DynamicStructuredTool({
    name: 'get_financials_kr',
    description:
      'Korean (KOSPI/KOSDAQ) listed company financial data from DART. Takes a natural language query and routes to DART tools (사업/반기/분기보고서). Use for 6-digit Korean tickers (e.g. 005930).',
    schema: InputSchema,
    func: async (input, _runManager, config?: RunnableConfig) => {
      const onProgress = config?.metadata?.onProgress as ((msg: string) => void) | undefined;

      onProgress?.('Routing KR query...');
      const { response } = await callLlm(input.query, {
        model,
        systemPrompt: buildRouterPrompt(),
        tools: KR_SUB_TOOLS,
      });
      const aiMessage = response as AIMessage;

      const toolCalls = aiMessage.tool_calls as ToolCall[];
      if (!toolCalls || toolCalls.length === 0) {
        return formatToolResult({ error: 'No DART tools selected for query' }, []);
      }

      const toolNames = [...new Set(toolCalls.map((tc) => formatSubToolName(tc.name)))];
      onProgress?.(`Fetching from ${toolNames.join(', ')}...`);

      const results = await Promise.all(
        toolCalls.map(async (tc) => {
          try {
            const tool = KR_SUB_TOOL_MAP.get(tc.name);
            if (!tool) {
              throw new Error(`Tool '${tc.name}' not found`);
            }
            const rawResult = await withTimeout(tool.invoke(tc.args), SUB_TOOL_TIMEOUT_MS, tc.name);
            const result = typeof rawResult === 'string' ? rawResult : JSON.stringify(rawResult);
            const parsed = JSON.parse(result);
            return {
              tool: tc.name,
              args: tc.args,
              data: parsed.data,
              sourceUrls: parsed.sourceUrls || [],
              error: null as string | null,
            };
          } catch (error) {
            return {
              tool: tc.name,
              args: tc.args,
              data: null,
              sourceUrls: [],
              error: error instanceof Error ? error.message : String(error),
            };
          }
        }),
      );

      const combinedData: Record<string, unknown> = {};
      const allUrls = results.flatMap((r) => r.sourceUrls);

      for (const result of results.filter((r) => r.error === null)) {
        const ticker = (result.args as Record<string, unknown>).ticker as string | undefined;
        const key = ticker ? `${result.tool}_${ticker}` : result.tool;
        combinedData[key] = result.data;
      }

      const failed = results.filter((r) => r.error !== null);
      if (failed.length > 0) {
        combinedData._errors = failed.map((r) => ({
          tool: r.tool,
          args: r.args,
          error: r.error,
        }));
      }

      return formatToolResult(combinedData, allUrls);
    },
  });
}
