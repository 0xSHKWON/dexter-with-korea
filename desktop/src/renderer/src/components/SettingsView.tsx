import { useEffect, useMemo, useState } from 'react';
import type {
  AppSettings,
  DataSource,
  DataSourceGroup,
  ProviderMeta,
  SecretStatus,
} from '../../../shared/types';
import KeyCard from './KeyCard';
import KrxKeyCard from './KrxKeyCard';

export default function SettingsView({ onKeysChanged }: { onKeysChanged?: () => void }): JSX.Element {
  const [providers, setProviders] = useState<ProviderMeta[]>([]);
  const [dataSources, setDataSources] = useState<DataSource[]>([]);
  const [settings, setSettings] = useState<AppSettings>({});
  const [statuses, setStatuses] = useState<Record<string, SecretStatus>>({});
  const [encAvailable, setEncAvailable] = useState(true);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<string | null>(null);

  // default-model form
  const [provider, setProvider] = useState('openai');
  const [modelId, setModelId] = useState('');
  const [savingModel, setSavingModel] = useState(false);

  function flash(msg: string): void {
    setToast(msg);
    window.setTimeout(() => setToast(null), 2200);
  }

  async function refreshStatuses(): Promise<void> {
    const list = await window.dexter.secrets.statusAll();
    setStatuses(Object.fromEntries(list.map((s) => [s.envVar, s])));
  }

  useEffect(() => {
    (async () => {
      const [provs, sources, setts, encOk] = await Promise.all([
        window.dexter.providers.list(),
        window.dexter.datasources.list(),
        window.dexter.settings.getAll(),
        window.dexter.secrets.encryptionAvailable(),
      ]);
      setProviders(provs);
      setDataSources(sources);
      setSettings(setts);
      setEncAvailable(encOk);
      await refreshStatuses();

      const initialProvider = setts.provider ?? 'openai';
      setProvider(initialProvider);
      const meta = provs.find((p) => p.id === initialProvider);
      setModelId(setts.modelId ?? meta?.defaultModel ?? '');
      setLoading(false);
    })();
  }, []);

  const activeProviderMeta = useMemo(
    () => providers.find((p) => p.id === provider),
    [providers, provider],
  );

  function onProviderChange(id: string): void {
    setProvider(id);
    const meta = providers.find((p) => p.id === id);
    setModelId(meta?.defaultModel ?? '');
  }

  async function saveModel(): Promise<void> {
    setSavingModel(true);
    try {
      await window.dexter.settings.set('provider', provider);
      await window.dexter.settings.set('modelId', modelId.trim());
      setSettings((s) => ({ ...s, provider, modelId: modelId.trim() }));
      flash('기본 모델이 저장되었습니다');
    } finally {
      setSavingModel(false);
    }
  }

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

  const keyedProviders = providers.filter((p) => p.requiresKey && p.apiKeyEnvVar);

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
      </header>

      {!encAvailable && (
        <div className="banner warn">
          이 시스템에서는 보안 저장소를 쓸 수 없어 키를 안전하게 저장할 수 없습니다.
        </div>
      )}

      <section className="card">
        <h2>기본 모델</h2>
        <div className="field-row">
          <label className="field">
            <span className="field-label">공급자</span>
            <select value={provider} onChange={(e) => onProviderChange(e.target.value)}>
              {providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.displayName}
                </option>
              ))}
            </select>
          </label>

          <label className="field grow">
            <span className="field-label">모델 ID</span>
            <input
              list="model-suggestions"
              value={modelId}
              placeholder={activeProviderMeta?.defaultModel ?? 'model-id'}
              onChange={(e) => setModelId(e.target.value)}
            />
            <datalist id="model-suggestions">
              {(activeProviderMeta?.suggestedModels ?? []).map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
          </label>

          <button className="btn primary" onClick={saveModel} disabled={savingModel}>
            {savingModel ? '저장 중…' : '저장'}
          </button>
        </div>
        {activeProviderMeta?.note && <p className="hint">{activeProviderMeta.note}</p>}
        <p className="hint">
          현재 설정: <code>{settings.provider ?? '—'}</code> / <code>{settings.modelId ?? '—'}</code>
        </p>
      </section>

      <section className="card">
        <h2>
          LLM API 키 <span className="sec-tag req">필수</span>
        </h2>
        <p className="sec-intro">모델을 사용하려면 최소 하나가 필요합니다.</p>
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
