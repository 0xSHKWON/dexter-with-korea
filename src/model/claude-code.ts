/**
 * Claude Code as a LangChain chat model — for Dexter's non-agentic LLM calls
 * (tool-internal routing, structured extraction, summaries, compaction).
 *
 * The agent loop itself does NOT go through this class: with a Claude Code model
 * the whole turn runs inside one `claude -p` session (src/agent/claude-code-runner.ts).
 *
 * Tool calls are emulated with `--json-schema`: the bound tools become an anyOf
 * of `{ name, args }` objects and the structured reply is mapped onto
 * AIMessage.tool_calls. That is enough for the one-shot routers Dexter uses
 * (pick sub-tools for a query) and for withStructuredOutput.
 */
import { randomUUID } from 'node:crypto';
import {
  BaseChatModel,
  type BaseChatModelCallOptions,
  type BindToolsInput,
} from '@langchain/core/language_models/chat_models';
import { AIMessageChunk, type BaseMessage } from '@langchain/core/messages';
import type { ChatResult } from '@langchain/core/outputs';
import type { Runnable } from '@langchain/core/runnables';
import type { BaseLanguageModelInput } from '@langchain/core/language_models/base';
import { convertToOpenAITool } from '@langchain/core/utils/function_calling';
import { runClaudeOnce } from '@/claude-code/cli';

interface FunctionDef {
  name: string;
  description?: string;
  parameters?: Record<string, unknown>;
}

export interface ChatClaudeCodeCallOptions extends BaseChatModelCallOptions {
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

/** Flatten a LangChain conversation into one prompt (claude -p takes a single user turn). */
export function toClaudePrompt(messages: BaseMessage[]): { systemPrompt: string; prompt: string } {
  const system: string[] = [];
  const turns: string[] = [];
  for (const m of messages) {
    const type = m._getType();
    const text = contentText(m);
    if (type === 'system') system.push(text);
    else if (type === 'human') turns.push(text);
    else if (type === 'ai') turns.push(`[Assistant]\n${text}`);
    else if (type === 'tool') turns.push(`[Tool result]\n${text}`);
  }
  return {
    systemPrompt: system.join('\n\n') || 'You are a helpful assistant.',
    prompt: turns.length === 1 ? turns[0] : turns.join('\n\n'),
  };
}

export function toolCallSchema(tools: FunctionDef[]): object {
  return {
    type: 'object',
    properties: {
      tool_calls: {
        type: 'array',
        description: 'The tool calls to make, in order. Empty if no tool fits.',
        items: {
          anyOf: tools.map((t) => ({
            type: 'object',
            description: t.description,
            properties: {
              name: { const: t.name },
              args: t.parameters ?? { type: 'object' },
            },
            required: ['name', 'args'],
          })),
        },
      },
    },
    required: ['tool_calls'],
  };
}

export class ChatClaudeCode extends BaseChatModel<ChatClaudeCodeCallOptions> {
  readonly model: string;

  constructor(fields: { model: string }) {
    super({});
    this.model = fields.model;
  }

  _llmType(): string {
    return 'claude-code';
  }

  override bindTools(
    tools: BindToolsInput[],
    kwargs?: Partial<ChatClaudeCodeCallOptions>,
  ): Runnable<BaseLanguageModelInput, AIMessageChunk, ChatClaudeCodeCallOptions> {
    const defs = tools.map((t) => convertToOpenAITool(t).function as FunctionDef);
    return this.withConfig({ ...kwargs, tools: defs } as Partial<ChatClaudeCodeCallOptions>);
  }

  async _generate(messages: BaseMessage[], options: this['ParsedCallOptions']): Promise<ChatResult> {
    const { systemPrompt, prompt } = toClaudePrompt(messages);
    const tools = options.tools;

    if (!tools?.length) {
      const result = await runClaudeOnce({ model: this.model, systemPrompt, prompt, signal: options.signal });
      const text = result.result ?? '';
      return { generations: [{ text, message: new AIMessageChunk({ content: text, usage_metadata: usageOf(result) }) }] };
    }

    const toolList = tools.map((t) => `- ${t.name}: ${t.description ?? ''}`).join('\n');
    const result = await runClaudeOnce({
      model: this.model,
      systemPrompt: `${systemPrompt}\n\nAvailable tools (answer only with the tool_calls JSON):\n${toolList}`,
      prompt,
      jsonSchema: toolCallSchema(tools),
      signal: options.signal,
    });
    const structured = result.structured_output as { tool_calls?: { name: string; args?: Record<string, unknown> }[] } | undefined;
    const known = new Set(tools.map((t) => t.name));
    const toolCalls = (structured?.tool_calls ?? [])
      .filter((c) => known.has(c.name))
      .map((c) => ({ name: c.name, args: c.args ?? {}, id: `call_${randomUUID()}`, type: 'tool_call' as const }));
    return {
      generations: [
        { text: '', message: new AIMessageChunk({ content: '', tool_calls: toolCalls, usage_metadata: usageOf(result) }) },
      ],
    };
  }
}

function usageOf(result: Awaited<ReturnType<typeof runClaudeOnce>>) {
  const input =
    (result.usage?.input_tokens ?? 0) +
    (result.usage?.cache_read_input_tokens ?? 0) +
    (result.usage?.cache_creation_input_tokens ?? 0);
  const output = result.usage?.output_tokens ?? 0;
  return { input_tokens: input, output_tokens: output, total_tokens: input + output };
}
