/**
 * Context compaction module — LLM summarization.
 *
 * Instead of dropping old tool results (losing information permanently),
 * this module asks a fast LLM to summarize all accumulated tool results
 * into a structured summary. The summary replaces the raw results in
 * subsequent iteration prompts while preserving key information.
 */

import { callLlm } from '../model/llm.js';
import { resolveProvider } from '../providers.js';
import type { TokenUsage } from './types.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Stop attempting compaction after this many consecutive failures. */
export const MAX_CONSECUTIVE_COMPACTION_FAILURES = 3;

/** Skip compaction when there are fewer tool results than this (clearing is fine). */
export const MIN_TOOL_RESULTS_FOR_COMPACTION = 3;

// ---------------------------------------------------------------------------
// Compaction prompt
// ---------------------------------------------------------------------------

const NO_TOOLS_PREAMBLE = `CRITICAL: Respond with TEXT ONLY. Do NOT call any tools.

- Do NOT use any tool calls. You already have all the context you need below.
- Tool calls will be REJECTED and will waste your only turn — you will fail the task.
- Your entire response must be plain text: an <analysis> block followed by a <summary> block.

`;

const ANALYSIS_INSTRUCTION = `Before providing your final summary, wrap your analysis in <analysis> tags to organize your thoughts and ensure you've covered all necessary points. In your analysis process:

1. Chronologically review each tool call and its results. For each, thoroughly identify:
   - What data was requested and why
   - Key data points, numbers, and findings returned
   - Any errors, empty results, or unexpected responses
   - How this data relates to the user's original query
2. Double-check for numerical accuracy and completeness, addressing each required element thoroughly.`;

const BASE_COMPACT_PROMPT = `Your task is to create a detailed summary of the research session below. This summary must preserve all important data, findings, and numerical results so that work can continue without losing context.

${ANALYSIS_INSTRUCTION}

Your summary should include the following sections:

1. Original Query and Intent: The user's exact request and what they are trying to learn or accomplish.
2. Key Concepts: Important tickers, companies, sectors, financial metrics, or technical concepts involved.
3. Data Retrieved: For each tool call, summarize the tool name, arguments, and key results. Preserve important data points.
4. Errors and Retries: Any tool failures, empty results, or retried calls and their outcomes.
5. Analysis Progress: What has been analyzed so far, what conclusions or comparisons have been reached.
6. Numerical Data: ALL key numbers retrieved — prices, revenue figures, margins, ratios, growth rates, estimates, dates. This section is critical; do not omit any numbers that were returned by tools.
7. Pending Data Needs: What data has NOT yet been retrieved that would be needed to fully answer the query.
8. Current Work State: What was being worked on when this summary was requested.
9. Recommended Next Steps: What tool calls or analysis should happen next to complete the answer.

Here's an example of how your output should be structured:

<example>
<analysis>
[Your thought process, ensuring all numerical data and findings are captured accurately]
</analysis>

<summary>
1. Original Query and Intent:
   [Detailed description of what the user asked]

2. Key Concepts:
   - [Ticker/concept 1]
   - [Ticker/concept 2]

3. Data Retrieved:
   - [tool_name(args)]: [Key findings and data points]
   - [tool_name(args)]: [Key findings and data points]

4. Errors and Retries:
   - [Error description and resolution, or "None"]

5. Analysis Progress:
   [What has been analyzed, comparisons made, conclusions reached]

6. Numerical Data:
   - [Ticker/metric]: [value] ([date/period])
   - [Ticker/metric]: [value] ([date/period])

7. Pending Data Needs:
   - [Data still needed]

8. Current Work State:
   [What was being worked on]

9. Recommended Next Steps:
   [Next actions to take]

</summary>
</example>

Please provide your summary based on the research session below, following this structure and ensuring precision and thoroughness — especially for numerical data.`;

