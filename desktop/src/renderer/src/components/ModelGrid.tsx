import type { ProviderMeta } from '../../../shared/types';
import type { CodexAuth } from '../useCodexAuth';
import { CLAUDE_CODE_INSTALL_URL, type ClaudeCodeAuth } from '../useClaudeCode';

/** Providers whose ids are free-form — no fixed catalog to show as cards. */
const FREE_FORM = new Set(['openrouter', 'ollama', 'ollama-cloud']);
/** Always shown (with a connect action when unusable); the rest only once connected. */
const PINNED = ['claude-code', 'openai-codex'];

function ProviderIcon({ id }: { id: string }): JSX.Element {
  if (id === 'claude-code' || id === 'anthropic') return <span className="mg-icon mg-icon-claude">✳</span>;
  if (id === 'openai-codex') return <span className="mg-icon mg-icon-codex">{'>_'}</span>;
  return <span className="mg-icon">●</span>;
}

interface Props {
  providers: ProviderMeta[];
  /** providerId → usable right now (key stored / logged in). */
  connected: Record<string, boolean>;
  selectedModelId?: string;
  codex: CodexAuth;
  claude: ClaudeCodeAuth;
  onSelect(providerId: string, modelId: string): void;
  onOpenSettings?(): void;
}

/** Model cards in one column per provider (Claude | Codex | …), selected one ticked. */
export default function ModelGrid({
  providers,
  connected,
  selectedModelId,
  codex,
  claude,
  onSelect,
  onOpenSettings,
}: Props): JSX.Element {
  const columns = providers
    .filter((p) => !FREE_FORM.has(p.id) && p.models.length > 0)
    .filter((p) => PINNED.includes(p.id) || connected[p.id])
    .sort((a, b) => rank(a.id) - rank(b.id));

  return (
    <div className="mg" style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(190px, 1fr))` }}>
      {columns.map((p) => {
        const usable = !!connected[p.id];
        return (
          <div key={p.id} className="mg-col">
            <div className="mg-head">
              <ProviderIcon id={p.id} />
              <span className="mg-title">{p.shortName ?? p.displayName}</span>
              {!usable && <ConnectAction provider={p} codex={codex} claude={claude} onOpenSettings={onOpenSettings} />}
            </div>
            {p.id === 'openai-codex' && codex.device && (
              <div className="mg-device">
                <a href={codex.device.url} target="_blank" rel="noreferrer">
                  {codex.device.url.replace(/^https:\/\//, '')}
                </a>
                에서 코드 입력 <code>{codex.device.userCode}</code>
              </div>
            )}
            {p.id === 'openai-codex' && codex.error && <div className="mg-error">{codex.error}</div>}
            {p.id === 'claude-code' && claude.error && <div className="mg-error">{claude.error}</div>}
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
  codex,
  claude,
  onOpenSettings,
}: {
  provider: ProviderMeta;
  codex: CodexAuth;
  claude: ClaudeCodeAuth;
  onOpenSettings?: () => void;
}): JSX.Element | null {
  if (provider.authType === 'cli') {
    if (!claude.status) return null;
    if (!claude.status.installed) {
      return (
        <a className="mg-connect" href={CLAUDE_CODE_INSTALL_URL} target="_blank" rel="noreferrer">
          설치 필요
        </a>
      );
    }
    return claude.busy ? (
      <button className="mg-connect" onClick={claude.cancel}>
        로그인 중… 취소
      </button>
    ) : (
      <button className="mg-connect" onClick={() => void claude.login()}>
        Claude 로그인
      </button>
    );
  }
  if (provider.authType === 'oauth') {
    return codex.busy ? (
      <button className="mg-connect" onClick={codex.cancel}>
        로그인 중… 취소
      </button>
    ) : (
      <button className="mg-connect" onClick={() => void codex.login('browser')}>
        ChatGPT 로그인
      </button>
    );
  }
  if (!onOpenSettings) return <span className="mg-connect muted-only">API 키 필요</span>;
  return (
    <button className="mg-connect" onClick={onOpenSettings}>
      API 키 필요
    </button>
  );
}
