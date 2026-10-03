/**
 * Runs one agent turn inside a Claude Code session (`claude -p`, stream-json).
 *
 * Claude Code drives the tool loop; Dexter's tools are served to it from this
 * process over MCP (claude-code/mcp-server.ts) and executed by the caller's
 * `executeTool`, so tool events, approvals, and the scratchpad behave exactly
 * as in the native loop. This generator merges both event sources — tool
 * events from MCP calls and text/progress from Claude Code's stdout — into
 * the usual AgentEvent stream.
 */
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import type { StructuredToolInterface } from '@langchain/core/tools';
import { convertToOpenAITool } from '@langchain/core/utils/function_calling';
import {
  baseClaudeArgs,
  claudeEnv,
  claudeScratchDir,
  requireClaudeBinary,
  type ClaudeResultMessage,
} from '../claude-code/cli.js';
import { startMcpServer, type McpToolResult } from '../claude-code/mcp-server.js';
import { buildPersistedContent, exceedsSizeCap, persistLargeResult } from '../utils/tool-result-storage.js';
import type { AgentEvent, TokenUsage } from './types.js';

const MCP_SERVER_NAME = 'dexter';

export interface ClaudeCodeTurnParams {
  model: string;
  /** `claude --effort` level (low | medium | high | xhigh | max); unset = Claude Code's default. */
  effort?: string;
  systemPrompt: string;
  prompt: string;
  tools: StructuredToolInterface[];
  signal?: AbortSignal;
  /** Run one tool call through the host's executor; yields its events. */
  executeTool(name: string, args: Record<string, unknown>, callId: string): AsyncGenerator<AgentEvent>;
}

export interface ClaudeCodeTurnResult {
  answer: string;
  isError: boolean;
  numTurns: number;
  usage?: TokenUsage;
}

/** Unbounded async queue fed from callbacks, drained by the generator. */
function createQueue<T>() {
  const items: T[] = [];
  let wake: (() => void) | null = null;
  return {
    push(item: T) {
      items.push(item);
      wake?.();
      wake = null;
    },
    async next(): Promise<T> {
      while (items.length === 0) await new Promise<void>((r) => (wake = r));
      return items.shift()!;
    },
  };
}

type Item = { kind: 'event'; event: AgentEvent } | { kind: 'end'; result: ClaudeCodeTurnResult } | { kind: 'fail'; error: Error };

interface StreamLine {
  type: string;
  subtype?: string;
  event?: { type?: string; delta?: { type?: string; text?: string; thinking?: string; partial_json?: string } };
  message?: { content?: { type: string; text?: string }[] };
  mcp_servers?: { name: string; status: string }[];
}