const NO_TOOLS_TRAILER =
  '\n\nREMINDER: Do NOT call any tools. Respond with plain text only — ' +
  'an <analysis> block followed by a <summary> block. ' +
  'Tool calls will be rejected and you will fail the task.';

// ---------------------------------------------------------------------------
// Prompt builders
// ---------------------------------------------------------------------------

export function buildCompactionPrompt(query: string, toolResults: string): string {
  return `${NO_TOOLS_PREAMBLE}${BASE_COMPACT_PROMPT}

Original query: ${query}

Data retrieved from tool calls:
${toolResults}${NO_TOOLS_TRAILER}`;
}

/**
 * No-tools framing for the SALVAGE prompt. Deliberately NOT the compaction
 * preamble/trailer: those demand an <analysis>/<summary> block format, which is
 * correct for the internal compaction summary but would leak raw XML into the
 * user-facing final answer the salvage call produces.
 */
const NO_TOOLS_ANSWER_PREAMBLE = `CRITICAL: Respond with TEXT ONLY. Do NOT call any tools.

- Do NOT use any tool calls. You already have all the context you need below.
- Tool calls will be REJECTED and will waste your only turn — you will fail the task.
- Write the final answer directly as plain prose — no XML tags, no <analysis> or <summary> wrappers.

`;

const NO_TOOLS_ANSWER_TRAILER =
  '\n\nREMINDER: Do NOT call any tools and do NOT wrap the answer in XML blocks — ' +
  'respond with the plain-text final answer only.';

/**
 * The salvage prompt carries the scratchpad's full tool-result text, which is
 * NOT bounded by the per-turn context budgets (large results are persisted to
 * disk as previews in context but kept whole in the scratchpad — which also
 * keeps context tokens low enough that compaction never fires). Cap it here so
 * the salvage call can't overflow the main model's context or bill an unbounded
 * prompt: keep the head (early key data) and a larger tail (most recent results).
 */
export const SALVAGE_INPUT_MAX_CHARS = 150_000;
const SALVAGE_HEAD_CHARS = 30_000;

export function capSalvageInput(toolResults: string, maxChars = SALVAGE_INPUT_MAX_CHARS): string {
  if (toolResults.length <= maxChars) return toolResults;
  const tailChars = maxChars - SALVAGE_HEAD_CHARS;
  const omitted = toolResults.length - maxChars;
  return `${toolResults.slice(0, SALVAGE_HEAD_CHARS)}\n\n[... ${omitted.toLocaleString('en-US')} characters of tool output omitted for length — note in the answer that some retrieved data could not be included ...]\n\n${toolResults.slice(-tailChars)}`;
}

/**
 * Prompt for the iteration-limit salvage pass: one final NO-TOOLS call that turns
 * the scratchpad's accumulated tool results into a partial ANSWER instead of
 * discarding ten iterations of retrieved data behind a canned apology.
 */
export function buildSalvagePrompt(query: string, toolResults: string): string {
  return `${NO_TOOLS_ANSWER_PREAMBLE}You are finalizing a research session that reached its tool-call iteration limit. No more tools can run. Write the best FINAL ANSWER possible from the tool data below.

Rules:
- Answer the user's query directly, in the user's language.
- Ground every number in the tool data below — never invent values or fill gaps from memory.
- Start with one short line noting this is a partial answer because the tool-call limit was reached.
- End with a short "미확보 데이터" (data not retrieved) list naming exactly what could not be fetched, so the user knows what is missing.

Original query: ${query}

Data retrieved from tool calls:
${capSalvageInput(toolResults)}${NO_TOOLS_ANSWER_TRAILER}`;
}

// ---------------------------------------------------------------------------
// Summary formatting
// ---------------------------------------------------------------------------

/**
 * Strip the <analysis> drafting scratchpad and format the <summary> section.
 */
