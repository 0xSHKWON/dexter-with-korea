/**
 * Rich description for the web_search tool.
 * Used in the system prompt to guide the LLM on when and how to use this tool.
 */
export const WEB_SEARCH_DESCRIPTION = `
Search the web for current information on any topic. Returns relevant search results with URLs and content snippets.

## When to Use

- Factual questions about entities (companies, people, organizations) where status can change
- Current events, breaking news, recent developments
- Technology updates, product announcements, industry trends
- Verifying claims about real-world state (public/private, active/defunct, current leadership)
- Research on topics outside of structured financial data

## When NOT to Use

- Stock prices, market data, valuation multiples (use get_market_data / get_market_data_kr)
- Structured financial data (company financials, SEC filings, key ratios - use get_financials instead)
- Pure conceptual/definitional questions ("What is a DCF?")

## Usage Notes

- Provide specific, well-formed search queries for best results
- Returns up to 5 results with URLs and content snippets
- Use for supplementary research when get_financials doesn't cover the topic
- Search-derived NUMBERS are provisional: cite them with (source, date), prefer an authoritative tool (DART/거래소/ECOS) for the same value when one exists, and never let an undated search figure enter a valuation or table silently
`.trim();

export { tavilySearch } from './tavily.js';
export { exaSearch } from './exa.js';
export { perplexitySearch } from './perplexity.js';
export { langSearch } from './langsearch.js';
export { xSearchTool, X_SEARCH_DESCRIPTION } from './x-search.js';
