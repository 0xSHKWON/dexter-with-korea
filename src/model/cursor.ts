/**
 * Cursor Agent CLI as a LangChain chat model. Unlike Claude Code (whole turn in
 * one session over MCP), Cursor goes through Dexter's native agent loop: every
 * LLM call is one `cursor-agent -p` run, so approvals, scratchpad, compaction and
 * the iteration cap all apply unchanged.
 *
 * The CLI returns plain text only — no tool_use blocks, no schema flag. Bound
 * tools are described in the prompt and the model answers with a JSON object
 * `{"tool_calls":[{"name","args"}],"answer":""}`, found anywhere in the reply
 * (models wrap it in fences or prose). No JSON → the whole reply is the answer.
 */
import { randomUUID } from 'node:crypto';
import {
  BaseChatModel,
  type BaseChatModelCallOptions,
  type BindToolsInput,
} from '@langchain/core/language_models/chat_models';
import { AIMessageChunk, type BaseMessage, type ToolMessage, type AIMessage } from '@langchain/core/messages';
import type { ChatResult } from '@langchain/core/outputs';
import type { Runnable } from '@langchain/core/runnables';
import type { BaseLanguageModelInput } from '@langchain/core/language_models/base';
import { convertToOpenAITool } from '@langchain/core/utils/function_calling';
import { runCursorOnce, type CursorResultMessage } from '@/cursor/cli';

interface FunctionDef {
  name: string;
  description?: string;
  parameters?: Record<string, unknown>;
}

export interface ChatCursorCallOptions extends BaseChatModelCallOptions {
  tools?: FunctionDef[];
}

function contentText(message: BaseMessage): string {
  const c = message.content;
  if (typeof c === 'string') return c;
  return c
    .map((part) => (typeof part === 'object' && part && 'text' in part ? String(part.text) : ''))
    .filter(Boolean)
    .join('\n');
}

export function toolProtocol(tools: FunctionDef[]): string {
  const list = tools
    .map((t) => `- name: ${t.name}\n  description: ${t.description ?? ''}\n  parameters: ${JSON.stringify(t.parameters ?? { type: 'object' })}`)
    .join('\n');
  return `## Tool use
You cannot run tools yourself. To call tools, the application runs them and appends the results to the conversation.
Reply with exactly one JSON object and nothing else:
{"tool_calls": [{"name": "<tool name>", "args": {...}}], "answer": ""}
- Need tool results: list the calls in "tool_calls" (independent calls together) and leave "answer" empty.
- Final reply: "tool_calls" is [] and "answer" holds the full answer for the user (markdown allowed).
- Never re-request a tool result already in the conversation.

### Tools
${list}`;
}

/** Flatten system + conversation (tool calls and results included) into one prompt. */
export function toCursorPrompt(messages: BaseMessage[], tools: FunctionDef[] = []): string {
  const system: string[] = [];
  const turns: string[] = [];
  const toolNames = new Map<string, string>();
  for (const m of messages) {
    const type = m._getType();
    const text = contentText(m);
    if (type === 'system') system.push(text);
    else if (type === 'human') turns.push(`### User\n${text}`);
    else if (type === 'ai') {
      if (text.trim()) turns.push(`### Assistant\n${text}`);
      for (const call of (m as AIMessage).tool_calls ?? []) {
        if (call.id) toolNames.set(call.id, call.name);
        turns.push(`### Assistant (tool call)\n${call.name} ${JSON.stringify(call.args)}`);
      }
    } else if (type === 'tool') {
      const tm = m as ToolMessage;
      turns.push(`### Tool result (${tm.name ?? toolNames.get(tm.tool_call_id) ?? 'unknown'})\n${text}`);
    }
  }
  if (tools.length) system.push(toolProtocol(tools));
  const instructions = system.join('\n\n') || 'You are a helpful assistant.';
  const tail = tools.length
    ? 'Continue from the last message. Reply with the JSON object only.'
    : 'Continue from the last message.';
  return `[Instructions]\n${instructions}\n\n[Conversation]\n${turns.join('\n\n')}\n\n${tail}`;
}

