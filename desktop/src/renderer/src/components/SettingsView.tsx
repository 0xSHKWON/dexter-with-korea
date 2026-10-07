import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type {
  DataSource,
  DataSourceGroup,
  ProviderMeta,
  SecretStatus,
} from '../../../shared/types';
import KeyCard from './KeyCard';
import KrxKeyCard from './KrxKeyCard';
import AgentsSection from './AgentsSection';
import { useCodexAuth } from '../useCodexAuth';
import { useClaudeCode } from '../useClaudeCode';
import { useCursor } from '../useCursor';

const GROUP_LABEL: Record<DataSourceGroup, string> = { kr: '한국 주식 데이터', search: '웹 검색', other: '기타 데이터' };

type TabId = 'agents' | 'llm' | DataSourceGroup | 'export';

/** `navSlot` is the app sidebar's nav container while settings is open — the tab list renders there. */
export default function SettingsView({
  onKeysChanged,
  navSlot,
}: {
  onKeysChanged?: () => void;
  navSlot?: HTMLElement | null;
}): JSX.Element {
  const [providers, setProviders] = useState<ProviderMeta[]>([]);
  const [dataSources, setDataSources] = useState<DataSource[]>([]);
  const [statuses, setStatuses] = useState<Record<string, SecretStatus>>({});
  const [encAvailable, setEncAvailable] = useState(true);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<string | null>(null);
  const [tab, setTab] = useState<TabId>('agents');
  const codex = useCodexAuth();
  const claude = useClaudeCode();
  const cursor = useCursor();

  function flash(msg: string): void {
    setToast(msg);
    window.setTimeout(() => setToast(null), 2200);
  }

  async function refreshStatuses(): Promise<void> {
    const list = await window.dexter.secrets.statusAll();
    setStatuses(Object.fromEntries(list.map((s) => [s.envVar, s])));
  }

  async function exportEnv(): Promise<void> {
    // The main process decrypts and writes to the clipboard itself — key values
    // never come back here (see the secrets:exportEnv handler).
    try {
      const r = await window.dexter.secrets.exportEnv();
      if (!r.copied) {
        flash('내보낼 키가 없습니다.');
        return;
      }
      flash(
        r.undecryptable.length > 0
          ? `${r.exported.length}개를 복사했습니다. ${r.undecryptable.length}개는 읽을 수 없어 제외됐습니다 — 다시 입력해 주세요.`
          : `${r.exported.length}개 키를 .env 형식으로 복사했습니다.`,
      );
    } catch (e) {
      flash(`복사 실패: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  useEffect(() => {
    (async () => {
      const [provs, sources, encOk] = await Promise.all([
        window.dexter.providers.list(),
        window.dexter.datasources.list(),
        window.dexter.secrets.encryptionAvailable(),
      ]);
      setProviders(provs);
      setDataSources(sources);
      setEncAvailable(encOk);
      await refreshStatuses();
      setLoading(false);
    })();
  }, []);

  async function onKeyChanged(msg: string): Promise<void> {
    await refreshStatuses();
    onKeysChanged?.(); // refresh sidebar status panel
    flash(msg);
  }

  if (loading) {
    return (
      <div className="settings">
        <div className="loading">불러오는 중…</div>
      </div>
    );
  }

  // OpenAI / Anthropic keys live in the Agents tabs (Codex / Claude Code → API 키).
  const AGENT_KEYED = new Set(['openai', 'anthropic']);
  const keyedProviders = providers.filter((p) => p.requiresKey && p.apiKeyEnvVar && !AGENT_KEYED.has(p.id));

  function dataSourceSection(
    title: string,
    group: DataSourceGroup,
    tag?: string,
    intro?: string,
  ): JSX.Element {
    const items = dataSources.filter((d) => d.group === group);
    return (
      <section className="card">
        <h2>
          {title}
          {tag && <span className="sec-tag">{tag}</span>}
        </h2>
        {intro && <p className="sec-intro">{intro}</p>}
        <div className="provider-list">
          {items.map((d) => {
            if (d.envVar === 'KRX_PW') return null; // paired into the KRX_ID row
            if (d.envVar === 'KRX_ID') {
              return (
                <KrxKeyCard
                  key="krx"
                  idStatus={statuses['KRX_ID']}
                  pwStatus={statuses['KRX_PW']}
                  note={d.note}
                  onChanged={onKeyChanged}
                />
              );
            }
            return (
              <KeyCard
                key={d.envVar}
                title={d.label}
                envVar={d.envVar}
                note={d.note}
                status={statuses[d.envVar]}
                onChanged={onKeyChanged}
              />
            );
          })}
        </div>
      </section>
    );
  }

  /** "configured / total" for a set of env vars — KRX_ID+KRX_PW count as one row. */
  function keyCount(envVars: string[]): string {
    const rows = envVars.filter((v) => v !== 'KRX_PW');
    const set = rows.filter((v) =>
      v === 'KRX_ID' ? statuses['KRX_ID']?.exists && statuses['KRX_PW']?.exists : statuses[v]?.exists,
    ).length;
    return `${set}/${rows.length}`;
  }

  const groupVars = (g: DataSourceGroup): string[] => dataSources.filter((d) => d.group === g).map((d) => d.envVar);
  const agentOn = !!claude.status?.loggedIn || !!codex.status?.loggedIn || !!cursor.status?.loggedIn || !!statuses['ANTHROPIC_API_KEY']?.exists || !!statuses['OPENAI_API_KEY']?.exists;

  const tabs: { id: TabId; label: string; badge?: string; dot?: boolean }[] = [
    { id: 'agents', label: '에이전트', dot: agentOn },
    { id: 'llm', label: '기타 LLM', badge: keyCount(keyedProviders.map((p) => p.apiKeyEnvVar as string)) },
    ...(['kr', 'search', 'other'] as const)
      .filter((g) => groupVars(g).length > 0)
      .map((g) => ({ id: g, label: GROUP_LABEL[g], badge: keyCount(groupVars(g)) })),
    { id: 'export', label: '키 내보내기' },
  ];

  return (
    <div className="settings">
      <header className="page-head">
        <h1>환경설정</h1>
        <p className="sub">
          키는 이 컴퓨터에 암호화되어 저장됩니다. 발급 방법은 <b>도움말</b>을 참고하세요.
        </p>
      </header>

      {!encAvailable && (
        <div className="banner warn">
          이 시스템에서는 보안 저장소를 쓸 수 없어 키를 안전하게 저장할 수 없습니다.
        </div>
      )}

      {navSlot &&
        createPortal(
          tabs.map((t) => (
            <div key={t.id} className={`nav-row ${tab === t.id ? 'active' : ''}`}>
              <button className="nav-item" role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}>
                <span>{t.label}</span>
                {t.badge && <span className={`settings-nav-badge ${t.badge.startsWith('0/') ? '' : 'on'}`}>{t.badge}</span>}
                {t.dot !== undefined && <span className={`settings-nav-dot ${t.dot ? 'on' : ''}`} />}
              </button>
            </div>
          )),
          navSlot,
        )}

      <div role="tabpanel">
        {tab === 'agents' && (
          <AgentsSection claude={claude} codex={codex} cursor={cursor} statuses={statuses} onChanged={onKeyChanged} />
        )}

        {tab === 'llm' && (
          <section className="card">
            <h2>
              기타 LLM API 키 <span className="sec-tag">선택</span>
            </h2>
            <div className="provider-list">
              {keyedProviders.map((p) => (
                <KeyCard
                  key={p.id}
                  title={p.displayName}
                  envVar={p.apiKeyEnvVar as string}
                  note={p.note}
                  status={statuses[p.apiKeyEnvVar as string]}
                  onChanged={onKeyChanged}
                />
              ))}
            </div>
          </section>
        )}

        {tab === 'kr' &&
          dataSourceSection('한국 주식 데이터', 'kr', '권장', 'DART만 있어도 재무·공시 분석이 가능합니다. 현재가·외국인 지분율은 키 없이 작동합니다.')}
        {tab === 'search' && dataSourceSection('웹 검색', 'search', '선택', '하나만 있어도 충분합니다.')}
        {tab === 'other' && dataSourceSection('기타', 'other', '선택')}

        {tab === 'export' && (
          <section className="card">
            <h2>키 내보내기</h2>
            <div className="page-head-actions">
              <button className="btn" onClick={() => void exportEnv()}>
                .env로 키 복사
              </button>
              <span className="field-hint">터미널(CLI)에서 쓰려면 복사해 .env에 붙여넣으세요.</span>
            </div>
          </section>
        )}
      </div>

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
