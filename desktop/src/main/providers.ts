/**
 * LLM provider metadata for the desktop settings UI.
 *
 * ⚠️ Kept in sync (by hand for now) with two core sources of truth:
 *   - provider ids / displayName / apiKeyEnvVar → `../../../src/providers.ts`
 *   - defaultModel / suggestedModels → the per-provider model lists in
 *     `../../../src/utils/model.ts` (PROVIDER_MODELS). `defaultModel` must be
 *     the FIRST id there (matches `getDefaultModelForProvider`), and every
 *     `suggestedModels` id must exist in that list — a value that isn't a real
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
    apiKeyEnvVar: 'OPENAI_API_KEY',
    requiresKey: true,
    defaultModel: 'gpt-5.5',
    suggestedModels: ['gpt-5.5', 'gpt-5.4'],
  },
  {
    id: 'anthropic',
    displayName: 'Anthropic',
    apiKeyEnvVar: 'ANTHROPIC_API_KEY',
    requiresKey: true,
    defaultModel: 'claude-sonnet-4-6',
    suggestedModels: ['claude-sonnet-4-6', 'claude-opus-4-8', 'claude-fable-5'],
  },
  {
    id: 'google',
    displayName: 'Google',
    apiKeyEnvVar: 'GOOGLE_API_KEY',
    requiresKey: true,
    defaultModel: 'gemini-3-flash-preview',
    suggestedModels: ['gemini-3-flash-preview', 'gemini-3.1-pro-preview'],
  },
  {
    id: 'xai',
    displayName: 'xAI',
    apiKeyEnvVar: 'XAI_API_KEY',
    requiresKey: true,
    defaultModel: 'grok-4-0709',
    suggestedModels: ['grok-4-0709', 'grok-4-1-fast-reasoning'],
  },
  {
    id: 'moonshot',
    displayName: 'Moonshot',
    apiKeyEnvVar: 'MOONSHOT_API_KEY',
    requiresKey: true,
    defaultModel: 'kimi-k2-5',
    suggestedModels: ['kimi-k2-5'],
  },
  {
    id: 'deepseek',
    displayName: 'DeepSeek',
    apiKeyEnvVar: 'DEEPSEEK_API_KEY',
    requiresKey: true,
    defaultModel: 'deepseek-v4-pro',
    suggestedModels: ['deepseek-v4-pro', 'deepseek-v4-flash'],
  },
  {
    id: 'openrouter',
    displayName: 'OpenRouter',
    apiKeyEnvVar: 'OPENROUTER_API_KEY',
    requiresKey: true,
    defaultModel: 'openrouter:openai/gpt-4o-mini',
    suggestedModels: ['openrouter:openai/gpt-4o-mini', 'openrouter:anthropic/claude-3.5-sonnet'],
    note: 'Prefix model ids with "openrouter:"',
  },
  {
    id: 'ollama',
    displayName: 'Ollama',
    requiresKey: false,
    defaultModel: 'ollama:llama3.1',
    suggestedModels: ['ollama:llama3.1', 'ollama:qwen2.5'],
    note: 'Local — no API key required. Prefix model ids with "ollama:"',
  },
];

export function getProviderById(id: string): ProviderMeta | undefined {
  return PROVIDERS.find((p) => p.id === id);
}
