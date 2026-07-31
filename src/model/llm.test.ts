import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'bun:test';
import { AIMessage, HumanMessage, SystemMessage, ToolMessage, type BaseMessage } from '@langchain/core/messages';
import { ChatAnthropic } from '@langchain/anthropic';
import { ChatOpenAI } from '@langchain/openai';
import { callLlmWithMessages, getChatModel, streamLlmWithMessages } from './llm.js';

// The factories in llm.ts throw if the provider's API key env var is unset.
// Network is never hit: the request-layer methods below are stubbed.
let prevAnthropicKey: string | undefined;
let prevOpenaiKey: string | undefined;

// Captured wire payloads / call args
let anthropicPayload: Record<string, unknown> | undefined;
let anthropicRequestOptions: Record<string, unknown> | undefined;
let openaiCall: { messages: unknown; options: unknown } | undefined;

/* eslint-disable @typescript-eslint/no-explicit-any */
const anthropicProto = ChatAnthropic.prototype as any;
const openaiProto = ChatOpenAI.prototype as any;
/* eslint-enable @typescript-eslint/no-explicit-any */

const originalCompletionWithRetry = anthropicProto.completionWithRetry;
const originalCreateStreamWithRetry = anthropicProto.createStreamWithRetry;
// ChatOpenAI inherits invoke(); we shadow it with an own property and delete it after.
const openaiHadOwnInvoke = Object.prototype.hasOwnProperty.call(ChatOpenAI.prototype, 'invoke');
const originalOpenaiInvoke = openaiProto.invoke;

function fakeAnthropicResponse() {
  return {
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    model: 'claude-test',
    content: [{ type: 'text', text: 'ok' }],
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 2 },
  };
}

beforeAll(() => {
  prevAnthropicKey = process.env.ANTHROPIC_API_KEY;
  prevOpenaiKey = process.env.OPENAI_API_KEY;
  process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY ?? 'test-anthropic-key';
  process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY ?? 'test-openai-key';

  // Capture the final Anthropic wire payload — after @langchain/anthropic has
  // formatted messages and applied the cache_control call option.
  anthropicProto.completionWithRetry = async function (
    request: Record<string, unknown>,
    requestOptions: Record<string, unknown>,
  ) {
    anthropicPayload = request;
    anthropicRequestOptions = requestOptions;
    return fakeAnthropicResponse();
  };
  anthropicProto.createStreamWithRetry = async function (request: Record<string, unknown>) {
    anthropicPayload = request;
    // Minimal Stream stand-in: async-iterable (empty) + controller.
    return Object.assign((async function* () {})(), { controller: { abort() {} } });
  };
  openaiProto.invoke = async function (messages: unknown, options: unknown) {
    openaiCall = { messages, options };
    return new AIMessage('ok');
  };
});

