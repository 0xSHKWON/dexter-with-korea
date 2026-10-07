import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';
import { AIMessage, HumanMessage, SystemMessage, ToolMessage } from '@langchain/core/messages';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { resolveProvider } from '@/providers';
import { callLlm } from '@/model/llm';
import { parseToolReply, toCursorPrompt } from '@/model/cursor';
import { Agent } from '@/agent/agent';
import type { AgentEvent } from '@/agent/types';
import { CURSOR_DENY_ALL, getCursorStatus, invalidateCursorStatus, parseCursorStatusOutput } from './cli';

const FAKE = fileURLToPath(new URL('./__fixtures__/fake-cursor-agent.ts', import.meta.url));
const dir = mkdtempSync(join(tmpdir(), 'dexter-cursor-test-'));
const log = join(dir, 'argv.jsonl');
const ENV_KEYS = ['CURSOR_AGENT_PATH', 'FAKE_CURSOR_LOG', 'FAKE_CURSOR_FAIL', 'FAKE_CURSOR_HANG', 'CURSOR_API_KEY', 'DEXTER_DIR'] as const;
const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));

beforeAll(() => {
  process.env.CURSOR_AGENT_PATH = FAKE;
  process.env.FAKE_CURSOR_LOG = log;
  process.env.DEXTER_DIR = dir;
  invalidateCursorStatus();
});
beforeEach(() => {
  writeFileSync(log, '');
  delete process.env.FAKE_CURSOR_FAIL;
  delete process.env.FAKE_CURSOR_HANG;
  delete process.env.CURSOR_API_KEY;
});
afterAll(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  rmSync(dir, { recursive: true, force: true });
});

