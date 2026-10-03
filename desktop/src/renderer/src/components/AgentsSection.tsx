import { useEffect, useState } from 'react';
import type { SecretStatus } from '../../../shared/types';
import { CLAUDE_CODE_INSTALL_URL, type ClaudeCodeAuth } from '../useClaudeCode';
import type { CodexAuth } from '../useCodexAuth';
import KeyCard from './KeyCard';
import { ClaudeIcon, OpenAIIcon } from './BrandIcons';

type AgentId = 'claude-code' | 'codex';
type AuthMode = 'login' | 'apiKey';

interface Props {
  claude: ClaudeCodeAuth;
  codex: CodexAuth;
  statuses: Record<string, SecretStatus>;
  onChanged: (message: string) => void | Promise<void>;
}

const SUBSCRIPTION: Record<string, string> = { pro: 'Claude Pro', max: 'Claude Max', team: 'Claude Team', enterprise: 'Claude Enterprise' };
const API_PROVIDER: Record<string, string> = { firstParty: 'Anthropic API', bedrock: 'Amazon Bedrock', vertex: 'Google Vertex AI', foundry: 'Microsoft Foundry' };

/** Settings → 에이전트: one tab per subscription agent, each with login vs API-key auth. */
export default function AgentsSection({ claude, codex, statuses, onChanged }: Props): JSX.Element {
  const [agent, setAgent] = useState<AgentId>('claude-code');

  return (
    <section className="card agents">
      <h2>에이전트</h2>
      <div className="agent-tabs" role="tablist">
        <button role="tab" className={`agent-tab ${agent === 'claude-code' ? 'active' : ''}`} onClick={() => setAgent('claude-code')}>
          <ClaudeIcon /> Claude Code
        </button>
        <button role="tab" className={`agent-tab ${agent === 'codex' ? 'active' : ''}`} onClick={() => setAgent('codex')}>
          <OpenAIIcon /> Codex
        </button>
      </div>
      {agent === 'claude-code' ? (
        <ClaudeCodePanel claude={claude} keyStatus={statuses['ANTHROPIC_API_KEY']} onChanged={onChanged} />
      ) : (
        <CodexPanel codex={codex} keyStatus={statuses['OPENAI_API_KEY']} onChanged={onChanged} />
      )}
    </section>
  );
}

function AuthCards({
  mode,
  onMode,
  loginLabel,
  loginIcon,
  loginOn,
  keyOn,
}: {
  mode: AuthMode;
  onMode: (m: AuthMode) => void;
  loginLabel: string;
  loginIcon: React.ReactNode;
  loginOn: boolean;
  keyOn: boolean;
}): JSX.Element {
  return (
    <>
      <h3 className="agent-sub">인증</h3>
      <div className="auth-cards">
        <button className={`auth-card ${mode === 'login' ? 'selected' : ''}`} onClick={() => onMode('login')}>
          {loginOn && <span className="auth-check">✓</span>}
          <span className="auth-icon">{loginIcon}</span>
          <span className="auth-label">{loginLabel}</span>
        </button>
        <button className={`auth-card ${mode === 'apiKey' ? 'selected' : ''}`} onClick={() => onMode('apiKey')}>
          {keyOn && <span className="auth-check">✓</span>}
          <span className="auth-icon">⚿</span>
          <span className="auth-label">API 키</span>
        </button>
      </div>
    </>
  );
}

/** Starts on whichever method is already connected (login first). */
function useInitialMode(loginOn: boolean | undefined, keyOn: boolean): [AuthMode, (m: AuthMode) => void] {
  const [mode, setMode] = useState<AuthMode>('login');
  const [touched, setTouched] = useState(false);
  useEffect(() => {
    if (!touched && loginOn === false && keyOn) setMode('apiKey');
  }, [loginOn, keyOn, touched]);
  return [
    mode,
    (m) => {
      setTouched(true);
      setMode(m);
    },
  ];
}

function StatusRow({
  state,
  label,
  onRefresh,
  refreshing,
}: {
  state: 'on' | 'off' | 'warn';
  label: string;
  onRefresh: () => void;
  refreshing: boolean;
}): JSX.Element {
  return (
    <div className="agent-status">
      <span className={`agent-dot ${state}`} />
      <span className="agent-status-label">{label}</span>
      <button className="agent-refresh" onClick={onRefresh} disabled={refreshing}>
        ↻ {refreshing ? '확인 중…' : '새로고침'}
      </button>
    </div>
  );
}

