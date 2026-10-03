/**
 * LLM provider metadata for the desktop settings UI.
 *
 * ⚠️ Kept in sync (by hand for now) with two core sources of truth:
 *   - provider ids / displayName / apiKeyEnvVar → `../../../src/providers.ts`
 *   - defaultModel / models → the per-provider model lists in
 *     `../../../src/utils/model.ts` (PROVIDER_MODELS). `defaultModel` must be
 *     the FIRST id there (matches `getDefaultModelForProvider`), and every
 *     `models` id + label must match that list — a value that isn't a real
 *     API model id 404s at call-time (e.g. the bare `gemini-3` regression).
 * Once the Bun core sidecar lands, the desktop app should fetch this list over
 * the sidecar protocol instead of duplicating it.
 *
 * `apiKeyEnvVar` is the env var name the core (`src/model/llm.ts:getApiKey`)
 * reads at runtime — so storing a key here under that name is exactly what the
 * sidecar will inject into `process.env`.
 */

import type { ProviderMeta } from '../shared/types';

export type { ProviderMeta };

export const PROVIDERS: ProviderMeta[] = [
  {
    id: 'openai',
    displayName: 'OpenAI',
    shortName: 'OpenAI API',
    apiKeyEnvVar: 'OPENAI_API_KEY',
    requiresKey: true,
    defaultModel: 'gpt-6-astra',
    models: [
      { id: 'gpt-6-astra', label: 'GPT 6 Astra' },
      { id: 'gpt-6-sol', label: 'GPT 6 Sol' },
      { id: 'gpt-6-luna', label: 'GPT 6 Luna' },
      { id: 'gpt-5.6-sol', label: 'GPT 5.6 Sol' },
      { id: 'gpt-5.6-terra', label: 'GPT 5.6 Terra' },
      { id: 'gpt-5.6-luna', label: 'GPT 5.6 Luna' },
    ],
  },
  {
    id: 'anthropic',
    displayName: 'Anthropic',
    shortName: 'Claude API',
    apiKeyEnvVar: 'ANTHROPIC_API_KEY',
    requiresKey: true,
    defaultModel: 'claude-sonnet-5',
    models: [
      { id: 'claude-sonnet-5', label: 'Sonnet 5' },
      { id: 'claude-opus-5-5', label: 'Opus 5.5' },
      { id: 'claude-fable-5-1', label: 'Fable 5.1' },
    ],
  },
  {
    id: 'claude-code',
    displayName: 'Claude Code',
    shortName: 'Claude Code',
    authType: 'cli',
    requiresKey: false,
    defaultModel: 'claude-code:claude-fable-5-1',
    models: [
      { id: 'claude-code:claude-fable-5-1', label: 'Fable 5.1' },
      { id: 'claude-code:claude-fable-5', label: 'Fable 5' },
      { id: 'claude-code:claude-opus-5-5', label: 'Opus 5.5' },
      { id: 'claude-code:claude-opus-5', label: 'Opus 5' },
      { id: 'claude-code:claude-opus-4-8', label: 'Opus 4.8' },
      { id: 'claude-code:claude-sonnet-5-5', label: 'Sonnet 5.5' },
      { id: 'claude-code:claude-sonnet-5', label: 'Sonnet 5' },
      { id: 'claude-code:claude-haiku-4-5', label: 'Haiku 4.5' },
    ],
    note: 'Claude Pro/Max — 설치된 Claude Code의 로그인을 그대로 사용',
    effortLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
  },
  {
    id: 'openai-codex',
    displayName: 'ChatGPT (Codex)',
    shortName: 'Codex',
    authType: 'oauth',
    requiresKey: false,
    defaultModel: 'codex:gpt-6-astra',
    models: [
      { id: 'codex:gpt-6-astra', label: 'GPT-6 Astra' },
      { id: 'codex:gpt-daybreak-blue-latest', label: 'Daybreak Blue' },
      { id: 'codex:gpt-6.1-sol', label: 'GPT-6.1 Sol' },
      { id: 'codex:gpt-6-sol', label: 'GPT-6 Sol' },
      { id: 'codex:gpt-6-luna', label: 'GPT-6 Luna' },
      { id: 'codex:gpt-5.6-sol', label: 'GPT-5.6 Sol' },
      { id: 'codex:gpt-5.6-terra', label: 'GPT-5.6 Terra' },
      { id: 'codex:gpt-5.6-luna', label: 'GPT-5.6 Luna' },
      { id: 'codex:gpt-5.5', label: 'GPT-5.5' },
      { id: 'codex:gpt-5.4', label: 'GPT-5.4' },
    ],
    note: 'ChatGPT Plus/Pro 구독으로 로그인 — API 키 불필요',
    effortLevels: ['low', 'medium', 'high', 'xhigh'],
  },
  {
    id: 'google',
    displayName: 'Google',
    apiKeyEnvVar: 'GOOGLE_API_KEY',
    requiresKey: true,
    defaultModel: 'gemini-3.8-flash',
    models: [
      { id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash' },
      { id: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro' },
    ],
  },
  {
    id: 'xai',
    displayName: 'xAI',
    apiKeyEnvVar: 'XAI_API_KEY',
    requiresKey: true,
    defaultModel: 'grok-4.7',
    models: [
      { id: 'grok-4.7', label: 'Grok 4.7' },
    ],
  },
  {
    id: 'moonshot',
    displayName: 'Moonshot',
    apiKeyEnvVar: 'MOONSHOT_API_KEY',
    requiresKey: true,
    defaultModel: 'kimi-k3',
    models: [
      { id: 'kimi-k3', label: 'Kimi K3' },
    ],
  },
  {
    id: 'deepseek',
    displayName: 'DeepSeek',
    apiKeyEnvVar: 'DEEPSEEK_API_KEY',
    requiresKey: true,
    defaultModel: 'deepseek-v4-pro',
    models: [
      { id: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro' },
      { id: 'deepseek-flash', label: 'DeepSeek V4.1 Flash' },
    ],
  },
  {
    id: 'openrouter',
    displayName: 'OpenRouter',
    apiKeyEnvVar: 'OPENROUTER_API_KEY',
    requiresKey: true,
    defaultModel: 'openrouter:openai/gpt-4o-mini',
    models: [
      { id: 'openrouter:openai/gpt-4o-mini', label: 'openai/gpt-4o-mini' },
      { id: 'openrouter:anthropic/claude-3.5-sonnet', label: 'anthropic/claude-3.5-sonnet' },
    ],
    note: 'Prefix model ids with "openrouter:"',
  },
  {
    id: 'ollama',
    displayName: 'Ollama',
    requiresKey: false,
    defaultModel: 'ollama:llama3.1',
    models: [
      { id: 'ollama:llama3.1', label: 'llama3.1' },
      { id: 'ollama:qwen2.5', label: 'qwen2.5' },
    ],
    note: 'Local — no API key required. Prefix model ids with "ollama:"',
  },
  {
    id: 'ollama-cloud',
    displayName: 'Ollama Cloud',
    apiKeyEnvVar: 'OLLAMA_CLOUD_API_KEY',
    requiresKey: true,
    defaultModel: 'ollama-cloud:gpt-oss:120b',
    models: [
      { id: 'ollama-cloud:gpt-oss:120b', label: 'gpt-oss:120b' },
      { id: 'ollama-cloud:qwen3-coder:480b', label: 'qwen3-coder:480b' },
    ],
    note: 'Hosted Ollama. Prefix model ids with "ollama-cloud:"',
  },
];

export function getProviderById(id: string): ProviderMeta | undefined {
  return PROVIDERS.find((p) => p.id === id);
}
