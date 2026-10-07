import { PROVIDERS as PROVIDER_DEFS } from '@/providers';

export interface Model {
  id: string;
  displayName: string;
}

interface Provider {
  displayName: string;
  providerId: string;
  models: Model[];
}

const PROVIDER_MODELS: Record<string, Model[]> = {
  openai: [
    { id: 'gpt-6-astra', displayName: 'GPT 6 Astra' },
    { id: 'gpt-6-sol', displayName: 'GPT 6 Sol' },
    { id: 'gpt-6-luna', displayName: 'GPT 6 Luna' },
    // Fork policy: keep the immediately-previous generation selectable. Upstream
    // drops it from the catalog; we retain it (and skip its auto-upgrade in
    // config.ts) so an existing GPT-5.6 choice is never silently rewritten.
    { id: 'gpt-5.6-sol', displayName: 'GPT 5.6 Sol' },
    { id: 'gpt-5.6-terra', displayName: 'GPT 5.6 Terra' },
    { id: 'gpt-5.6-luna', displayName: 'GPT 5.6 Luna' },
  ],
  anthropic: [
    { id: 'claude-sonnet-5', displayName: 'Sonnet 5' },
    { id: 'claude-opus-5-5', displayName: 'Opus 5.5' },
    { id: 'claude-fable-5-1', displayName: 'Fable 5.1' },
  ],
  // Run through the user's Claude Code CLI login. The prefix is routing only;
  // the bare id after it is what `claude --model` receives.
  'claude-code': [
    { id: 'claude-code:claude-fable-5-1', displayName: 'Fable 5.1' },
    { id: 'claude-code:claude-fable-5', displayName: 'Fable 5' },
    { id: 'claude-code:claude-opus-5-5', displayName: 'Opus 5.5' },
    { id: 'claude-code:claude-opus-5', displayName: 'Opus 5' },
    { id: 'claude-code:claude-opus-4-8', displayName: 'Opus 4.8' },
    { id: 'claude-code:claude-sonnet-5-5', displayName: 'Sonnet 5.5' },
    { id: 'claude-code:claude-sonnet-5', displayName: 'Sonnet 5' },
    { id: 'claude-code:claude-haiku-4-5', displayName: 'Haiku 4.5' },
  ],
  // ChatGPT-subscription models (OAuth). Ids carry the `codex:` routing prefix so
  // they never collide with the same-named OpenAI API-key models above.
  'openai-codex': [
    { id: 'codex:gpt-6-astra', displayName: 'GPT-6 Astra' },
    { id: 'codex:gpt-daybreak-blue-latest', displayName: 'Daybreak Blue' },
    { id: 'codex:gpt-6.1-sol', displayName: 'GPT-6.1 Sol' },
    { id: 'codex:gpt-6-sol', displayName: 'GPT-6 Sol' },
    { id: 'codex:gpt-6-luna', displayName: 'GPT-6 Luna' },
    { id: 'codex:gpt-5.6-sol', displayName: 'GPT-5.6 Sol' },
    { id: 'codex:gpt-5.6-terra', displayName: 'GPT-5.6 Terra' },
    { id: 'codex:gpt-5.6-luna', displayName: 'GPT-5.6 Luna' },
    { id: 'codex:gpt-5.5', displayName: 'GPT-5.5' },
    { id: 'codex:gpt-5.4', displayName: 'GPT-5.4' },
  ],
  // Through the user's Cursor Agent CLI. Ids after `cursor:` are `cursor-agent
  // --model` values (from its "Available models" list); effort is baked into the
  // id, so the high tier is pinned rather than exposing an effort control.
  cursor: [
    { id: 'cursor:auto', displayName: 'Auto' },
    { id: 'cursor:composer-2.5', displayName: 'Composer 2.5' },
    { id: 'cursor:claude-fable-5-1-high', displayName: 'Fable 5.1' },
    { id: 'cursor:claude-opus-5-5-high', displayName: 'Opus 5.5' },
    { id: 'cursor:claude-sonnet-5-5-high', displayName: 'Sonnet 5.5' },
    { id: 'cursor:gpt-5.6-sol-high', displayName: 'GPT-5.6 Sol' },
    { id: 'cursor:grok-4.7-high', displayName: 'Grok 4.7' },
  ],
  xai: [{ id: 'grok-4.7', displayName: 'Grok 4.7' }],
  moonshot: [{ id: 'kimi-k3', displayName: 'Kimi K3' }],
  deepseek: [
    { id: 'deepseek-v4-pro', displayName: 'DeepSeek V4 Pro' },
    { id: 'deepseek-flash', displayName: 'DeepSeek V4.1 Flash' },
  ],
};

export const PROVIDERS: Provider[] = PROVIDER_DEFS.map((provider) => ({
  displayName: provider.displayName,
  providerId: provider.id,
  models: PROVIDER_MODELS[provider.id] ?? [],
}));

export function getModelsForProvider(providerId: string): Model[] {
  const provider = PROVIDERS.find((entry) => entry.providerId === providerId);
  return provider?.models ?? [];
}

export function getModelIdsForProvider(providerId: string): string[] {
  return getModelsForProvider(providerId).map((model) => model.id);
}

export function getDefaultModelForProvider(providerId: string): string | undefined {
  const models = getModelsForProvider(providerId);
  return models[0]?.id;
}

export function getModelDisplayName(modelId: string): string {
  const normalizedId = modelId.replace(/^(ollama|ollama-cloud|openrouter):/, '');

  for (const provider of PROVIDERS) {
    const model = provider.models.find((entry) => entry.id === normalizedId || entry.id === modelId);
    if (model) {
      return model.displayName;
    }
  }

  return normalizedId;
}
