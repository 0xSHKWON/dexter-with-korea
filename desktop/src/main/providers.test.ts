/**
 * The desktop provider catalog is hand-synced with the core (see the header of
 * providers.ts). Nothing in CI noticed when the upstream v1.0.3 merge retired
 * `gpt-5.4` from the core catalog while this file still suggested it — a desktop
 * user picking it would 404 at call-time. These tests turn that drift into a
 * failing check.
 */
import { describe, expect, it } from 'bun:test';
import { PROVIDERS as DESKTOP_PROVIDERS } from './providers.js';
import { PROVIDERS as CORE_PROVIDERS } from '../../../src/providers.js';
import { getModelIdsForProvider, getDefaultModelForProvider } from '../../../src/utils/model.js';

/** Providers whose model ids are free-form (no core catalog to check against). */
const FREE_FORM = new Set(['openrouter', 'ollama', 'ollama-cloud']);

const catalogued = DESKTOP_PROVIDERS.filter((p) => !FREE_FORM.has(p.id));

describe('desktop provider catalog stays in sync with the core', () => {
  it('every desktop provider id exists in the core registry', () => {
    const coreIds = new Set(CORE_PROVIDERS.map((p) => p.id));
    for (const p of DESKTOP_PROVIDERS) {
      expect({ id: p.id, known: coreIds.has(p.id) }).toEqual({ id: p.id, known: true });
    }
  });

  it('every suggested model id exists in the core catalog', () => {
    for (const p of catalogued) {
      const known = getModelIdsForProvider(p.id);
      for (const model of p.suggestedModels) {
        expect({ provider: p.id, model, known: known.includes(model) }).toEqual({
          provider: p.id,
          model,
          known: true,
        });
      }
    }
  });

  it('defaultModel matches the core default for that provider', () => {
    for (const p of catalogued) {
      expect({ id: p.id, def: p.defaultModel }).toEqual({
        id: p.id,
        def: getDefaultModelForProvider(p.id),
      });
    }
  });

  it('apiKeyEnvVar matches the core registry', () => {
    for (const p of DESKTOP_PROVIDERS) {
      const core = CORE_PROVIDERS.find((c) => c.id === p.id);
      expect({ id: p.id, env: p.apiKeyEnvVar }).toEqual({ id: p.id, env: core?.apiKeyEnvVar });
    }
  });
});
