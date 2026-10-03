import type { ProviderMeta } from '../../../shared/types';
import { CLAUDE_CODE_INSTALL_URL, type ClaudeCodeAuth } from '../useClaudeCode';
import { ClaudeIcon, OpenAIIcon } from './BrandIcons';

/** Providers whose ids are free-form — no fixed catalog to show as cards. */
const FREE_FORM = new Set(['openrouter', 'ollama', 'ollama-cloud']);
/** Always shown (greyed out until connected in Settings); the rest only once connected. */
const PINNED = ['claude-code', 'openai-codex'];

export function ProviderIcon({ id }: { id: string }): JSX.Element {
  if (id === 'claude-code' || id === 'anthropic') return <ClaudeIcon size={15} className="mg-brand" />;
  if (id === 'openai-codex' || id === 'openai') return <OpenAIIcon size={15} className="mg-brand" />;
  return <span className="mg-icon">●</span>;
}

interface Props {
  providers: ProviderMeta[];
  /** providerId → usable right now (key stored / logged in). */
  connected: Record<string, boolean>;
  selectedModelId?: string;
  claude: ClaudeCodeAuth;
  onSelect(providerId: string, modelId: string): void;
  onOpenSettings?(): void;
}

/** Model cards in one column per provider (Claude | Codex | …), selected one ticked. */
export default function ModelGrid({
  providers,
  connected,
  selectedModelId,
  claude,
  onSelect,
  onOpenSettings,
}: Props): JSX.Element {
  const columns = providers
    .filter((p) => !FREE_FORM.has(p.id) && p.models.length > 0)
    .filter((p) => PINNED.includes(p.id) || connected[p.id])
    .sort((a, b) => rank(a.id) - rank(b.id));

  return (
    <div className="mg" style={{ gridTemplateColumns: `repeat(${columns.length}, 168px)` }}>
      {columns.map((p) => {
        const usable = !!connected[p.id];
        return (
          <div key={p.id} className="mg-col">
            <div className="mg-head">
              <ProviderIcon id={p.id} />
              <span className="mg-title">{p.shortName ?? p.displayName}</span>
              {!usable && <ConnectAction provider={p} claude={claude} onOpenSettings={onOpenSettings} />}
            </div>
            {p.models.map((m) => {
              const selected = m.id === selectedModelId;
              return (
                <button
                  key={m.id}
                  className={`mg-card${selected ? ' selected' : ''}`}
                  disabled={!usable}
                  title={usable ? m.id : undefined}
                  onClick={() => onSelect(p.id, m.id)}
                >
                  <span className="mg-label">{m.label}</span>
                  {selected && <span className="mg-check">✓</span>}
                </button>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

function rank(id: string): number {
  const i = PINNED.indexOf(id);
  return i === -1 ? PINNED.length : i;
}

function ConnectAction({
  provider,
  claude,
  onOpenSettings,
}: {
  provider: ProviderMeta;
  claude: ClaudeCodeAuth;
  onOpenSettings?: () => void;
}): JSX.Element | null {
  // Subscription logins live in Settings → 에이전트, not in the picker.
  if (provider.authType === 'cli') {
    if (claude.status?.installed !== false) return null;
    return (
      <a className="mg-connect" href={CLAUDE_CODE_INSTALL_URL} target="_blank" rel="noreferrer">
        설치 필요
      </a>
    );
  }
  if (provider.authType === 'oauth') return null;
  if (!onOpenSettings) return <span className="mg-connect muted-only">API 키 필요</span>;
  return (
    <button className="mg-connect" onClick={onOpenSettings}>
      API 키 필요
    </button>
  );
}
