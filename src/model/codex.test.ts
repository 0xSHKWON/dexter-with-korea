import { afterAll, afterEach, beforeAll, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { AIMessageChunk, HumanMessage, SystemMessage, ToolMessage, type AIMessage } from '@langchain/core/messages';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { saveCredentials } from '@/auth/store';
import { resolveProvider } from '@/providers';
import { getModelDisplayName } from '@/utils/model';
import { checkApiKeyExistsForProvider } from '@/utils/env';
import { extractTextContent } from '@/utils/ai-message';
import { createCodexChatModel, transformCodexBody } from './codex';
import { callLlm, getChatModel, streamLlmWithMessages } from './llm';

function fakeJwt(payload: object): string {
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'none' })}.${b64(payload)}.sig`;
}

const ACCESS = fakeJwt({ 'https://api.openai.com/auth': { chatgpt_account_id: 'acct_123' } });

describe('transformCodexBody', () => {
  it('moves leading system/developer messages into instructions', () => {
    const out = transformCodexBody({
      model: 'gpt-6-astra',
      input: [
        { type: 'message', role: 'developer', content: 'You are Dexter.' },
        { type: 'message', role: 'system', content: [{ type: 'input_text', text: 'Be terse.' }] },
        { type: 'message', role: 'user', content: 'hi' },
        { type: 'message', role: 'developer', content: 'mid-conversation note' },
      ],
    });
    expect(out.instructions).toBe('You are Dexter.\n\nBe terse.');
    expect(out.input).toEqual([
      { type: 'message', role: 'user', content: 'hi' },
      // only the leading run is hoisted; later developer turns keep their position
      { type: 'message', role: 'developer', content: 'mid-conversation note' },
    ]);
  });

  it('forces the backend constraints and drops unsupported params', () => {
    const out = transformCodexBody({
      model: 'gpt-6-astra',
      input: [{ type: 'message', role: 'user', content: 'hi' }],
      stream: false,
      store: true,
      max_output_tokens: 1000,
      previous_response_id: 'resp_1',
      include: ['message.output_text.logprobs'],
    });
    expect(out.store).toBe(false);
    expect(out.stream).toBe(true);
    expect(out.max_output_tokens).toBeUndefined();
    expect(out.previous_response_id).toBeUndefined();
    expect(out.include).toEqual(['message.output_text.logprobs', 'reasoning.encrypted_content']);
  });

  it('never sends empty instructions (the backend rejects them)', () => {
    const out = transformCodexBody({ model: 'm', input: [{ type: 'message', role: 'user', content: 'hi' }] });
    expect(typeof out.instructions).toBe('string');
    expect((out.instructions as string).length).toBeGreaterThan(0);
  });
});

describe('provider routing', () => {
  it('routes codex: ids to the subscription provider, not the API-key OpenAI one', () => {
    expect(resolveProvider('codex:gpt-6-astra').id).toBe('openai-codex');
    expect(resolveProvider('gpt-6-astra').id).toBe('openai');
    expect(getModelDisplayName('codex:gpt-daybreak-blue-latest')).toBe('Daybreak Blue');
  });
});

// ---------------------------------------------------------------------------
// End to end through LangChain with a mocked Codex backend
// ---------------------------------------------------------------------------

function sse(events: object[]): Response {
  const body = events.map((e) => `event: ${(e as { type: string }).type}\ndata: ${JSON.stringify(e)}\n\n`).join('');
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

const baseResponse = { id: 'resp_1', object: 'response', created_at: 0, model: 'gpt-6-astra', output: [] };

function textResponse(text: string): Response {
  const item = { id: 'msg_1', type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text, annotations: [] }] };
  return sse([
    { type: 'response.created', sequence_number: 0, response: { ...baseResponse, status: 'in_progress' } },
    { type: 'response.output_item.added', sequence_number: 1, output_index: 0, item: { ...item, status: 'in_progress', content: [] } },
    { type: 'response.output_text.delta', sequence_number: 2, item_id: 'msg_1', output_index: 0, content_index: 0, delta: text },
    { type: 'response.output_item.done', sequence_number: 3, output_index: 0, item },
    {
      type: 'response.completed',
      sequence_number: 4,
      response: { ...baseResponse, status: 'completed', output: [item], usage: { input_tokens: 10, output_tokens: 3, total_tokens: 13 } },
    },
  ]);
}

function toolCallResponse(): Response {
  const item = { id: 'fc_1', type: 'function_call', status: 'completed', call_id: 'call_1', name: 'get_price', arguments: '{"ticker":"005930"}' };
  return sse([
    { type: 'response.created', sequence_number: 0, response: { ...baseResponse, status: 'in_progress' } },
    { type: 'response.output_item.added', sequence_number: 1, output_index: 0, item: { ...item, arguments: '' } },
    { type: 'response.function_call_arguments.delta', sequence_number: 2, item_id: 'fc_1', output_index: 0, delta: item.arguments },
    { type: 'response.output_item.done', sequence_number: 3, output_index: 0, item },
    { type: 'response.completed', sequence_number: 4, response: { ...baseResponse, status: 'completed', output: [item] } },
  ]);
}

describe('Codex chat model (mocked backend)', () => {
  const realFetch = globalThis.fetch;
  const realDir = process.env.DEXTER_DIR;
  const dir = mkdtempSync(join(tmpdir(), 'dexter-codex-test-'));
  let requests: { url: string; headers: Headers; body: Record<string, unknown> }[] = [];

  beforeAll(() => {
    process.env.DEXTER_DIR = dir;
    saveCredentials('openai-codex', { access: ACCESS, refresh: 'r', expires: Date.now() + 3600_000, accountId: 'acct_123' });
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
    requests = [];
  });
  afterAll(() => {
    process.env.DEXTER_DIR = realDir;
    rmSync(dir, { recursive: true, force: true });
  });

  function mockBackend(respond: () => Response) {
    globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
      requests.push({
        url: String(url),
        headers: new Headers(init?.headers),
        body: JSON.parse(String(init?.body)) as Record<string, unknown>,
      });
      return respond();
    }) as typeof fetch;
  }

  it('reports the provider as configured once logged in', () => {
    expect(checkApiKeyExistsForProvider('openai-codex')).toBe(true);
  });

  it('invoke() streams under the hood and sends Codex auth + body shape', async () => {
    mockBackend(() => textResponse('삼성전자 현재가는 7만원입니다.'));
    const llm = getChatModel('codex:gpt-6-astra');
    const result = await llm.invoke([new SystemMessage('You are Dexter.'), new HumanMessage('삼성전자 주가?')]);

    expect(extractTextContent(result)).toBe('삼성전자 현재가는 7만원입니다.');
    expect(result.usage_metadata?.total_tokens).toBe(13);

    const [req] = requests;
    expect(req.url).toBe('https://chatgpt.com/backend-api/codex/responses');
    expect(req.headers.get('authorization')).toBe(`Bearer ${ACCESS}`);
    expect(req.headers.get('chatgpt-account-id')).toBe('acct_123');
    expect(req.body.model).toBe('gpt-6-astra');
    expect(req.body.instructions).toBe('You are Dexter.');
    expect(req.body.store).toBe(false);
    expect(req.body.stream).toBe(true);
    expect((req.body.input as { role: string }[]).every((m) => m.role !== 'system' && m.role !== 'developer')).toBe(true);
  });

  it('callLlm returns plain text for single-shot callers', async () => {
    mockBackend(() => textResponse('요약입니다.'));
    const { response } = await callLlm('요약해줘', { model: 'codex:gpt-6-luna', systemPrompt: 'sys' });
    expect(response).toBe('요약입니다.');
    expect(requests[0].body.instructions).toBe('sys');
  });

  it('surfaces tool calls for the agent loop', async () => {
    mockBackend(toolCallResponse);
    const getPrice = tool(async () => '70000', {
      name: 'get_price',
      description: 'price',
      schema: z.object({ ticker: z.string() }),
    });
    const llm = createCodexChatModel('codex:gpt-6-astra').bindTools([getPrice]);
    const result = await llm.invoke([new SystemMessage('sys'), new HumanMessage('삼성전자')]);

    expect(result.tool_calls).toEqual([
      expect.objectContaining({ name: 'get_price', args: { ticker: '005930' }, id: 'call_1' }),
    ]);
    expect((requests[0].body.tools as { name: string }[])[0].name).toBe('get_price');
  });

  it('replays a tool turn statelessly (store:false → no server item ids)', async () => {
    mockBackend(toolCallResponse);
    const getPrice = tool(async () => '70000', {
      name: 'get_price',
      description: 'price',
      schema: z.object({ ticker: z.string() }),
    });
    const first = (await createCodexChatModel('codex:gpt-6-astra')
      .bindTools([getPrice])
      .invoke([new SystemMessage('sys'), new HumanMessage('삼성전자')])) as AIMessage;

    mockBackend(() => textResponse('7만원'));
    let streamed: AIMessageChunk | undefined;
    for await (const chunk of streamLlmWithMessages(
      [
        new SystemMessage('sys'),
        new HumanMessage('삼성전자'),
        first,
        new ToolMessage({ content: '70000', tool_call_id: 'call_1' }),
      ],
      { model: 'codex:gpt-6-astra', tools: [getPrice] },
    )) {
      streamed = streamed ? streamed.concat(chunk) : chunk;
    }
    expect(streamed && extractTextContent(streamed)).toBe('7만원');

    const input = requests[1].body.input as Record<string, unknown>[];
    expect(input.map((i) => i.type ?? i.role)).toEqual(['message', 'function_call', 'function_call_output']);
    expect(input.some((i) => 'id' in i)).toBe(false);
    expect(input[2]).toMatchObject({ call_id: 'call_1', output: '70000' });
  });
});