/** First JSON object in free text that carries `tool_calls` or `answer`. */
export function extractToolReply(text: string): { tool_calls?: unknown; answer?: unknown } | null {
  for (let start = text.indexOf('{'); start !== -1; start = text.indexOf('{', start + 1)) {
    const end = matchingBrace(text, start);
    if (end === -1) continue;
    try {
      const value = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
      if (value && typeof value === 'object' && ('tool_calls' in value || 'answer' in value)) return value;
    } catch {
      // not JSON at this brace — keep scanning
    }
  }
  return null;
}

/** Index of the brace closing the one at `start`, skipping string contents; -1 if unbalanced. */
function matchingBrace(text: string, start: number): number {
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (ch === '\\') i++;
      else if (ch === '"') inString = false;
    } else if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return i;
  }
  return -1;
}

export function parseToolReply(
  text: string,
  tools: FunctionDef[],
): { answer: string; toolCalls: { name: string; args: Record<string, unknown>; id: string; type: 'tool_call' }[] } {
  const reply = extractToolReply(text);
  if (!reply) return { answer: text, toolCalls: [] };
  const known = new Set(tools.map((t) => t.name));
  const calls = Array.isArray(reply.tool_calls) ? reply.tool_calls : [];
  const toolCalls = calls.flatMap((c) => {
    if (!c || typeof c !== 'object') return [];
    const { name, args, input } = c as { name?: unknown; args?: unknown; input?: unknown };
    if (typeof name !== 'string' || !known.has(name)) return [];
    let a = args ?? input ?? {};
    // Some models hand args back as a JSON string.
    if (typeof a === 'string') {
      try {
        a = JSON.parse(a);
      } catch {
        a = {};
      }
    }
    const argsObj = a && typeof a === 'object' && !Array.isArray(a) ? (a as Record<string, unknown>) : {};
    return [{ name, args: argsObj, id: `call_${randomUUID()}`, type: 'tool_call' as const }];
  });
  return { answer: typeof reply.answer === 'string' ? reply.answer : '', toolCalls };
}

export class ChatCursor extends BaseChatModel<ChatCursorCallOptions> {
  readonly model: string;

  constructor(fields: { model: string }) {
    super({});
    this.model = fields.model;
  }

  _llmType(): string {
    return 'cursor';
  }

  override bindTools(
    tools: BindToolsInput[],
    kwargs?: Partial<ChatCursorCallOptions>,
  ): Runnable<BaseLanguageModelInput, AIMessageChunk, ChatCursorCallOptions> {
    const defs = tools.map((t) => convertToOpenAITool(t).function as FunctionDef);
    return this.withConfig({ ...kwargs, tools: defs } as Partial<ChatCursorCallOptions>);
  }

  async _generate(messages: BaseMessage[], options: this['ParsedCallOptions']): Promise<ChatResult> {
    const tools = options.tools ?? [];
    const result = await runCursorOnce({ model: this.model, prompt: toCursorPrompt(messages, tools), signal: options.signal });
    const text = result.result ?? '';
    const usage_metadata = usageOf(result);
    if (!tools.length) {
      return { generations: [{ text, message: new AIMessageChunk({ content: text, usage_metadata }) }] };
    }
    const { answer, toolCalls } = parseToolReply(text, tools);
    return {
      generations: [{ text: answer, message: new AIMessageChunk({ content: answer, tool_calls: toolCalls, usage_metadata }) }],
    };
  }
}

function usageOf(result: CursorResultMessage) {
  const u = result.usage;
  const input = (u?.inputTokens ?? 0) + (u?.cacheReadTokens ?? 0) + (u?.cacheWriteTokens ?? 0);
  const output = u?.outputTokens ?? 0;
  return { input_tokens: input, output_tokens: output, total_tokens: input + output };
}
