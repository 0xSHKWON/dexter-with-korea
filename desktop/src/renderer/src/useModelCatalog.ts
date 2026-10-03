import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AppSettings, ProviderMeta } from '../../shared/types';
import { useCodexAuth, type CodexAuth } from './useCodexAuth';
import { useClaudeCode, type ClaudeCodeAuth } from './useClaudeCode';

export interface ModelCatalog {
  loading: boolean;
  providers: ProviderMeta[];
  connected: Record<string, boolean>;
  settings: AppSettings;
  codex: CodexAuth;
  claude: ClaudeCodeAuth;
  /** Persist provider + model as the default for new runs. */
  select(providerId: string, modelId: string): Promise<void>;
  /** Persist the reasoning effort for a provider; undefined = provider default. */
  setEffort(providerId: string, level: string | undefined): Promise<void>;
  reload(): Promise<void>;
}

// Chat and Settings each hold a catalog and both stay mounted (hidden views), so a
// pick in one must tell the other.
const MODEL_CHANGED = 'dexter:model-changed';

/** Provider catalog + which providers are usable now (key stored or ChatGPT logged in). */
export function useModelCatalog(): ModelCatalog {
  const codex = useCodexAuth();
  const claude = useClaudeCode();
  const [loading, setLoading] = useState(true);
  const [providers, setProviders] = useState<ProviderMeta[]>([]);
  const [keys, setKeys] = useState<Record<string, boolean>>({});
  const [settings, setSettings] = useState<AppSettings>({});

  const reload = useCallback(async () => {
    const [provs, secs, setts] = await Promise.all([
      window.dexter.providers.list(),
      window.dexter.secrets.statusAll(),
      window.dexter.settings.getAll(),
    ]);
    setProviders(provs);
    setKeys(Object.fromEntries(secs.map((s) => [s.envVar, s.exists])));
    setSettings(setts);
    setLoading(false);
  }, []);

  useEffect(() => {
    void reload();
    const onChanged = () => void reload();
    window.addEventListener(MODEL_CHANGED, onChanged);
    return () => window.removeEventListener(MODEL_CHANGED, onChanged);
  }, [reload]);

  const connected = useMemo(
    () =>
      Object.fromEntries(
        providers.map((p) => [
          p.id,
          p.authType === 'oauth'
            ? !!codex.status?.loggedIn
            : p.authType === 'cli'
              ? !!claude.status?.loggedIn
              : !p.requiresKey || (!!p.apiKeyEnvVar && !!keys[p.apiKeyEnvVar]),
        ]),
      ),
    [providers, keys, codex.status, claude.status],
  );

  const select = useCallback(async (providerId: string, modelId: string) => {
    await window.dexter.settings.set('provider', providerId);
    await window.dexter.settings.set('modelId', modelId);
    setSettings((s) => ({ ...s, provider: providerId, modelId }));
    window.dispatchEvent(new Event(MODEL_CHANGED));
  }, []);

  const setEffort = useCallback(
    async (providerId: string, level: string | undefined) => {
      const next = { ...(settings.effort ?? {}) };
      if (level) next[providerId] = level;
      else delete next[providerId];
      await window.dexter.settings.set('effort', next);
      setSettings((s) => ({ ...s, effort: next }));
      window.dispatchEvent(new Event(MODEL_CHANGED));
    },
    [settings.effort],
  );

  return { loading, providers, connected, settings, codex, claude, select, setEffort, reload };
}