function InfoTable({ rows }: { rows: [string, string | undefined][] }): JSX.Element | null {
  const shown = rows.filter((r): r is [string, string] => !!r[1]);
  if (shown.length === 0) return null;
  return (
    <div className="info-table">
      {shown.map(([k, v]) => (
        <div key={k} className="info-row">
          <div className="info-key">{k}</div>
          <div className="info-val">{v}</div>
        </div>
      ))}
    </div>
  );
}

function useRefreshing(refresh: () => Promise<void>): [boolean, () => void] {
  const [busy, setBusy] = useState(false);
  return [
    busy,
    () => {
      setBusy(true);
      void refresh().finally(() => setBusy(false));
    },
  ];
}

function ClaudeCodePanel({
  claude,
  keyStatus,
  onChanged,
}: {
  claude: ClaudeCodeAuth;
  keyStatus?: SecretStatus;
  onChanged: Props['onChanged'];
}): JSX.Element {
  const s = claude.status;
  const [mode, setMode] = useInitialMode(s ? s.loggedIn : undefined, !!keyStatus?.exists);
  const [refreshing, refresh] = useRefreshing(claude.refresh);

  return (
    <>
      <AuthCards mode={mode} onMode={setMode} loginLabel="CLI" loginIcon=">_" loginOn={!!s?.loggedIn} keyOn={!!keyStatus?.exists} />
      {mode === 'login' ? (
        <>
          <StatusRow
            state={s?.loggedIn ? 'on' : s?.installed ? 'warn' : 'off'}
            label={!s ? '확인 중…' : s.loggedIn ? '연결됨' : s.installed ? '로그인 필요' : '설치되지 않음'}
            onRefresh={refresh}
            refreshing={refreshing}
          />
          <InfoTable
            rows={[
              ['버전', s?.version],
              ['제공자', s?.apiProvider ? (API_PROVIDER[s.apiProvider] ?? s.apiProvider) : undefined],
              [
                '로그인 방식',
                s?.loggedIn
                  ? s.authMethod === 'claude.ai'
                    ? `${SUBSCRIPTION[s.subscriptionType ?? ''] ?? 'Claude'} 계정`
                    : s.authMethod
                  : undefined,
              ],
              ['조직', s?.orgName],
              ['이메일', s?.email],
              ['실행 파일', s?.path],
            ]}
          />
          <div className="agent-actions">
            {s && !s.installed ? (
              <a className="btn" href={CLAUDE_CODE_INSTALL_URL} target="_blank" rel="noreferrer">
                Claude Code 설치 ↗
              </a>
            ) : claude.busy ? (
              <>
                <span className="agent-note">브라우저에서 Claude 로그인을 완료하세요…</span>
                <button className="btn" onClick={claude.cancel}>
                  취소
                </button>
              </>
            ) : (
              <button
                className="btn"
                disabled={!s}
                onClick={() => void claude.login().then((ok) => ok && onChanged('Claude Code 연결됨'))}
              >
                ▶ claude /login 실행
              </button>
            )}
          </div>
          {claude.error && <p className="key-error">{claude.error}</p>}
          <ClaudePathSetting onSaved={() => void claude.refresh().then(() => onChanged('실행 경로 저장됨'))} />
        </>
      ) : (
        <ApiKeyPanel title="Anthropic" envVar="ANTHROPIC_API_KEY" status={keyStatus} onChanged={onChanged}>
          모델 선택에서 <b>Claude API</b> 열로 사용합니다. 토큰 단위로 Anthropic Console에 과금됩니다.
        </ApiKeyPanel>
      )}
    </>
  );
}

function ClaudePathSetting({ onSaved }: { onSaved: () => void }): JSX.Element {
  const [value, setValue] = useState('');
  const [saved, setSaved] = useState('');
  useEffect(() => {
    void window.dexter.settings.getAll().then((s) => {
      const v = typeof s.claudeCodePath === 'string' ? s.claudeCodePath : '';
      setValue(v);
      setSaved(v);
    });
  }, []);
  async function save(): Promise<void> {
    await window.dexter.settings.set('claudeCodePath', value.trim());
    setSaved(value.trim());
    onSaved();
  }
  return (
    <div className="agent-setting">
      <h3 className="agent-sub">Claude Code 실행 경로</h3>
      <p className="agent-note">비워두면 자동으로 찾습니다(권장). 다른 위치에 설치했다면 경로를 지정하세요.</p>
      <div className="agent-path-row">
        <input
          spellCheck={false}
          placeholder="자동 (예: ~/.local/bin/claude)"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void save();
          }}
        />
        <button className="btn sm" disabled={value.trim() === saved} onClick={() => void save()}>
          저장
        </button>
      </div>
    </div>
  );
}