export function formatCompactSummary(rawSummary: string): string {
  let formatted = rawSummary;

  // Strip analysis section — it improves summary quality but has no value once written.
  formatted = formatted.replace(/<analysis>[\s\S]*?<\/analysis>/, '');

  // Extract and format summary section
  const summaryMatch = formatted.match(/<summary>([\s\S]*?)<\/summary>/);
  if (summaryMatch) {
    const content = summaryMatch[1] || '';
    formatted = formatted.replace(
      /<summary>[\s\S]*?<\/summary>/,
      `Summary:\n${content.trim()}`,
    );
  }

  // Clean up extra whitespace
  formatted = formatted.replace(/\n\n+/g, '\n\n');

  return formatted.trim();
}

/**
 * Build the message that frames the compaction summary for the LLM.
 */
export function buildCompactSummaryMessage(summary: string): string {
  const formatted = formatCompactSummary(summary);

  return `This session is being continued from a previous research session that ran out of context. The summary below covers the data retrieved and analysis performed so far.

${formatted}

Continue working toward answering the query without asking the user any further questions. Resume directly — do not acknowledge the summary, do not recap what was happening. Pick up the research as if the break never happened.`;
}

// ---------------------------------------------------------------------------
// Core compaction function
// ---------------------------------------------------------------------------

export interface CompactContextParams {
  /** Main model name (used to resolve provider and fast model). */
  model: string;
  /** System prompt for the compaction call. */
  systemPrompt: string;
  /** Original user query. */
  query: string;
  /** Full formatted tool results from the scratchpad. */
  toolResults: string;
  /** Abort signal for cancellation. */
  signal?: AbortSignal;
}

export interface CompactResult {
  /** Formatted summary ready for injection into the iteration prompt. */
  summary: string;
  /** Raw LLM response (for debugging / scratchpad logging). */
  rawSummary: string;
  /** Token usage of the compaction LLM call. */
  usage?: TokenUsage;
}

/**
 * One final no-tools call that turns the scratchpad's tool results into a partial
 * ANSWER when the agent hits its iteration limit. Uses the MAIN model (this is the
 * user-facing final answer, not an internal summary). Throws on failure — the
 * caller falls back to the canned limit notice.
 */
export async function salvagePartialAnswer(params: {
  model: string;
  query: string;
  toolResults: string;
  signal?: AbortSignal;
}): Promise<string> {
  const { model, query, toolResults, signal } = params;
  const result = await callLlm(buildSalvagePrompt(query, toolResults), { model, signal });
  let text = typeof result.response === 'string' ? result.response : String(result.response);
  // Defense in depth: a model conditioned on the compaction format may still emit
  // <analysis>/<summary> wrappers — strip them so raw XML never reaches the user.
  text = text.replace(/<analysis>[\s\S]*?<\/analysis>/g, '');
  text = text.replace(/<\/?summary>/g, '');
  if (!text.trim()) {
    throw new Error('Salvage returned empty response');
  }
  return text.trim();
}

/**
 * Summarize accumulated tool results into a structured summary using a fast LLM.
 * Throws on failure — caller is responsible for fallback to clearing.
 */
export async function compactContext(params: CompactContextParams): Promise<CompactResult> {
  const { model, systemPrompt, query, toolResults, signal } = params;

  // Resolve fast model for the current provider
  const provider = resolveProvider(model);
  const fastModel = provider.fastModel ?? model;

  // Build the compaction prompt
  const prompt = buildCompactionPrompt(query, toolResults);

  // Call LLM with no tools bound — callLlm returns string in this case
  const result = await callLlm(prompt, {
    model: fastModel,
    systemPrompt,
    signal,
  });

  const rawSummary = typeof result.response === 'string'
    ? result.response
    : String(result.response);

  if (!rawSummary.trim()) {
    throw new Error('Compaction returned empty response');
  }

  // Build the framed summary message
  const summary = buildCompactSummaryMessage(rawSummary);

  return {
    summary,
    rawSummary,
    usage: result.usage,
  };
}
