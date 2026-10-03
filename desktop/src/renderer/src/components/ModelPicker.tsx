import { useEffect, useRef, useState } from 'react';
import { useModelCatalog } from '../useModelCatalog';
import ModelGrid from './ModelGrid';

interface Props {
  disabled?: boolean;
  onChanged?(): void;
  onOpenSettings?(): void;
}

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

  return (
    <div className="mp" ref={rootRef}>
      <button
        className={`mp-trigger${open ? ' open' : ''}`}
        disabled={disabled || catalog.loading}
        onClick={() => setOpen((o) => !o)}
        title="모델 선택"
      >
        {provider && <span className="mp-provider">{provider.shortName ?? provider.displayName}</span>}
        <span className="mp-model">{label}</span>
        <span className="mp-caret">▾</span>
      </button>
      {open && (
        <div className="mp-pop">
          <ModelGrid
            providers={catalog.providers}
            connected={catalog.connected}
            selectedModelId={modelId}
            codex={catalog.codex}
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
                setOpen(false);
                onChanged?.();
              });
            }}
          />
        </div>
      )}
    </div>
  );
}
