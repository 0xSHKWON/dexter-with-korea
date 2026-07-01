import { StructuredToolInterface } from '@langchain/core/tools';
import { createGetFinancials, createGetMarketData, createReadFilings, createScreenStocks } from './finance/index.js';
import { exaSearch, perplexitySearch, tavilySearch, langSearch, WEB_SEARCH_DESCRIPTION, xSearchTool, X_SEARCH_DESCRIPTION } from './search/index.js';
import { createWebSearchTool, type WebSearchProvider } from './search/web-search.js';
import { getSetting } from '../utils/config.js';
import { checkApiKeyExists, hasDartKey, type SearchProviderId } from '../utils/env.js';
import { skillTool, SKILL_TOOL_DESCRIPTION } from './skill.js';
import { createWebFetch, WEB_FETCH_DESCRIPTION } from './fetch/web-fetch.js';
import { browserTool, BROWSER_DESCRIPTION } from './browser/browser.js';
import { readFileTool, READ_FILE_DESCRIPTION } from './filesystem/read-file.js';
import { writeFileTool, WRITE_FILE_DESCRIPTION } from './filesystem/write-file.js';
import { editFileTool, EDIT_FILE_DESCRIPTION } from './filesystem/edit-file.js';
import { GET_FINANCIALS_DESCRIPTION } from './finance/get-financials.js';
import { createGetFinancialsKr, GET_FINANCIALS_KR_DESCRIPTION } from './finance-kr/get-financials-kr.js';
import { getFilingsKr, GET_FILINGS_KR_DESCRIPTION } from './finance-kr/get-filings-kr.js';
import { getLargeHoldersKr, GET_LARGE_HOLDERS_KR_DESCRIPTION } from './finance-kr/get-large-holders-kr.js';
import { getInsiderTradesKr, GET_INSIDER_TRADES_KR_DESCRIPTION } from './finance-kr/get-insider-trades-kr.js';
import { createReadFilingsKr, READ_FILINGS_KR_DESCRIPTION } from './finance-kr/read-filings-kr.js';
import { getSegmentsKr, GET_SEGMENTS_KR_DESCRIPTION } from './finance-kr/get-segments-kr.js';
import { getShortBalanceKr, GET_SHORT_BALANCE_KR_DESCRIPTION } from './finance-kr/get-short-balance-kr.js';
import { getForeignOwnershipKr, GET_FOREIGN_OWNERSHIP_KR_DESCRIPTION } from './finance-kr/get-foreign-ownership-kr.js';
import { getMarketDataKr, GET_MARKET_DATA_KR_DESCRIPTION } from './finance-kr/get-market-data-kr.js';
import { getNpsHoldings_tool, GET_NPS_HOLDINGS_DESCRIPTION } from './finance-kr/get-nps-holdings.js';
import { getMacroRateKr, GET_MACRO_RATE_KR_DESCRIPTION } from './finance-kr/get-macro-rate-kr.js';
import { GET_MARKET_DATA_DESCRIPTION } from './finance/get-market-data.js';
import { READ_FILINGS_DESCRIPTION } from './finance/read-filings.js';
import { SCREEN_STOCKS_DESCRIPTION } from './finance/screen-stocks.js';
import { heartbeatTool, HEARTBEAT_TOOL_DESCRIPTION } from './heartbeat/heartbeat-tool.js';
import { cronTool, CRON_TOOL_DESCRIPTION } from './cron/cron-tool.js';
import { memoryGetTool, MEMORY_GET_DESCRIPTION, memorySearchTool, MEMORY_SEARCH_DESCRIPTION, memoryUpdateTool, MEMORY_UPDATE_DESCRIPTION } from './memory/index.js';
import { discoverSkills } from '../skills/index.js';
import { createSpawnSubagent, SPAWN_SUBAGENT_DESCRIPTION } from './subagent/spawn-subagent.js';
import { createAskUserQuestion, ASK_USER_QUESTION_DESCRIPTION } from './ask-user-question/ask-user-question.js';

/**
 * A registered tool with its rich description for system prompt injection.
 */
export interface RegisteredTool {
  /** Tool name (must match the tool's name property) */
  name: string;
  /** The actual tool instance */
  tool: StructuredToolInterface;
  /** Rich description for system prompt (includes when to use, when not to use, etc.) */
  description: string;
  /** 1-2 sentence description for token-optimized system prompts. */
  compactDescription: string;
  /** Whether this tool can safely execute concurrently with other concurrent-safe tools. */
  concurrencySafe: boolean;
}

