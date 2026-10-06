import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { resolveProvider } from '@/providers';
import { callLlm } from '@/model/llm';
import { Agent } from '@/agent/agent';
import type { AgentEvent } from '@/agent/types';
import { getClaudeCodeStatus, invalidateClaudeCodeStatus } from './cli';

const FAKE = fileURLToPath(new URL('./__fixtures__/fake-claude.ts', import.meta.url));
const dir = mkdtempSync(join(tmpdir(), 'dexter-cc-test-'));
const log = join(dir, 'argv.jsonl');
const saved = { path: process.env.CLAUDE_CODE_PATH, log: process.env.FAKE_CLAUDE_LOG, key: process.env.ANTHROPIC_API_KEY, dexterDir: process.env.DEXTER_DIR };

beforeAll(() => {
  process.env.CLAUDE_CODE_PATH = FAKE;
  process.env.FAKE_CLAUDE_LOG = log;
  process.env.DEXTER_DIR = dir;
  invalidateClaudeCodeStatus();
});
beforeEach(() => writeFileSync(log, ''));
afterAll(() => {
  for (const [k, v] of Object.entries({ CLAUDE_CODE_PATH: saved.path, FAKE_CLAUDE_LOG: saved.log, ANTHROPIC_API_KEY: saved.key, DEXTER_DIR: saved.dexterDir })) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  rmSync(dir, { recursive: true, force: true });
});

const invocations = () =>
  readFileSync(log, 'utf-8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as { args: string[]; env: { ANTHROPIC_API_KEY: string | null } });

describe('provider routing', () => {
  it("claude-code: ids don't fall into Anthropic's claude- prefix", () => {
    expect(resolveProvider('claude-code:claude-opus-5-5').id).toBe('claude-code');
    expect(resolveProvider('claude-opus-5-5').id).toBe('anthropic');
  });
});

describe('Claude Code CLI (fake binary)', () => {
  it('reads login status from `claude auth status`', () => {
    expect(getClaudeCodeStatus(true)).toEqual({ installed: true, loggedIn: true, email: 'me@example.com', authMethod: 'claude.ai' });
  });

  it('plain completion: bare model id, built-in tools off, Dexter key not leaked', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-dexter-api-key';
    const { response } = await callLlm('hello', { model: 'claude-code:claude-haiku-4-5', systemPrompt: 'sys' });
    expect(response).toBe('echo: hello');
    const [{ args, env }] = invocations();
    expect(args[args.indexOf('--model') + 1]).toBe('claude-haiku-4-5');
    expect(args[args.indexOf('--tools') + 1]).toBe('');
    expect(args[args.indexOf('--system-prompt') + 1]).toBe('sys');
    // Claude Code must bill the user's login, not Dexter's Anthropic API key.
    expect(env.ANTHROPIC_API_KEY).toBeNull();
  });

  it('tool routing is emulated with --json-schema', async () => {
    const income = tool(async () => 'x', { name: 'get_income_statement', description: 'IS', schema: z.object({ ticker: z.string() }) });
    const { response } = await callLlm('삼성전자 손익', { model: 'claude-code:claude-haiku-4-5', tools: [income] });
    expect((response as { tool_calls: unknown[] }).tool_calls).toEqual([
      expect.objectContaining({ name: 'get_income_statement', args: { ticker: '005930' } }),
    ]);
    expect(invocations()[0].args).toContain('--json-schema');
  });

  // LangChain's base withStructuredOutput binds a single `extract` tool, so this
  // rides the tool-call emulation: the fake answers that tool with { ticker: '005930' }.
  it('withStructuredOutput works through the same path', async () => {
    const { response } = await callLlm('SK하이닉스', {
      model: 'claude-code:claude-haiku-4-5',
      outputSchema: z.object({ ticker: z.string() }),
    });
    expect(response).toEqual({ ticker: '005930' } as never);
  });
});

