# Repository Guidelines

- Repo: https://github.com/virattt/dexter
- Dexter is a CLI-based AI agent for deep financial research, built with TypeScript, a terminal UI (`@mariozechner/pi-tui`), and LangChain.

## Project Structure

- Source code: `src/`
  - Agent core: `src/agent/` (agent loop, prompts, scratchpad, token counting, types)
  - CLI interface: `src/cli.ts` (pi-tui; no JSX), entry point: `src/index.tsx` (the `.tsx` extension is historical)
  - Components: `src/components/` (pi-tui UI components, plain `.ts`)
  - Model/LLM: `src/model/llm.ts` (multi-provider LLM abstraction)
  - Tools: `src/tools/` (financial data, web search, browser, skill tool)
  - Tool descriptions: `src/tools/descriptions/` (rich descriptions injected into system prompt)
  - Finance tools: `src/tools/finance/` (prices, fundamentals, filings, insider trades, etc.)
  - Korean tools: `src/tools/finance-kr/` (DART/KRX/Naver — financials, filings, foreign ownership, short balance, NPS, market data)
  - Search tools: `src/tools/search/` (Exa → Perplexity → Tavily → LangSearch fallback chain)
  - Browser: `src/tools/browser/` (Playwright-based web scraping)
  - Skills: `src/skills/` (SKILL.md-based extensible workflows, e.g. DCF valuation)
  - Utils: `src/utils/` (env, config, caching, token estimation, markdown tables)
  - Evals: `src/evals/` (LangSmith evaluation runner). KR eval harness: `scripts/kr-eval/` (record/replay + LLM-judge)
- Config: `.dexter/settings.json` (persisted model/provider selection)
- Environment: `.env` (API keys; see `env.example`)
- Scripts: `scripts/release.sh`

## Build, Test, and Development Commands

- Runtime: Bun (primary). Use `bun` for all commands.
- Install deps: `bun install`
- Run: `bun start`
- Dev (watch mode): `bun run dev`
- Type-check: `bun run typecheck`
- Tests: `bun test`
- Evals: `bun run src/evals/run.ts` (full) or `bun run src/evals/run.ts --sample 10` (sampled)
- KR evals: `bun run kr-eval` (live) / `kr-eval:record` / `kr-eval:replay` (deterministic, no keys)
- CI runs `bun run typecheck` and `bun test` on push/PR.

## Coding Style & Conventions

- Language: TypeScript (ESM, strict mode). The CLI renders via `@mariozechner/pi-tui` (no JSX in `src/cli.ts`).
- Prefer strict typing; avoid `any`.
- Keep files concise; extract helpers rather than duplicating code.
- Add brief comments for tricky or non-obvious logic.
- Do not add logging unless explicitly asked.
- Do not create README or documentation files unless explicitly asked.

## LLM Providers

- Supported: OpenAI (default), Anthropic, Google, xAI (Grok), OpenRouter, Moonshot, DeepSeek, Ollama (local).
- Default model: `gpt-5.5`. Provider detection is prefix-based (`claude-` -> Anthropic, `gemini-` -> Google, etc.).
- Fast models for lightweight tasks: see `FAST_MODELS` map in `src/model/llm.ts`.
- Anthropic uses explicit `cache_control` on system prompt for prompt caching cost savings.
- Users switch providers/models via `/model` command in the CLI.

## Tools

- `get_financials`: US financial statements, metrics, segments (Financial Datasets). Routes multi-company/metric queries internally.
- `get_market_data`: US prices, company news, insider trades, 13F holdings.
- `read_filings`: SEC filing reader for 10-K, 10-Q, 8-K documents.
- `stock_screener`: screen US stocks by financial criteria (P/E, growth, margins).
- Korean tools (`src/tools/finance-kr/`, all take 6-digit tickers): `get_financials_kr`, `get_filings_kr`, `get_large_holders_kr`, `get_insider_trades_kr`, `read_filings_kr` (DART, gated on `DART_API_KEY`); `get_market_data_kr`, `get_foreign_ownership_kr` (Naver, keyless); `get_short_balance_kr` (KRX login); `get_nps_holdings` (data.go.kr).
- `web_search`: general web search; provider fallback chain Exa → Perplexity → Tavily → LangSearch (registered if ≥1 key set).
- `browser`: Playwright-based web scraping for reading pages the agent discovers.
- `skill`: invokes SKILL.md-defined workflows (e.g. DCF valuation). Each skill runs at most once per query.
- Tool registry: `src/tools/registry.ts`. US finance + screener tools register unconditionally (they 401 at call-time without `FINANCIAL_DATASETS_API_KEY`); KR, web_search, and X tools are gated by their env vars.

## Skills

- Skills live as `SKILL.md` files with YAML frontmatter (`name`, `description`) and markdown body (instructions).
- Built-in skills (`src/skills/<name>/SKILL.md`): `dcf` (DCF valuation; branches US/KR internally), `kr-spinoff` (물적/인적분할 analysis), `write-memo`, `x-research`.
- Discovery: `src/skills/registry.ts` scans for SKILL.md files at startup.
- Skills are exposed to the LLM as metadata in the system prompt; the LLM invokes them via the `skill` tool.

## Agent Architecture

- Agent loop: `src/agent/agent.ts`. Iterative tool-calling loop with configurable max iterations (default 10).
- Scratchpad: `src/agent/scratchpad.ts`. Single source of truth for all tool results within a query.
- Context management: Anthropic-style. Full tool results kept in context; oldest results cleared when token threshold exceeded.
- Final answer: the text of the turn where the model stops emitting tool calls (`handleDirectResponse`). Tools stay bound on every call — there is no separate no-tools finalization pass, so answer quality is governed by the system prompt.
- Events: agent yields typed events (`tool_start`, `tool_end`, `thinking`, `answer_start`, `done`, etc.) for real-time UI updates.

## Environment Variables

- LLM keys: `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GOOGLE_API_KEY`, `XAI_API_KEY`, `OPENROUTER_API_KEY`, `MOONSHOT_API_KEY`, `DEEPSEEK_API_KEY`
- Ollama: `OLLAMA_BASE_URL` (default `http://127.0.0.1:11434`)
- US finance: `FINANCIAL_DATASETS_API_KEY`
- Korean data: `DART_API_KEY` (재무·공시), `KRX_ID`+`KRX_PW` or `KRX_COOKIE` (공매도), `DATA_GO_KR_SERVICE_KEY` (국민연금). Naver tools (외국인·현재가) need no key.
- Search: `EXASEARCH_API_KEY`, `PERPLEXITY_API_KEY`, `TAVILY_API_KEY`, `LANGSEARCH_API_KEY` (fallback chain in that order)
- Tracing: `LANGSMITH_API_KEY`, `LANGSMITH_ENDPOINT`, `LANGSMITH_PROJECT`, `LANGSMITH_TRACING`
- Never commit `.env` files or real API keys.

## Version & Release

- Version format: CalVer `YYYY.M.D` (no zero-padding). Tag prefix: `v`.
- Release script: `bash scripts/release.sh [version]` (defaults to today's date).
- Release flow: bump version in `package.json`, create git tag, push tag, create GitHub release via `gh`.
- Do not push or publish without user confirmation.

## Testing

- Framework: Bun's built-in test runner (primary), Jest config exists for legacy compatibility.
- Tests colocated as `*.test.ts`.
- Run `bun test` before pushing when you touch logic.

## Security

- API keys stored in `.env` (gitignored). Users can also enter keys interactively via the CLI.
- Config stored in `.dexter/settings.json` (gitignored).
- Never commit or expose real API keys, tokens, or credentials.
