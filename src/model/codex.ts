/**
 * ChatGPT-subscription (Codex) backend as a LangChain chat model.
 *
 * The backend at chatgpt.com/backend-api/codex speaks the OpenAI Responses API
 * with a few hard constraints, so we reuse ChatOpenAI (Responses mode) and patch
 * the wire request in a custom fetch:
 *   - auth is the OAuth access token + `chatgpt-account-id`, not an API key
 *   - `store` must be false and `stream` must be true (non-stream calls are rejected)
 *   - the system prompt goes in top-level `instructions`, not in `input`
 *   - `max_output_tokens` / `previous_response_id` are unsupported
 */
import { ChatOpenAI } from '@langchain/openai';
import { getValidCredentials } from '@/auth/store';
import { getCodexAccountId } from '@/auth/openai-codex';

const CODEX_BASE_URL = 'https://chatgpt.com/backend-api/codex';
export const CODEX_MODEL_PREFIX = 'codex:';

type ResponsesInputItem = { type?: string; role?: string; content?: unknown };

function isInstructionItem(item: unknown): item is ResponsesInputItem {
  if (!item || typeof item !== 'object') return false;
  const { type, role } = item as ResponsesInputItem;
  return (type === undefined || type === 'message') && (role === 'system' || role === 'developer');
}

function textOf(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((part) => (part && typeof part === 'object' && 'text' in part ? String(part.text) : ''))
    .filter(Boolean)
    .join('\n');
}

/** Rewrite a Responses API request body into what the Codex backend accepts. */
export function transformCodexBody(body: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...body };
  const input = Array.isArray(body.input) ? [...(body.input as unknown[])] : [];

  const instructions: string[] = [];
  if (typeof body.instructions === 'string' && body.instructions) instructions.push(body.instructions);
  while (input.length > 0 && isInstructionItem(input[0])) {
    const text = textOf((input.shift() as ResponsesInputItem).content);
    if (text) instructions.push(text);
  }

  out.instructions = instructions.join('\n\n') || 'You are a helpful assistant.';
  out.input = input;
  out.store = false;
  out.stream = true;
  const include = new Set(Array.isArray(body.include) ? (body.include as string[]) : []);
  include.add('reasoning.encrypted_content');
  out.include = [...include];
  delete out.max_output_tokens;
  delete out.previous_response_id;
  return out;
}

async function codexFetch(url: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const creds = await getValidCredentials('openai-codex');
  const accountId = creds.accountId ?? getCodexAccountId(creds.access);
  if (!accountId) throw new Error('ChatGPT account id missing — run /login again.');

  const headers = new Headers(init?.headers);
  headers.set('Authorization', `Bearer ${creds.access}`);
  headers.set('chatgpt-account-id', accountId);
  headers.set('OpenAI-Beta', 'responses=experimental');
  headers.set('originator', 'dexter');
  headers.set('Accept', 'text/event-stream');

  let body = init?.body;
  if (typeof body === 'string') {
    try {
      body = JSON.stringify(transformCodexBody(JSON.parse(body) as Record<string, unknown>));
    } catch {
      // not JSON — pass through untouched
    }
  }
  return fetch(url, { ...init, headers, body });
}

export function createCodexChatModel(name: string): ChatOpenAI {
  return new ChatOpenAI({
    model: name.slice(name.startsWith(CODEX_MODEL_PREFIX) ? CODEX_MODEL_PREFIX.length : 0),
    // The backend only streams; LangChain's invoke() aggregates the stream when this is on.
    streaming: true,
    useResponsesApi: true,
    // store:false on the wire, and no server-side item ids in replayed history
    // (reasoning items are replayed only via their encrypted content).
    zdrEnabled: true,
    // Required by the SDK constructor; codexFetch replaces the Authorization header.
    apiKey: 'chatgpt-oauth',
    configuration: {
      baseURL: CODEX_BASE_URL,
      fetch: codexFetch,
    },
  });
}