function CodexPanel({
  codex,
  keyStatus,
  onChanged,
}: {
  codex: CodexAuth;
  keyStatus?: SecretStatus;
  onChanged: Props['onChanged'];
}): JSX.Element {
  const s = codex.status;
  const [mode, setMode] = useInitialMode(s ? s.loggedIn : undefined, !!keyStatus?.exists);
  const [refreshing, refresh] = useRefreshing(codex.refresh);

  async function login(m: 'browser' | 'device'): Promise<void> {
    if (await codex.login(m)) await onChanged('ChatGPT 로그인 완료');
  }

  return (
    <>
      <AuthCards mode={mode} onMode={setMode} loginLabel="ChatGPT 로그인" loginIcon={<OpenAIIcon size={20} />} loginOn={!!s?.loggedIn} keyOn={!!keyStatus?.exists} />
      {mode === 'login' ? (
        <>
          <StatusRow
            state={s?.loggedIn ? 'on' : 'off'}
            label={!s ? '확인 중…' : s.loggedIn ? '연결됨' : '로그인 필요'}
            onRefresh={refresh}
            refreshing={refreshing}
          />
          <InfoTable
            rows={[
              [
                '로그인 방식',
                s?.loggedIn
                  ? `${s.source === 'codex-cli' ? 'Codex CLI 로그인 공유 · ' : ''}ChatGPT${s.plan ? ` ${s.plan.charAt(0).toUpperCase()}${s.plan.slice(1)}` : ''} 계정`
                  : undefined,
              ],
              ['이메일', s?.email],
            ]}
          />
          {codex.device && (
            <p className="agent-note">
              <a href={codex.device.url} target="_blank" rel="noreferrer">
                {codex.device.url}
              </a>{' '}
              에서 코드 <code>{codex.device.userCode}</code> 입력
            </p>
          )}
          <div className="agent-actions">
            {codex.busy ? (
              <>
                {!codex.device && <span className="agent-note">브라우저에서 ChatGPT 로그인을 완료하세요…</span>}
                <button className="btn" onClick={codex.cancel}>
                  취소
                </button>
              </>
            ) : s?.loggedIn ? (
              <button
                className="btn ghost danger"
                onClick={() =>
                  void codex
                    .logout()
                    .then(() => onChanged(s.source === 'codex-cli' ? 'Codex CLI 연결 해제됨' : 'ChatGPT 로그아웃됨'))
                }
              >
                {s.source === 'codex-cli' ? '연결 해제' : '로그아웃'}
              </button>
            ) : (
              <>
                {s?.cliAvailable && (
                  <button
                    className="btn primary"
                    onClick={() => void codex.linkCli().then((ok) => ok && onChanged('Codex CLI 로그인 연결됨'))}
                  >
                    ▶ Codex CLI 로그인 사용{s.cliEmail ? ` (${s.cliEmail})` : ''}
                  </button>
                )}
                <button className="btn" onClick={() => void login('browser')}>
                  ▶ ChatGPT로 로그인
                </button>
                <button className="btn ghost" onClick={() => void login('device')} title="브라우저가 이 컴퓨터로 돌아오지 못할 때">
                  코드로 로그인
                </button>
              </>
            )}
          </div>
          {codex.error && <p className="key-error">{codex.error}</p>}
          {s?.source === 'codex-cli' ? (
            <p className="agent-note">
              Codex CLI와 로그인을 공유합니다(<code>~/.codex/auth.json</code>). 연결 해제해도 Codex CLI는 로그인 상태로 남습니다.
            </p>
          ) : (
            !s?.loggedIn &&
            !s?.cliAvailable && (
              <p className="agent-note">
                이미 <code>codex login</code>을 했다면 새로고침하면 그 로그인을 그대로 쓸 수 있습니다.
              </p>
            )
          )}
        </>
      ) : (
        <ApiKeyPanel title="OpenAI" envVar="OPENAI_API_KEY" status={keyStatus} onChanged={onChanged}>
          모델 선택에서 <b>OpenAI API</b> 열로 사용합니다. 토큰 단위로 OpenAI Platform에 과금됩니다.
        </ApiKeyPanel>
      )}
    </>
  );
}

function ApiKeyPanel({
  title,
  envVar,
  status,
  onChanged,
  children,
}: {
  title: string;
  envVar: string;
  status?: SecretStatus;
  onChanged: Props['onChanged'];
  children: React.ReactNode;
}): JSX.Element {
  return (
    <>
      <div className="provider-list agent-key">
        <KeyCard title={title} envVar={envVar} status={status} onChanged={onChanged} />
      </div>
      <p className="agent-note">{children}</p>
    </>
  );
}
