# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Dexter is a CLI financial research agent (Claude Code-style TUI). Iterative tool-calling loop against frontier LLMs (OpenAI/Anthropic/Google/xAI/OpenRouter/Ollama) + finance tools (Financial Datasets API, SEC, web/X search).

Upstream: `github.com/virattt/dexter`. CalVer (`YYYY.M.D`).

## Commands

Runtime is **Bun** (not Node).

```bash
bun install           # postinstall runs playwright install chromium
bun start             # run the TUI
bun run dev           # watch mode
bun run typecheck     # tsc --noEmit — run before pushing
bun test              # full suite
bun test path.test.ts # single file
```

CI runs `typecheck` + `test` on push/PR.

## Traps to know

These bite without warning. Fix once you learn them.

- **TUI is `@mariozechner/pi-tui`, not Ink.** `src/index.tsx` has the `.tsx` extension for historical reasons; there is no JSX in the active CLI (`src/cli.ts`). `AGENTS.md` and `README.md` still say Ink — trust the code.
- **Tools are conditionally registered by env var** (`src/tools/registry.ts`). Missing `EXASEARCH_API_KEY` → exa just isn't a `web_search` candidate. Missing `FINANCIAL_DATASETS_API_KEY` → all `get_*` finance tools absent.
- **`your-` is treated as a placeholder.** `checkApiKeyExists` (`src/utils/env.ts`) ignores values starting with `your-`. Copying `env.example` without replacing values = "key missing" behavior.
- **Tool output shape feeds the UI.** `summarizeToolResult` in `src/cli.ts` switches on `tool` name and inspects `parsed.data` shape. New finance tools must return `{ data: ... }` and need a matching case here, or the UI shows stale status lines.
- **`concurrencySafe` flag.** Each tool declares it; the executor parallelizes safe tools and serializes unsafe ones (browser, stateful APIs). Wrong value = subtle race conditions.
- **`bun.lock` churn.** `postinstall` sometimes touches one line. Don't bundle it into feature PRs.

## Key contracts

- **Agent loop**: `src/agent/agent.ts`, default `maxIterations: 10`. Scratchpad (`scratchpad.ts`) is single source of truth for tool results within a query. Final answer is a separate LLM call **with no tools bound**.
- **Slash commands**: append to `SLASH_COMMANDS` in `src/commands/index.ts` + add a case in `handleSlashCommand` in `src/cli.ts`. Help text lives next to that switch.
- **Skills**: drop a directory with `SKILL.md` under `src/skills/`. Auto-discovered; no code change needed. Each skill runs at most once per query.
- **Anthropic provider**: uses explicit `cache_control` on system prompt for prompt caching. Don't break that path.
- **`.dexter/` directory**: gitignored. Holds `settings.json` (model + search preference), `RULES.md`, `HEARTBEAT.md`, `memos/`, and the future `cache/` for the KR ticker registry.

## Active Work / Roadmap

**Current focus**: Korean stock support. See README "🇰🇷 한국 주식 리서치" for the user-facing spec.

### Phase 1 — Data pipe
- [ ] `src/data/fetchers/dart-corp-codes.ts` — fetch + parse DART `corpCode.xml`
- [ ] `src/data/ticker-registry.ts` — cache, 7-day refresh, ticker/name → corp_code lookup
- [ ] `src/tools/finance-kr/get-financials-kr.ts` — first KR tool (DART 사업/분기/반기보고서)
- [ ] System prompt routing rules added to `src/agent/prompts.ts`

### Phase 2 — Disclosures
- [ ] `get_filings_kr` — DART 공시 검색
- [ ] `get_large_holders_kr` — 5%룰 (13F equivalent)
- [ ] `get_insider_trades_kr` — 임원·주요주주

### Phase 3 — Korea-specific
- [x] `get_foreign_ownership_kr` — 외국인 지분율. Source: **Naver mobile JSON** (`m.stock.naver.com/api/stock/{code}/trend`), keyless. Registered unconditionally.
- [x] `get_short_balance_kr` — 공매도 순보유잔고. Source: **KRX Data Marketplace login scrape** (bld `MDCSTAT30502`). Needs `KRX_ID`/`KRX_PW` (anonymous access returns `LOGOUT` since 2024–25). Ticker→ISIN via `MDCSTAT01901` (`src/data/krx-instrument-registry.ts`). Login flow ported from pykrx in `src/tools/finance-kr/krx-session.ts`.
- [x] `get_nps_holdings` — 국민연금 보유. Source: **data.go.kr odcloud** dataset 3070507 (year-end snapshot, not quarterly). Needs `DATA_GO_KR_SERVICE_KEY` (Decoded key). No ticker column → matches by Korean stock name.

**Phase 3 source notes** (the clean keyed-API assumption from Phases 1–2 did NOT hold):
- Official KRX Open API (`openapi.krx.co.kr`) has neither short nor foreign data; data.go.kr has no short/foreign open API. KRX getJsonData requires a member login now.
- KRX endpoints key on **ISIN** (`isuCd`), not the 6-digit ticker → the KRX instrument registry exists only for this.

### Phase 4 — Skill adaptation
- [ ] `src/skills/dcf` — branch on market (K-IFRS, 거래세, 배당세)
- [ ] New skill: 재벌 그룹 구조 / 물적분할 분석

### Decided
- No `aliases.json`. LLM's training data covers common Korean tickers; resolver handles canonical ticker → corp_code only.
- KR tools live as separate names (`*_kr` suffix), not as a `market` parameter. LLM routes based on ticker pattern + language.
- Master files (DART `corpCode.xml`, SEC `company_tickers.json`) are runtime-fetched + cached, not bundled in repo.

## Conventions

- TypeScript strict, ESM. Avoid `any`.
- Don't add logging unless asked. Don't create `*.md` docs unless asked.
- Comments only when *why* is non-obvious.
- Tests colocated as `*.test.ts`, Bun runner (Jest config is legacy).

## Stale docs

- `AGENTS.md` is upstream's contributor doc with drift (says Ink/React, entry `cli.tsx`).
- `README.md` mentions Ink in places. The 🇰🇷 section is current.
- When in doubt, read the code.
