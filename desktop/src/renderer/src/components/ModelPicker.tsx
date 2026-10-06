import { useEffect, useRef, useState } from 'react';
import { useModelCatalog } from '../useModelCatalog';
import ModelGrid, { ProviderIcon } from './ModelGrid';
import { DEFAULT_EFFORT } from '../../../shared/types';

interface Props {
  disabled?: boolean;
  onChanged?(): void;
  onOpenSettings?(): void;
}

const EFFORT_LABEL: Record<string, string> = {
  off: 'Off',
  light: 'Light',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'XHigh',
  max: 'Max',
  ultra: 'Ultra',
  ultracode: 'UltraCode',
};

/** Composer dropdown: shows the current model, opens the Claude | Codex card grid. */
export default function ModelPicker({ disabled, onChanged, onOpenSettings }: Props): JSX.Element {
  const catalog = useModelCatalog();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    void catalog.reload(); // keys/login may have changed in Settings since mount
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const modelId = catalog.settings.modelId;
  const provider = catalog.providers.find((p) => p.id === catalog.settings.provider);
  const label = provider?.models.find((m) => m.id === modelId)?.label ?? modelId ?? '모델 선택';
  const levels = provider?.effortLevels ?? [];
  const storedEffort = provider ? catalog.settings.effort?.[provider.id] : undefined;
  const effort =
    storedEffort && levels.includes(storedEffort)
      ? storedEffort
      : levels.includes(DEFAULT_EFFORT)
        ? DEFAULT_EFFORT
        : undefined;

  return (
    <div className="mp" ref={rootRef}>
      <button
        className={`mp-trigger${open ? ' open' : ''}`}
        disabled={disabled || catalog.loading}
        onClick={() => setOpen((o) => !o)}
        title={provider ? `${provider.displayName} · ${label}` : '모델 선택'}
      >
        {provider && <ProviderIcon id={provider.id} />}
        <span className="mp-model">{label}</span>
        {effort && <span className="mp-effort">{EFFORT_LABEL[effort] ?? effort}</span>}
        <svg className="mp-caret" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
          <path d="M3 4.5 6 7.5 9 4.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div className="mp-pop">
          <ModelGrid
            providers={catalog.providers}
            connected={catalog.connected}
            selectedModelId={modelId}
            claude={catalog.claude}
            onOpenSettings={
              onOpenSettings &&
              (() => {
                setOpen(false);
                onOpenSettings();
              })
            }
            onSelect={(providerId, id) => {
              void catalog.select(providerId, id).then(() => {
                onChanged?.();
              });
            }}
          />
          {provider && levels.length > 0 && (
            <div className="mp-effort-row">
              <span className="mp-effort-title">Effort</span>
              <div className="mp-seg" role="radiogroup" aria-label="Effort">
                {levels.map((lv) => (
                  <button
                    key={lv}
                    role="radio"
                    aria-checked={effort === lv}
                    className={`mp-seg-btn${effort === lv ? ' on' : ''}`}
                    onClick={() => void catalog.setEffort(provider.id, lv)}
                  >
                    {EFFORT_LABEL[lv] ?? lv}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
