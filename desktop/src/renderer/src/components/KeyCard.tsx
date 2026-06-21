import { useState } from 'react';
import type { SecretStatus } from '../../../shared/types';

interface Props {
  title: string;
  envVar: string;
  note?: string;
  status?: SecretStatus;
  onChanged: (message: string) => void | Promise<void>;
}

/** A single API-key row: status dot + name, with inline edit. Used for LLM and data-source keys. */
export default function KeyCard({ title, envVar, note, status, onChanged }: Props): JSX.Element {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const exists = status?.exists ?? false;
  const showInput = !exists || editing;

  async function save(): Promise<void> {
    setError(null);
    if (!value.trim()) {
      setError('값을 입력하세요');
      return;
    }
    setBusy(true);
    try {
      await window.dexter.secrets.set(envVar, value);
      setValue('');
      setEditing(false);
      await onChanged(`${title} 저장됨`);
    } catch (e) {
      setError(e instanceof Error ? e.message : '저장 실패');
    } finally {
      setBusy(false);
    }
  }

  async function remove(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await window.dexter.secrets.remove(envVar);
      await onChanged(`${title} 삭제됨`);
    } finally {
      setBusy(false);
    }
  }

  function cancelEdit(): void {
    setEditing(false);
    setValue('');
    setError(null);
  }

  return (
    <div className="key-row">
      <div className="key-row-top">
        <div className="key-meta">
          <span className={`key-dot ${exists ? 'on' : 'off'}`} />
          <span className="key-name">{title}</span>
        </div>

        <div className="key-action">
          {showInput ? (
            <>
              <input
                type="password"
                autoComplete="off"
                spellCheck={false}
                placeholder={exists ? '새 값' : `${title} 키`}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void save();
                }}
              />
              <button className="btn primary sm" onClick={() => void save()} disabled={busy}>
                저장
              </button>
              {exists && (
                <button className="btn ghost sm" onClick={cancelEdit} disabled={busy}>
                  취소
                </button>
              )}
            </>
          ) : (
            <>
              <span className="key-set">····{status?.last4 ?? ''}</span>
              <button className="btn ghost sm" onClick={() => setEditing(true)}>
                변경
              </button>
              <button className="btn ghost sm danger" onClick={() => void remove()} disabled={busy}>
                삭제
              </button>
            </>
          )}
        </div>
      </div>

      {note && <p className="key-note">{note}</p>}
      {error && <p className="key-error">{error}</p>}
    </div>
  );
}