/**
 * Get all registered tools with their descriptions.
 * Conditionally includes tools based on environment configuration.
 *
 * @param model - The model name (needed for tools that require model-specific configuration)
 * @returns Array of registered tools
 */
export function getToolRegistry(model: string): RegisteredTool[] {
  const tools: RegisteredTool[] = [
    {
      name: 'get_financials',
      tool: createGetFinancials(model),
      description: GET_FINANCIALS_DESCRIPTION,
      compactDescription: 'Financial statements and metrics. Handles multi-company/multi-metric queries in one call.',
      concurrencySafe: true,
    },
    {
      name: 'get_market_data',
      tool: createGetMarketData(model),
      description: GET_MARKET_DATA_DESCRIPTION,
      compactDescription: 'Stock/crypto prices, company news, and insider trades. Handles multi-asset queries in one call.',
      concurrencySafe: true,
    },
    {
      name: 'read_filings',
      tool: createReadFilings(model),
      description: READ_FILINGS_DESCRIPTION,
      compactDescription: 'SEC filings (10-K, 10-Q, 8-K). Extracts and summarizes specific filing sections.',
      concurrencySafe: true,
    },
    {
      name: 'stock_screener',
      tool: createScreenStocks(model),
      description: SCREEN_STOCKS_DESCRIPTION,
      compactDescription: 'Screen stocks by financial criteria (P/E, growth, margins, etc.).',
      concurrencySafe: true,
    },
    {
      name: 'spawn_subagent',
      tool: createSpawnSubagent(model),
      description: SPAWN_SUBAGENT_DESCRIPTION,
      compactDescription: 'Delegate a focused sub-task to an isolated subagent. Emit multiple calls in one turn to run independent sub-tasks in parallel.',
      concurrencySafe: true,
    },
    {
      name: 'ask_user_question',
      tool: createAskUserQuestion(),
      description: ASK_USER_QUESTION_DESCRIPTION,
      compactDescription: 'Ask the user 1-4 multiple-choice questions mid-turn and wait for their answers (CLI + desktop).',
      concurrencySafe: false,
    },
    {
      name: 'web_fetch',
      tool: createWebFetch(model),
      description: WEB_FETCH_DESCRIPTION,
      compactDescription: 'Fetch a URL and answer a prompt about its content (HTML→markdown, fast-model summarized).',
      concurrencySafe: true,
    },
    {
      name: 'browser',
      tool: browserTool,
      description: BROWSER_DESCRIPTION,
      compactDescription: 'JavaScript-rendered pages and interactive navigation. Actions: navigate, snapshot, act, read, close.',
      concurrencySafe: true,
    },
    {
      name: 'read_file',
      tool: readFileTool,
      description: READ_FILE_DESCRIPTION,
      compactDescription: 'Read a local file by path. Returns file content as text.',
      concurrencySafe: true,
    },
    {
      name: 'write_file',
      tool: writeFileTool,
      description: WRITE_FILE_DESCRIPTION,
      compactDescription: 'Create or overwrite a file. Requires user approval.',
      concurrencySafe: false,
    },
    {
      name: 'edit_file',
      tool: editFileTool,
      description: EDIT_FILE_DESCRIPTION,
      compactDescription: 'Edit a file by replacing text. Requires user approval.',
      concurrencySafe: false,
    },
    {
      name: 'heartbeat',
      tool: heartbeatTool,
      description: HEARTBEAT_TOOL_DESCRIPTION,
      compactDescription: 'View or update the periodic heartbeat checklist (.dexter/HEARTBEAT.md).',
      concurrencySafe: true,
    },
    {
      name: 'cron',
      tool: cronTool,
      description: CRON_TOOL_DESCRIPTION,
      compactDescription: 'Manage scheduled cron jobs (create, list, update, delete).',
      concurrencySafe: true,
    },
    {
      name: 'memory_search',
      tool: memorySearchTool,
      description: MEMORY_SEARCH_DESCRIPTION,
      compactDescription: 'Search persistent memory and past conversations for stored facts and preferences.',
      concurrencySafe: true,
    },
    {
      name: 'memory_get',
      tool: memoryGetTool,
      description: MEMORY_GET_DESCRIPTION,
      compactDescription: 'Read specific memory file sections by line range.',
      concurrencySafe: true,
    },
    {
      name: 'memory_update',
      tool: memoryUpdateTool,
      description: MEMORY_UPDATE_DESCRIPTION,
      compactDescription: 'Add, edit, or delete persistent memory entries.',
      concurrencySafe: false,
    },
  ];

  // Build web_search as a fallback chain over whichever providers have keys configured.
  // The user's preferred provider (set via /search) is tried first; the others act as fallbacks.
  // checkApiKeyExists ignores empty and `your-` placeholder values — otherwise a
  // copied env.example registers a web_search tool that 401s on every call.
  const allWebSearchProviders: WebSearchProvider[] = [];
  if (checkApiKeyExists('EXASEARCH_API_KEY')) {
    allWebSearchProviders.push({ id: 'exa', name: 'Exa', tool: exaSearch });
  }
  if (checkApiKeyExists('PERPLEXITY_API_KEY')) {
    allWebSearchProviders.push({ id: 'perplexity', name: 'Perplexity', tool: perplexitySearch });
  }
  if (checkApiKeyExists('TAVILY_API_KEY')) {
    allWebSearchProviders.push({ id: 'tavily', name: 'Tavily', tool: tavilySearch });
  }
  if (checkApiKeyExists('LANGSEARCH_API_KEY')) {
    allWebSearchProviders.push({ id: 'langsearch', name: 'LangSearch', tool: langSearch });
  }

  if (allWebSearchProviders.length > 0) {
    const preferred = getSetting<SearchProviderId | undefined>('webSearchPreferredProvider', undefined);
    const orderedProviders = preferred
      ? [
          ...allWebSearchProviders.filter((p) => p.id === preferred),
          ...allWebSearchProviders.filter((p) => p.id !== preferred),
        ]
      : allWebSearchProviders;

    tools.push({
      name: 'web_search',
      tool: createWebSearchTool(orderedProviders),
      description: WEB_SEARCH_DESCRIPTION,
      compactDescription: 'Search the web for current information. Returns titles, URLs, and snippets.',
      concurrencySafe: true,
    });
  }

  if (hasDartKey()) {
    tools.push({
      name: 'get_financials_kr',
      tool: createGetFinancialsKr(model),
      description: GET_FINANCIALS_KR_DESCRIPTION,
      compactDescription: 'Korean stocks (6-digit tickers like 005930). DART 사업·반기·분기보고서 (K-IFRS).',
      concurrencySafe: true,
    });
    tools.push({
      name: 'get_filings_kr',
      tool: getFilingsKr,
      description: GET_FILINGS_KR_DESCRIPTION,
      compactDescription: 'Korean stock DART 공시 (filings) metadata for 6-digit tickers. Disclosure history and report search.',
      concurrencySafe: true,
    });
    tools.push({
      name: 'get_large_holders_kr',
      tool: getLargeHoldersKr,
      description: GET_LARGE_HOLDERS_KR_DESCRIPTION,
      compactDescription: 'Korean 5%룰 대량보유 major shareholders for 6-digit tickers (13F-equivalent).',
      concurrencySafe: true,
    });
    tools.push({
      name: 'get_insider_trades_kr',
      tool: getInsiderTradesKr,
      description: GET_INSIDER_TRADES_KR_DESCRIPTION,
      compactDescription: 'Korean 임원·주요주주 소유보고 (insider/executive ownership) for 6-digit tickers.',
      concurrencySafe: true,
    });
    tools.push({
      name: 'read_filings_kr',
      tool: createReadFilingsKr(model),
      description: READ_FILINGS_KR_DESCRIPTION,
      compactDescription:
        'Korean DART 사업·반기·분기보고서 narrative (사업의 내용, 위험관리, 경영진단 MD&A, 지배구조·최대주주·계열회사) — qualitative content for 6-digit tickers or names.',
      concurrencySafe: true,
    });
    tools.push({
      name: 'get_segments_kr',
      tool: getSegmentsKr,
      description: GET_SEGMENTS_KR_DESCRIPTION,
      compactDescription:
        'Korean 사업부문별 요약 재무현황 (segment 매출액·영업이익·비중) from the latest DART 정기보고서 — divisional mix for 재벌/복합 기업 (6-digit tickers or names).',
      concurrencySafe: true,
    });
  }

  // 외국인 지분율 comes from Naver's keyless JSON API — always available.
  tools.push({
    name: 'get_foreign_ownership_kr',
    tool: getForeignOwnershipKr,
    description: GET_FOREIGN_OWNERSHIP_KR_DESCRIPTION,
    compactDescription: 'Korean 외국인 지분율 (foreign ownership ratio), daily, for 6-digit tickers.',
    concurrencySafe: true,
  });

  // Price + valuation + consensus snapshot, also from Naver's keyless API.
  tools.push({
    name: 'get_market_data_kr',
    tool: getMarketDataKr,
    description: GET_MARKET_DATA_KR_DESCRIPTION,
    compactDescription:
      'Korean price + market cap + PER/PBR + 목표주가 컨센서스 snapshot for 6-digit tickers (get_market_data equivalent).',
    concurrencySafe: true,
  });

  // 공매도 잔고 requires a KRX Data Marketplace login — either a native ID/PW
  // or a pasted session cookie (KRX_COOKIE) for social-login accounts.
  const hasKrxIdPw =
    !!process.env.KRX_ID &&
    !!process.env.KRX_PW &&
    !process.env.KRX_ID.startsWith('your-') &&
    !process.env.KRX_PW.startsWith('your-');
  const hasKrxCookie =
    !!process.env.KRX_COOKIE && !process.env.KRX_COOKIE.startsWith('your-');
  if (hasKrxIdPw || hasKrxCookie) {
    tools.push({
      name: 'get_short_balance_kr',
      tool: getShortBalanceKr,
      description: GET_SHORT_BALANCE_KR_DESCRIPTION,
      compactDescription: 'Korean 공매도 잔고 (short-selling balance / short interest), daily, for 6-digit tickers.',
      concurrencySafe: true,
    });
  }

  // 국민연금 holdings come from data.go.kr (odcloud) with a service key.
  if (
    process.env.DATA_GO_KR_SERVICE_KEY &&
    !process.env.DATA_GO_KR_SERVICE_KEY.startsWith('your-')
  ) {
    tools.push({
      name: 'get_nps_holdings',
      tool: getNpsHoldings_tool,
      description: GET_NPS_HOLDINGS_DESCRIPTION,
      compactDescription: 'Korean National Pension Service (국민연금) equity holdings by stock name or 6-digit ticker.',
      concurrencySafe: true,
    });
  }

  // 한국은행 ECOS macro rates (국고채 Rf, 원/달러, 기준금리) — keyed, replaces web_search.
  if (process.env.ECOS_API_KEY && !process.env.ECOS_API_KEY.startsWith('your-')) {
    tools.push({
      name: 'get_macro_rate_kr',
      tool: getMacroRateKr,
      description: GET_MACRO_RATE_KR_DESCRIPTION,
      compactDescription:
        'Korean macro rates from 한국은행 ECOS — 국고채 수익률(DCF Rf), 원/달러 환율, 기준금리.',
      concurrencySafe: true,
    });
  }

  if (process.env.X_BEARER_TOKEN) {
    tools.push({
      name: 'x_search',
      tool: xSearchTool,
      description: X_SEARCH_DESCRIPTION,
      compactDescription: 'Search X/Twitter for tweets, profiles, and threads.',
      concurrencySafe: true,
    });
  }

  const availableSkills = discoverSkills();
  if (availableSkills.length > 0) {
    tools.push({
      name: 'skill',
      tool: skillTool,
      description: SKILL_TOOL_DESCRIPTION,
      compactDescription: 'Invoke a specialized skill workflow (e.g., DCF valuation).',
      concurrencySafe: false,
    });
  }

  return tools;
}

/**
 * Build a name → concurrencySafe map for the tool executor.
 */
export function getToolConcurrencyMap(model: string): Map<string, boolean> {
  return new Map(getToolRegistry(model).map(t => [t.name, t.concurrencySafe]));
}

/**
 * Get just the tool instances for binding to the LLM.
 *
 * @param model - The model name
 * @returns Array of tool instances
 */
export function getTools(model: string): StructuredToolInterface[] {
  return getToolRegistry(model).map((t) => t.tool);
}

/**
 * Build the tool descriptions section for the system prompt.
 * Formats each tool's rich description with a header.
 *
 * @param model - The model name
 * @returns Formatted string with all tool descriptions
 */
/**
 * Build compact tool descriptions for token-optimized system prompts.
 * Uses 1-2 sentence descriptions instead of full multi-paragraph ones.
 * The LLM already has full tool schemas via bindTools().
 */
export function buildCompactToolDescriptions(model: string): string {
  return getToolRegistry(model)
    .map((t) => `- **${t.name}**: ${t.compactDescription}`)
    .join('\n');
}
