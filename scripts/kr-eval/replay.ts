// Record/replay at the tool-output layer.
//
// A live run's `done.toolCalls` already carries `{tool,args,result}` for every
// call, so recording is just dumping that array to a per-question fixture file.
// Replay swaps each real tool for a fixture-backed stub (via the Agent's
// `transformTools` hook) so the agent's LLM still chooses tools freely but gets
// byte-identical recorded outputs — pinning market data without touching fetch,
// KRX login, or cookies. The agent LLM stays live; only the data is pinned.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { DynamicStructuredTool, type StructuredToolInterface } from '@langchain/core/tools';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_ROOT = path.join(__dirname, 'fixtures');

/** One recorded tool call — mirrors the shape of `done.toolCalls` entries. */
export interface RecordedToolCall {
  tool: string;
  args: Record<string, unknown>;
  result: string;
}

export interface QuestionFixture {
  id: string;
  query: string;
  meta?: { model?: string };
  toolCalls: RecordedToolCall[];
}

/** Stable JSON: sort object keys recursively so arg ordering can't change the key. */
export function canonicalize(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = sortKeys((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

export function scenarioDir(scenario: string): string {
  return path.join(FIXTURES_ROOT, scenario);
}

export function fixturePath(scenario: string, id: string): string {
  return path.join(scenarioDir(scenario), `${id}.json`);
}

export function saveFixture(scenario: string, fixture: QuestionFixture): string {
  const dir = scenarioDir(scenario);
  fs.mkdirSync(dir, { recursive: true });
  const file = fixturePath(scenario, fixture.id);
  fs.writeFileSync(file, JSON.stringify(fixture, null, 2) + '\n', 'utf-8');
  return file;
}

export function loadFixture(scenario: string, id: string): QuestionFixture {
  const file = fixturePath(scenario, id);
  if (!fs.existsSync(file)) {
    throw new Error(
      `No fixture for "${id}" at ${file}. Record it first: KR_EVAL_MODE=record bun run scripts/kr-eval/runner.ts --question ${id}`,
    );
  }
  return JSON.parse(fs.readFileSync(file, 'utf-8')) as QuestionFixture;
}

/** Sentinel result returned when the agent calls a tool with no recorded output. */
export function replayMissResult(toolName: string): string {
  return JSON.stringify({ data: {}, _replay_miss: true, tool: toolName });
}

export interface Replayer {
  /** Pass as AgentConfig.transformTools — replaces every real tool with a stub. */
  transformTools: (tools: StructuredToolInterface[]) => StructuredToolInterface[];
  /** Tool names the agent called in replay that had no recorded output (populated during the run). */
  misses: string[];
}

/**
 * Build a replayer for one question's fixture. Every tool is stubbed so no live
 * network can happen in replay. Match policy per call:
 *   1. exact canonical-args match → that recorded result
 *   2. else first recorded call of the same tool (KR questions are single-ticker)
 *   3. else a `_replay_miss` sentinel, and the tool name is pushed to `misses`
 */
export function createReplayer(fixture: QuestionFixture): Replayer {
  const misses: string[] = [];

  // Index recorded calls by tool name, preserving order.
  const byTool = new Map<string, RecordedToolCall[]>();
  for (const call of fixture.toolCalls) {
    const list = byTool.get(call.tool) ?? [];
    list.push(call);
    byTool.set(call.tool, list);
  }

  const resolve = (toolName: string, input: unknown): string => {
    const calls = byTool.get(toolName);
    if (!calls || calls.length === 0) {
      misses.push(toolName);
      return replayMissResult(toolName);
    }
    const args = (input ?? {}) as Record<string, unknown>;
    // 1. exact args match.
    const exact = calls.find((c) => canonicalize(c.args) === canonicalize(args));
    if (exact) return exact.result;
    // 2. match on the entity key (ticker) so a multi-ticker tool doesn't return
    //    another ticker's data when only secondary args (limit, dates) differ.
    if (args.ticker !== undefined) {
      const byTicker = calls.find((c) => c.args?.ticker === args.ticker);
      if (byTicker) return byTicker.result;
    }
    // 3. fall back to the first recorded call (KR questions are single-entity).
    return calls[0].result;
  };

  const transformTools = (tools: StructuredToolInterface[]): StructuredToolInterface[] =>
    tools.map(
      (real) =>
        new DynamicStructuredTool({
          name: real.name,
          description: real.description,
          schema: real.schema,
          func: async (input: Record<string, unknown>): Promise<string> => resolve(real.name, input),
        }),
    );

  return { transformTools, misses };
}