const invocations = () =>
  readFileSync(log, 'utf-8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as { args: string[]; cwd: string; cliJson: unknown; apiKey: string | null; prompt?: string });

describe('provider routing', () => {
  it('cursor: ids route to the Cursor provider; gemini- ids no longer have one', () => {
    expect(resolveProvider('cursor:auto').id).toBe('cursor');
    expect(resolveProvider('cursor:claude-opus-5-5-high').id).toBe('cursor');
    expect(resolveProvider('gemini-3.8-flash').id).toBe('openai');
  });
});

describe('cursor-agent status parsing', () => {
  it('reads logged-in state and email from JSON status, or the older human output', () => {
    expect(parseCursorStatusOutput('{"isAuthenticated":true,"userInfo":{"email":"a@b.co"}}')).toEqual({ loggedIn: true, email: 'a@b.co' });
    expect(parseCursorStatusOutput('{"status":"unauthenticated","isAuthenticated":false}')).toEqual({ loggedIn: false });
    expect(parseCursorStatusOutput('\x1b[2K\x1b[G ✓ Logged in as a.b@x.io\n')).toEqual({ loggedIn: true, email: 'a.b@x.io' });
    expect(parseCursorStatusOutput(' ✓ Login successful!\n Logged in\n')).toEqual({ loggedIn: true });
    expect(parseCursorStatusOutput(' Not logged in\n')).toEqual({ loggedIn: false });
    expect(parseCursorStatusOutput('Partially authenticated (missing refresh token)')).toEqual({ loggedIn: false });
  });

  it('getCursorStatus runs `status --format json` on the resolved binary', () => {
    expect(getCursorStatus(true)).toEqual({ installed: true, loggedIn: true, email: 'me@example.com', authMethod: 'login' });
  });
});

describe('tool-call emulation', () => {
  const tools = [{ name: 'get_price', description: 'p', parameters: { type: 'object' } }];

  it('flattens tool calls and results into the transcript with tool names', () => {
    const prompt = toCursorPrompt(
      [
        new SystemMessage('You are Dexter.'),
        new HumanMessage('삼성전자 현재가'),
        new AIMessage({ content: '', tool_calls: [{ name: 'get_price', args: { ticker: '005930' }, id: 't1', type: 'tool_call' }] }),
        new ToolMessage({ content: '{"price":1}', tool_call_id: 't1' }),
      ],
      tools,
    );
    expect(prompt).toContain('[Instructions]\nYou are Dexter.');
    expect(prompt).toContain('- name: get_price');
    expect(prompt).toContain('### User\n삼성전자 현재가');
    expect(prompt).toContain('### Assistant (tool call)\nget_price {"ticker":"005930"}');
    expect(prompt).toContain('### Tool result (get_price)\n{"price":1}');
  });

  it('finds the JSON reply inside prose/fences and drops unknown tools', () => {
    const r = parseToolReply(
      'Sure.\n```json\n{"tool_calls":[{"name":"get_price","args":"{\\"ticker\\":\\"005930\\"}"},{"name":"rm_rf","args":{}}],"answer":"{brace}"}\n```',
      tools,
    );
    expect(r.answer).toBe('{brace}');
    expect(r.toolCalls).toEqual([expect.objectContaining({ name: 'get_price', args: { ticker: '005930' } })]);
  });

  it('treats a reply without the JSON object as the final answer', () => {
    expect(parseToolReply('그냥 답변 {not json}', tools)).toEqual({ answer: '그냥 답변 {not json}', toolCalls: [] });
  });
});

describe('Cursor CLI (fake binary)', () => {
  it('plain completion: stdin prompt, bare model id, read-only in a deny-all scratch cwd, never --force', async () => {
    const { response, usage } = await callLlm('hello', { model: 'cursor:auto', systemPrompt: 'sys' });
    expect(response).toBe('echo: hello');
    expect(usage).toEqual({ inputTokens: 10, outputTokens: 5, totalTokens: 15 });
    const [{ args, cwd, cliJson, prompt }] = invocations();
    expect(args).toEqual(['-p', '--output-format', 'json', '--trust', '--mode', 'ask', '--model', 'auto']);
    expect(args).not.toContain('--force');
    expect(cliJson).toEqual(CURSOR_DENY_ALL);
    expect(cwd).toContain('dexter-cursor-');
    expect(prompt).toContain('[Instructions]\nsys');
  });

  it('passes a real CURSOR_API_KEY through but drops the env.example placeholder', async () => {
    process.env.CURSOR_API_KEY = 'your-cursor-api-key';
    await callLlm('a', { model: 'cursor:auto' });
    process.env.CURSOR_API_KEY = 'key_live';
    await callLlm('b', { model: 'cursor:auto' });
    expect(invocations().map((i) => i.apiKey)).toEqual([null, 'key_live']);
  });

  it('withStructuredOutput rides the tool-call emulation', async () => {
    const { response } = await callLlm('SK하이닉스', {
      model: 'cursor:auto',
      outputSchema: z.object({ ticker: z.string() }),
    });
    expect(response).toEqual({ ticker: '005930' } as never);
  });

  it('settles on the result line even if the CLI never exits', async () => {
    process.env.FAKE_CURSOR_HANG = '1';
    const started = Date.now();
    const { response } = await callLlm('hi', { model: 'cursor:auto' });
    expect(response).toBe('echo: hi');
    expect(Date.now() - started).toBeLessThan(4_000);
  });

  it('surfaces plain-text CLI failures', async () => {
    process.env.FAKE_CURSOR_FAIL = 'ConnectError: [resource_exhausted] Error';
    await expect(callLlm('x', { model: 'cursor:auto' })).rejects.toThrow(/resource_exhausted/);
  });
});

describe('agent turn via Cursor', () => {
  it('runs Dexter tools through the native loop and returns the answer', async () => {
    let calls = 0;
    const getPrice = tool(
      async ({ ticker }) => {
        calls++;
        return JSON.stringify({ data: { ticker, price: 276000 } });
      },
      { name: 'get_price', description: 'Current price', schema: z.object({ ticker: z.string() }) },
    );
    const agent = await Agent.create({
      model: 'cursor:claude-opus-5-5-high',
      memoryEnabled: false,
      systemPromptOverride: 'You are Dexter.',
      transformTools: () => [getPrice],
    });

    const events: AgentEvent[] = [];
    for await (const e of agent.run('삼성전자 현재가')) events.push(e);

    expect(calls).toBe(1);
    const done = events.at(-1) as Extract<AgentEvent, { type: 'done' }>;
    expect(done.type).toBe('done');
    expect(done.answer).toBe('Price is {"data":{"ticker":"005930","price":276000}}');
    expect(done.toolCalls).toEqual([expect.objectContaining({ tool: 'get_price', args: { ticker: '005930' } })]);
    const runs = invocations().filter((i) => i.args[0] === '-p');
    expect(runs.map((i) => i.args[i.args.indexOf('--model') + 1])).toEqual(['claude-opus-5-5-high', 'claude-opus-5-5-high']);
  });
});