export async function* runClaudeCodeTurn(p: ClaudeCodeTurnParams): AsyncGenerator<AgentEvent, ClaudeCodeTurnResult> {
  const bin = requireClaudeBinary();
  const queue = createQueue<Item>();
  let callSeq = 0;

  const toolDefs = p.tools.map((t) => {
    const fn = convertToOpenAITool(t).function;
    return {
      name: fn.name,
      description: fn.description ?? '',
      inputSchema: (fn.parameters as Record<string, unknown>) ?? { type: 'object', properties: {} },
    };
  });

  const server = await startMcpServer(toolDefs, async (name, args): Promise<McpToolResult> => {
    const callId = `mcp_${++callSeq}`;
    let outcome: McpToolResult = { text: 'Tool produced no result.', isError: true };
    for await (const event of p.executeTool(name, args, callId)) {
      queue.push({ kind: 'event', event });
      if (event.type === 'tool_end') {
        if (exceedsSizeCap(event.result)) {
          const { filePath, preview } = persistLargeResult(name, callId, event.result);
          outcome = { text: buildPersistedContent(filePath, preview, event.result.length) };
        } else {
          outcome = { text: event.result };
        }
      } else if (event.type === 'tool_error') {
        outcome = { text: `Error: ${event.error}`, isError: true };
      } else if (event.type === 'tool_denied') {
        outcome = { text: 'The user denied this tool call. Do not retry it.', isError: true };
      }
    }
    return outcome;
  });

  const mcpConfig = {
    mcpServers: {
      [MCP_SERVER_NAME]: { type: 'http', url: server.url, headers: { Authorization: `Bearer ${server.token}` } },
    },
  };
  const args = [
    ...baseClaudeArgs(p.model, p.systemPrompt),
    '--output-format',
    'stream-json',
    '--verbose',
    '--include-partial-messages',
    '--mcp-config',
    JSON.stringify(mcpConfig),
    '--strict-mcp-config',
    // Pre-approve Dexter's tools: headless mode has no one to answer Claude Code's
    // own permission prompt. Dexter's executor still applies its own approvals.
    '--allowedTools',
    `mcp__${MCP_SERVER_NAME}`,
    ...(p.effort ? ['--effort', p.effort] : []),
  ];

  const child = spawn(bin, args, {
    cwd: claudeScratchDir(),
    env: claudeEnv({
      // Filings/DCF tools can run for minutes and return large tables.
      MCP_TOOL_TIMEOUT: '900000',
      MAX_MCP_OUTPUT_TOKENS: '60000',
    }),
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const onAbort = () => child.kill();
  p.signal?.addEventListener('abort', onAbort, { once: true });

  let result: ClaudeResultMessage | null = null;
  let stderr = '';
  child.stderr.on('data', (d: Buffer) => (stderr += d.toString()));

  createInterface({ input: child.stdout }).on('line', (line) => {
    let msg: StreamLine;
    try {
      msg = JSON.parse(line) as StreamLine;
    } catch {
      return;
    }
    if (msg.type === 'system' && msg.subtype === 'init') {
      const dexter = msg.mcp_servers?.find((s) => s.name === MCP_SERVER_NAME);
      if (dexter && dexter.status !== 'connected') {
        queue.push({ kind: 'event', event: { type: 'thinking', message: `⚠️ Dexter tools unavailable to Claude Code (${dexter.status})` } });
      }
    } else if (msg.type === 'stream_event') {
      const delta = msg.event?.type === 'content_block_delta' ? msg.event.delta : undefined;
      if (delta?.type === 'text_delta' && delta.text) {
        queue.push({ kind: 'event', event: { type: 'text_delta', text: delta.text } });
        queue.push({ kind: 'event', event: { type: 'stream_progress', charDelta: delta.text.length, mode: 'responding' } });
      } else if (delta?.type === 'thinking_delta') {
        queue.push({ kind: 'event', event: { type: 'stream_progress', charDelta: delta.thinking?.length ?? 0, mode: 'thinking' } });
      } else if (delta?.type === 'input_json_delta') {
        queue.push({ kind: 'event', event: { type: 'stream_progress', charDelta: delta.partial_json?.length ?? 0, mode: 'tool-input' } });
      }
    } else if (msg.type === 'assistant') {
      // Text that accompanies tool calls is reasoning, as in the native loop.
      const blocks = msg.message?.content ?? [];
      const text = blocks.filter((b) => b.type === 'text').map((b) => b.text ?? '').join('\n').trim();
      if (text && blocks.some((b) => b.type === 'tool_use')) {
        queue.push({ kind: 'event', event: { type: 'thinking', message: text } });
      }
    } else if (msg.type === 'result') {
      result = msg as unknown as ClaudeResultMessage;
    }
  });

  child.on('error', (error) => queue.push({ kind: 'fail', error }));
  child.on('close', (code) => {
    p.signal?.removeEventListener('abort', onAbort);
    server.close();
    if (p.signal?.aborted) {
      queue.push({ kind: 'fail', error: new Error('Aborted') });
      return;
    }
    const r = result as ClaudeResultMessage | null;
    if (!r) {
      queue.push({ kind: 'fail', error: new Error(`Claude Code exited (${code}): ${stderr.trim().slice(0, 500) || 'no output'}`) });
      return;
    }
    const input = (r.usage?.input_tokens ?? 0) + (r.usage?.cache_read_input_tokens ?? 0) + (r.usage?.cache_creation_input_tokens ?? 0);
    const output = r.usage?.output_tokens ?? 0;
    queue.push({
      kind: 'end',
      result: {
        answer: r.result ?? '',
        isError: r.is_error,
        numTurns: r.num_turns ?? 1,
        usage: { inputTokens: input, outputTokens: output, totalTokens: input + output },
      },
    });
  });

  yield { type: 'stream_progress', charDelta: 0, mode: 'requesting' };
  child.stdin.end(p.prompt);

  while (true) {
    const item = await queue.next();
    if (item.kind === 'event') yield item.event;
    else if (item.kind === 'fail') throw item.error;
    else return item.result;
  }
}
