// KR research eval runner — fire a single query at the agent and print the tool
// trace + final answer. For manual before/after comparison and regression probing.
//
//   bun run scripts/kr-eval.ts "삼성전자 지금 투자 관점에서 어때?"
//   KR_RUNNER_MODEL=gpt-5.5 bun run scripts/kr-eval.ts "<query>"
//
// Requires the same env as the app (DART_API_KEY, an LLM provider key, etc.).
import { config } from 'dotenv';
config({ quiet: true });

import { Agent } from '../src/agent/agent.js';

const query = process.argv.slice(2).join(' ').trim();
if (!query) {
  console.error('Usage: bun run scripts/kr-eval.ts "<query>"');
  process.exit(1);
}

const preview = (s: string, n = 320) =>
  s.length > n ? s.slice(0, n).replace(/\n/g, ' ') + ` …[${s.length} chars]` : s.replace(/\n/g, ' ');

const agent = await Agent.create({
  model: process.env.KR_RUNNER_MODEL ?? 'gpt-5.5',
  channel: 'cli',
  memoryEnabled: false,
  maxIterations: 10,
});

console.log('QUERY:', query);
console.log('='.repeat(80));

let finalAnswer = '';
const toolsCalled: string[] = [];

for await (const ev of agent.run(query)) {
  switch (ev.type) {
    case 'tool_start':
      toolsCalled.push(ev.tool);
      console.log(`\n[tool_start] ${ev.tool}  ${JSON.stringify(ev.args).slice(0, 200)}`);
      break;
    case 'tool_end':
      console.log(`[tool_end]   ${ev.tool}  (${ev.duration}ms)  -> ${preview(ev.result)}`);
      break;
    case 'tool_error':
      console.log(`[tool_error] ${ev.tool}  -> ${ev.error}`);
      break;
    case 'thinking':
      console.log(`[thinking] ${preview(ev.message, 200)}`);
      break;
    case 'done':
      finalAnswer = ev.answer;
      console.log('\n' + '='.repeat(80));
      console.log(`DONE  iterations=${ev.iterations}  time=${ev.totalTime}ms  tokens=${JSON.stringify(ev.tokenUsage)}`);
      console.log(`tools (in order): ${toolsCalled.join(' -> ') || '(none)'}`);
      break;
  }
}

console.log('\n' + '#'.repeat(80) + '\nFINAL ANSWER:\n');
console.log(finalAnswer);
console.log('#'.repeat(80));
process.exit(0);
