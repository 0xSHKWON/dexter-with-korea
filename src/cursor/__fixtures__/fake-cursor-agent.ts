#!/usr/bin/env bun
/**
 * Test double for `cursor-agent`. Speaks just enough of it to exercise Dexter's
 * Cursor integration without a real install or login:
 *   - `status [--format json]`   → logged-in JSON, or the older human line (with ANSI noise)
 *   - `-p --output-format json`  → one result for the prompt read from stdin.
 *     With a tool list in the prompt and no tool result yet, it calls the first
 *     tool (fenced JSON + prose, as real models do); after a result it answers.
 *     FAKE_CURSOR_FAIL makes it exit 1 with a plain-text error instead;
 *     FAKE_CURSOR_HANG keeps it alive after printing the result.
 * Every invocation (argv, cwd, the cwd's .cursor/cli.json, CURSOR_API_KEY) is appended to
 * FAKE_CURSOR_LOG as JSON lines.
 */
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const cliJson = join(process.cwd(), '.cursor', 'cli.json');
const log = (extra: object = {}) => {
  if (!process.env.FAKE_CURSOR_LOG) return;
  appendFileSync(
    process.env.FAKE_CURSOR_LOG,
    JSON.stringify({
      args,
      cwd: process.cwd(),
      cliJson: existsSync(cliJson) ? JSON.parse(readFileSync(cliJson, 'utf-8')) : null,
      apiKey: process.env.CURSOR_API_KEY ?? null,
      ...extra,
    }) + '\n',
  );
};

if (args[0] === 'status') {
  log();
  if (args.includes('--format')) {
    process.stdout.write(JSON.stringify({ status: 'authenticated', isAuthenticated: true, userInfo: { email: 'me@example.com' } }, null, 2) + '\n');
  } else {
    process.stdout.write('\x1b[2K\x1b[G ✓ Logged in as me@example.com\n');
  }
  process.exit(0);
}

const prompt = await new Response(Bun.stdin.stream()).text();
log({ prompt });

if (process.env.FAKE_CURSOR_FAIL) {
  process.stdout.write(`${process.env.FAKE_CURSOR_FAIL}\n`);
  process.exit(1);
}

const usage = { inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0 };
const out = (result: string) => {
  process.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result, session_id: 's', usage }) + '\n');
  // Some real builds print the result and then never exit.
  if (process.env.FAKE_CURSOR_HANG) setInterval(() => {}, 1_000);
};

const firstTool = prompt.match(/^- name: (\S+)/m)?.[1];
if (!firstTool) {
  out(`echo: ${prompt.match(/### User\n([\s\S]*?)\n\n/)?.[1] ?? ''}`);
} else if (!prompt.includes('### Tool result')) {
  out(`Let me look that up.\n\`\`\`json\n{"tool_calls": [{"name": "${firstTool}", "args": {"ticker": "005930"}}], "answer": ""}\n\`\`\``);
} else {
  const result = prompt.match(/### Tool result \([^)]*\)\n(.*)/)?.[1] ?? '';
  out(JSON.stringify({ tool_calls: [], answer: `Price is ${result}` }));
}