describe('agent turn via Claude Code + in-process MCP', () => {
  it('runs Dexter tools in-process and streams the answer', async () => {
    let calls = 0;
    const getPrice = tool(
      async ({ ticker }) => {
        calls++;
        return JSON.stringify({ data: { ticker, price: 276000 } });
      },
      { name: 'get_price', description: 'Current price', schema: z.object({ ticker: z.string() }) },
    );
    process.env.FAKE_CLAUDE_TOOL = 'get_price';
    const agent = await Agent.create({
      model: 'claude-code:claude-opus-5-5',
      memoryEnabled: false,
      systemPromptOverride: 'You are Dexter.',
      transformTools: () => [getPrice],
    });

    const events: AgentEvent[] = [];
    for await (const e of agent.run('삼성전자 현재가')) events.push(e);

    expect(calls).toBe(1);
    const types = events.map((e) => e.type).filter((t) => t !== 'stream_progress');
    expect(types).toEqual(['thinking', 'tool_start', 'tool_end', 'text_delta', 'text_delta', 'text_delta', 'done']);
    const done = events.at(-1) as Extract<AgentEvent, { type: 'done' }>;
    expect(done.answer).toBe('Price is {"data":{"ticker":"005930","price":276000}}');
    expect(done.toolCalls).toEqual([expect.objectContaining({ tool: 'get_price', args: { ticker: '005930' } })]);

    const { args } = invocations()[0];
    expect(args[args.indexOf('--model') + 1]).toBe('claude-opus-5-5');
    expect(args[args.indexOf('--allowedTools') + 1]).toBe('mcp__dexter');
    expect(args).toContain('--strict-mcp-config');
  });

  it('passes the agent effort to claude --effort', async () => {
    const getPrice = tool(async () => '1', { name: 'get_price', description: 'p', schema: z.object({ ticker: z.string() }) });
    process.env.FAKE_CLAUDE_TOOL = 'get_price';
    const agent = await Agent.create({
      model: 'claude-code:claude-opus-5-5',
      effort: 'xhigh',
      memoryEnabled: false,
      systemPromptOverride: 'x',
      transformTools: () => [getPrice],
    });
    for await (const _ of agent.run('q')) {
      // drain
    }
    const { args } = invocations()[0];
    expect(args[args.indexOf('--effort') + 1]).toBe('xhigh');
  });

  it('defaults claude --effort to medium when no effort is chosen', async () => {
    const getPrice = tool(async () => '1', { name: 'get_price', description: 'p', schema: z.object({ ticker: z.string() }) });
    process.env.FAKE_CLAUDE_TOOL = 'get_price';
    const agent = await Agent.create({
      model: 'claude-code:claude-opus-5-5',
      memoryEnabled: false,
      systemPromptOverride: 'x',
      transformTools: () => [getPrice],
    });
    for await (const _ of agent.run('q')) {
      // drain
    }
    const { args } = invocations()[0];
    expect(args[args.indexOf('--effort') + 1]).toBe('medium');
  });

  it('reports a missing install as a done-with-error answer, not a crash', async () => {
    process.env.CLAUDE_CODE_PATH = join(dir, 'nope');
    const prevPath = process.env.PATH;
    const prevHome = process.env.HOME;
    process.env.PATH = dir;
    process.env.HOME = dir;
    try {
      const agent = await Agent.create({
        model: 'claude-code:claude-opus-5-5',
        memoryEnabled: false,
        systemPromptOverride: 'x',
        transformTools: (t) => t.slice(0, 1),
      });
      const events: AgentEvent[] = [];
      for await (const e of agent.run('hi')) events.push(e);
      const done = events.at(-1) as Extract<AgentEvent, { type: 'done' }>;
      expect(done.answer).toContain('Claude Code');
    } finally {
      process.env.PATH = prevPath;
      process.env.HOME = prevHome;
      process.env.CLAUDE_CODE_PATH = FAKE;
    }
  });
});
