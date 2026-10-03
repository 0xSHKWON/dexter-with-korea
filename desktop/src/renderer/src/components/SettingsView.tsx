import { useEffect, useState } from 'react';
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

export default function SettingsView({ onKeysChanged }: { onKeysChanged?: () => void }): JSX.Element {
  const [providers, setProviders] = useState<ProviderMeta[]>([]);
  const [dataSources, setDataSources] = useState<DataSource[]>([]);
  const [statuses, setStatuses] = useState<Record<string, SecretStatus>>({});
  const [encAvailable, setEncAvailable] = useState(true);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<string | null>(null);
  const codex = useCodexAuth();
  const claude = useClaudeCode();

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
  ): JSX.Element | null {
    const items = dataSources.filter((d) => d.group === group);
    if (items.length === 0) return null;
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

  return (
    <div className="settings">
      <header className="page-head">
        <h1>환경설정</h1>
        <p className="sub">
          키는 이 컴퓨터에 암호화되어 저장됩니다. 발급 방법은 <b>도움말</b>을 참고하세요.
        </p>
        <div className="page-head-actions">
          <button className="btn" onClick={() => void exportEnv()}>
            .env로 키 복사
          </button>
          <span className="field-hint">터미널(CLI)에서 쓰려면 복사해 .env에 붙여넣으세요.</span>
        </div>
      </header>

      {!encAvailable && (
        <div className="banner warn">
          이 시스템에서는 보안 저장소를 쓸 수 없어 키를 안전하게 저장할 수 없습니다.
        </div>
      )}

      <AgentsSection claude={claude} codex={codex} statuses={statuses} onChanged={onKeyChanged} />

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

      {dataSourceSection('한국 주식 데이터', 'kr', '권장', 'DART만 있어도 재무·공시 분석이 가능합니다. 현재가·외국인 지분율은 키 없이 작동합니다.')}
      {dataSourceSection('웹 검색', 'search', '선택', '하나만 있어도 충분합니다.')}
      {dataSourceSection('기타', 'other', '선택')}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
