#!/usr/bin/env bun
/**
 * Test double for the `claude` CLI. Speaks just enough of `claude -p` to exercise
 * Dexter's Claude Code integration without a real install or login:
 *   - `auth status --json`              → logged-in status
 *   - `-p --output-format json`         → one result (structured_output when --json-schema)
 *   - `-p --output-format stream-json`  → connects to the --mcp-config server, calls the
 *                                         tool named in FAKE_CLAUDE_TOOL, streams the answer
 * Every invocation's argv is appended to FAKE_CLAUDE_LOG (JSON lines) for assertions.
 */
import { appendFileSync } from 'node:fs';

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
if (process.env.FAKE_CLAUDE_LOG) {
  appendFileSync(process.env.FAKE_CLAUDE_LOG, JSON.stringify({ args, env: { ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ?? null } }) + '\n');
}
const out = (o: object) => process.stdout.write(JSON.stringify(o) + '\n');

if (args[0] === 'auth' && args[1] === 'status') {
  out({ loggedIn: true, authMethod: 'claude.ai', email: 'me@example.com' });
  process.exit(0);
}

const prompt = await new Response(Bun.stdin.stream()).text();
const usage = { input_tokens: 10, output_tokens: 5 };

if (flag('--output-format') === 'json') {
  const schema = flag('--json-schema');
  if (schema) {
    const parsed = JSON.parse(schema) as { properties?: { tool_calls?: { items?: { anyOf?: { properties: { name: { const: string } } }[] } } } };
    const first = parsed.properties?.tool_calls?.items?.anyOf?.[0]?.properties.name.const;
    const structured = first ? { tool_calls: [{ name: first, args: { ticker: '005930' } }] } : { ticker: '000660' };
    out({ type: 'result', subtype: 'success', is_error: false, result: JSON.stringify(structured), structured_output: structured, usage });
  } else {
    out({ type: 'result', subtype: 'success', is_error: false, result: `echo: ${prompt.trim()}`, usage });
  }
  process.exit(0);
}

// stream-json agent turn
const config = JSON.parse(flag('--mcp-config') ?? '{}') as { mcpServers: Record<string, { url: string; headers: Record<string, string> }> };
const server = config.mcpServers.dexter;
let rpcId = 0;
const rpc = async (method: string, params: object) => {
  const res = await fetch(server.url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...server.headers },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }),
  });
  return (await res.json()) as { result: Record<string, unknown> };
};
await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'fake', version: '0' } });
const { result: listed } = await rpc('tools/list', {});
out({ type: 'system', subtype: 'init', mcp_servers: [{ name: 'dexter', status: 'connected' }], tools: (listed.tools as { name: string }[]).map((t) => `mcp__dexter__${t.name}`) });

const toolName = process.env.FAKE_CLAUDE_TOOL ?? '';
out({ type: 'assistant', message: { content: [{ type: 'text', text: 'Checking the price.' }, { type: 'tool_use', id: 'tu_1', name: `mcp__dexter__${toolName}`, input: { ticker: '005930' } }] } });
const { result: called } = await rpc('tools/call', { name: toolName, arguments: { ticker: '005930' } });
const toolText = (called.content as { text: string }[])[0].text;

for (const piece of ['Price ', 'is ', toolText]) {
  out({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: piece } } });
}
out({ type: 'result', subtype: 'success', is_error: false, result: `Price is ${toolText}`, num_turns: 2, usage });
