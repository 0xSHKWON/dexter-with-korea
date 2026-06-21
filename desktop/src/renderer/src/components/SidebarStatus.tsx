export interface SideStatus {
  modelId?: string;
  /** Whether at least one LLM key is set (so the model can actually run). */
  llm: boolean;
  items: { label: string; connected: boolean }[];
}

export default function SidebarStatus({ status }: { status: SideStatus | null }): JSX.Element | null {
  if (!status) return null;
  return (
    <div className="side-status">
      <div className="ss-model-row">
        <span className="ss-label">모델</span>
        <span className={`ss-model ${status.llm ? '' : 'warn'}`}>
          {status.modelId || '미설정'}
        </span>
      </div>
      <div className="ss-keys">
        {status.items.map((it) => (
          <div className="ss-row" key={it.label}>
            <span className={`ss-dot ${it.connected ? 'on' : 'off'}`} />
            <span className="ss-name">{it.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
