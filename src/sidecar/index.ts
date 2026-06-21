#!/usr/bin/env bun
/**
 * Headless Bun core sidecar for the desktop app.
 *
 * Reads SidecarRequest lines on stdin, drives Agent.run(), and streams
 * SidecarMessage lines on stdout. Runs the SAME agent core as the CLI/gateway —
 * this is just another consumer of the AgentEvent generator (cf. gateway/agent-runner.ts).
 *
 * API keys are expected in process.env (injected by the shell at spawn time);
 * the core's getApiKey() reads them there.
 */
import { createInterface } from 'node:readline';
import { config } from 'dotenv';
import { z } from 'zod';
import { Agent } from '../agent/agent.js';
import { callLlm } from '../model/llm.js';
import { InMemoryChatHistory } from '../utils/in-memory-chat-history.js';
import type { DoneEvent } from '../agent/types.js';
import type { SidecarRequest, SidecarMessage, ConvertResult } from './protocol.js';

// stdout is the protocol channel — keep stray logging off it.
console.log = (...args: unknown[]) => process.stderr.write(args.map(String).join(' ') + '\n');
console.info = console.log;

config({ quiet: true });

// Conversation history is in-memory only (volatile) — fine for the desktop use case.
const history = new InMemoryChatHistory();
const activeRuns = new Map<string, AbortController>();

function send(msg: SidecarMessage): void {
  process.stdout.write(JSON.stringify(msg) + '\n');
}

async function handleRun(req: Extract<SidecarRequest, { type: 'run' }>): Promise<void> {
  const controller = new AbortController();
  activeRuns.set(req.id, controller);
  history.setModel(req.model);
  history.saveUserQuery(req.query);

  let answer = '';
  try {
    const agent = await Agent.create({
      model: req.model,
      modelProvider: req.modelProvider,
      maxIterations: req.maxIterations,
      signal: controller.signal,
      // Persistent memory off for the first cut — keeps the sidecar dependency-light.
      memoryEnabled: false,
    });

    for await (const event of agent.run(req.query, history)) {
      send({ type: 'event', id: req.id, event });
      if (event.type === 'done') {
        answer = (event as DoneEvent).answer;
      }
    }

    if (answer) {
      await history.saveAnswer(answer).catch(() => {});
    }
    send({ type: 'done', id: req.id, answer });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    send({ type: 'error', id: req.id, message });
  } finally {
    activeRuns.delete(req.id);
  }
}

// ── ledger → DART standard accounts (single structured LLM call) ────────────
const CONVERT_SCHEMA = z.object({
  mappings: z.array(
    z.object({
      original: z.string(),
      standard: z.string(),
      amount: z.number(),
      statement: z.string(),
      // Required (OpenAI structured output rejects optional keys); empty string when none.
      note: z.string(),
    }),
  ),
  warnings: z.array(z.string()),
});

const CONVERT_SYSTEM_PROMPT =
  '당신은 한국 회계·DART 전자공시 전문가입니다. 회사 장부 계정을 DART 표준 재무제표 계정과목(택사노미)에 정확히 매핑하고, 불확실한 항목은 note로 표시합니다. 금액을 임의로 만들지 말고 입력에 있는 값만 사용하세요.';

async function handleConvert(req: Extract<SidecarRequest, { type: 'convert' }>): Promise<void> {
  try {
    const prompt = `다음은 회사의 시산표/장부 데이터입니다(엑셀에서 복사). 각 계정을 한국 DART 전자공시 표준 재무제표 계정과목으로 매핑하세요.

규칙:
- original: 원본 계정명 그대로
- standard: 가장 적합한 DART 표준 계정과목 (예: 보통예금→현금및현금성자산, 외상매출금→매출채권, 미지급금→미지급금)
- amount: 금액 (숫자만, 콤마 제거)
- statement: BS(재무상태표)/IS(손익계산서)/CF(현금흐름표) 중 하나, 불명확하면 "기타"
- note: 매핑이 애매하거나 확인이 필요하면 사유를 한국어로, 없으면 빈 문자열("")
- warnings: 전체적으로 누락·이상·검토 필요 사항 (차변/대변 불일치, 합계 오류 등)

원본 데이터:
${req.rawData}`;

    const { response } = await callLlm(prompt, {
      model: req.model,
      systemPrompt: CONVERT_SYSTEM_PROMPT,
      outputSchema: CONVERT_SCHEMA,
    });

    send({ type: 'convert_result', id: req.id, result: response as unknown as ConvertResult });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    send({ type: 'error', id: req.id, message });
  }
}

const rl = createInterface({ input: process.stdin });
rl.on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;

  let req: SidecarRequest;
  try {
    req = JSON.parse(trimmed) as SidecarRequest;
  } catch {
    return; // ignore malformed lines
  }

  if (req.type === 'run') {
    void handleRun(req);
  } else if (req.type === 'cancel') {
    activeRuns.get(req.id)?.abort();
  } else if (req.type === 'convert') {
    void handleConvert(req);
  } else if (req.type === 'reset') {
    history.clear();
  }
});

send({ type: 'ready' });