afterAll(() => {
  anthropicProto.completionWithRetry = originalCompletionWithRetry;
  anthropicProto.createStreamWithRetry = originalCreateStreamWithRetry;
  if (openaiHadOwnInvoke) {
    openaiProto.invoke = originalOpenaiInvoke;
  } else {
    delete openaiProto.invoke;
  }
  if (prevAnthropicKey === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = prevAnthropicKey;
  if (prevOpenaiKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = prevOpenaiKey;
});

beforeEach(() => {
  anthropicPayload = undefined;
  anthropicRequestOptions = undefined;
  openaiCall = undefined;
});

const ANTHROPIC_MODEL = 'claude-sonnet-4-5';
const OPENAI_MODEL = 'gpt-5.5';
const EPHEMERAL = { type: 'ephemeral' };

function makeAgentLoopMessages(): BaseMessage[] {
  return [
    new SystemMessage('You are a KR equity research agent.'),
    new HumanMessage('삼성전자 분석해줘'),
    new AIMessage({
      content: '',
      tool_calls: [{ id: 'call_1', name: 'get_market_data_kr', args: { ticker: '005930' } }],
    }),
    new ToolMessage({
      content: '{"price": 82000}',
      tool_call_id: 'call_1',
      name: 'get_market_data_kr',
    }),
  ];
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function countCacheControls(payload: Record<string, unknown>): number {
  let count = 0;
  const system = payload.system;
  if (Array.isArray(system)) {
    count += system.filter((b: any) => b && typeof b === 'object' && b.cache_control).length;
  }
  for (const msg of (payload.messages as any[]) ?? []) {
    if (Array.isArray(msg.content)) {
      count += msg.content.filter((b: any) => b && typeof b === 'object' && b.cache_control).length;
    }
  }
  return count;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

describe('Anthropic incremental prompt caching', () => {
  it('attaches cache_control to the last content block of the last message (tool turn)', async () => {
    await callLlmWithMessages(makeAgentLoopMessages(), { model: ANTHROPIC_MODEL });

    expect(anthropicPayload).toBeDefined();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const wireMessages = anthropicPayload!.messages as any[];
    const last = wireMessages[wireMessages.length - 1];
    expect(last.role).toBe('user');
    expect(Array.isArray(last.content)).toBe(true);
    const lastBlock = last.content[last.content.length - 1];
    // Tool results become top-level tool_result blocks — the breakpoint must sit
    // on the tool_result block itself (nested cache_control is rejected by the API).
    expect(lastBlock.type).toBe('tool_result');
    expect(lastBlock.tool_use_id).toBe('call_1');
    expect(lastBlock.cache_control).toEqual(EPHEMERAL);
  });

  it('keeps the system prompt cache_control breakpoint (2 breakpoints total)', async () => {
    await callLlmWithMessages(makeAgentLoopMessages(), { model: ANTHROPIC_MODEL });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const system = anthropicPayload!.system as any[];
    expect(Array.isArray(system)).toBe(true);
    expect(system[0].type).toBe('text');
    expect(system[0].text).toBe('You are a KR equity research agent.');
    expect(system[0].cache_control).toEqual(EPHEMERAL);

    // system 1 + conversation 1 — well inside Anthropic's 4-breakpoint limit
    expect(countCacheControls(anthropicPayload!)).toBe(2);
  });

  it('converts a string-content last message into a content block array', async () => {
    await callLlmWithMessages(
      [new SystemMessage('sys'), new HumanMessage('삼성전자 최근 실적 요약해줘')],
      { model: ANTHROPIC_MODEL },
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const wireMessages = anthropicPayload!.messages as any[];
    const last = wireMessages[wireMessages.length - 1];
    expect(last.content).toEqual([
      { type: 'text', text: '삼성전자 최근 실적 요약해줘', cache_control: EPHEMERAL },
    ]);
  });

  it('does not mutate the caller-owned message objects', async () => {
    const messages = makeAgentLoopMessages();
    await callLlmWithMessages(messages, { model: ANTHROPIC_MODEL });

    // Originals keep their plain string content — annotation happens on copies.
    expect(typeof messages[0].content).toBe('string');
    expect(messages[0].content).toBe('You are a KR equity research agent.');
    expect(typeof messages[1].content).toBe('string');
    expect(typeof messages[3].content).toBe('string');
    expect(messages[3].content).toBe('{"price": 82000}');
  });

  it('applies the conversation breakpoint on the streaming path too', async () => {
    const gen = streamLlmWithMessages(makeAgentLoopMessages(), { model: ANTHROPIC_MODEL });
    for await (const _chunk of gen) {
      // drain — stub stream is empty
    }

    expect(anthropicPayload).toBeDefined();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const wireMessages = anthropicPayload!.messages as any[];
    const last = wireMessages[wireMessages.length - 1];
    const lastBlock = last.content[last.content.length - 1];
    expect(lastBlock.type).toBe('tool_result');
    expect(lastBlock.cache_control).toEqual(EPHEMERAL);
    expect(countCacheControls(anthropicPayload!)).toBe(2);
  });

  it('still threads the abort signal through to the request layer', async () => {
    const controller = new AbortController();
    await callLlmWithMessages(makeAgentLoopMessages(), {
      model: ANTHROPIC_MODEL,
      signal: controller.signal,
    });

    expect(anthropicRequestOptions?.signal).toBe(controller.signal);
  });
});

describe('non-Anthropic providers are unaffected', () => {
  it('passes the exact same message array and no cache_control option', async () => {
    const messages = makeAgentLoopMessages();
    await callLlmWithMessages(messages, { model: OPENAI_MODEL });

    expect(openaiCall).toBeDefined();
    // Same reference — no copying, no annotation.
    expect(openaiCall!.messages).toBe(messages);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((openaiCall!.options as any)?.cache_control).toBeUndefined();
    expect(typeof messages[0].content).toBe('string');
  });

  it('still passes the abort signal for non-Anthropic providers', async () => {
    const controller = new AbortController();
    await callLlmWithMessages(makeAgentLoopMessages(), {
      model: OPENAI_MODEL,
      signal: controller.signal,
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const options = openaiCall!.options as any;
    expect(options.signal).toBe(controller.signal);
    expect(options.cache_control).toBeUndefined();
  });
});

// Upstream (virattt/dexter): GPT-5.6 family must route through the OpenAI Responses API.
describe('OpenAI API routing', () => {
  it('uses the Responses API for the GPT-5.6 family', () => {
    const previousApiKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = 'test-key';

    try {
      for (const model of ['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna']) {
        const llm = getChatModel(model) as { useResponsesApi?: boolean };
        expect(llm.useResponsesApi).toBe(true);
      }
      // The fork keeps gpt-5.5 selectable; it predates the Responses API and must
      // stay on Chat Completions (widening the prefix check would silently reroute it).
      expect((getChatModel('gpt-5.5') as { useResponsesApi?: boolean }).useResponsesApi).toBe(false);
    } finally {
      if (previousApiKey === undefined) {
        delete process.env.OPENAI_API_KEY;
      } else {
        process.env.OPENAI_API_KEY = previousApiKey;
      }
    }
  });
});
