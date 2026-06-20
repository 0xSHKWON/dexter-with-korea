import { useState } from 'react';
import type { SecretStatus } from '../../../shared/types';

interface Props {
  idStatus?: SecretStatus;
  pwStatus?: SecretStatus;
  note?: string;
  onChanged: (message: string) => void | Promise<void>;
}

/** KRX login is an ID+password pair — one row that sets/clears both together. */
export default function KrxKeyCard({ idStatus, pwStatus, note, onChanged }: Props): JSX.Element {
  const [id, setId] = useState('');
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const exists = (idStatus?.exists ?? false) && (pwStatus?.exists ?? false);
  const showInput = !exists || editing;

  async function save(): Promise<void> {
    setError(null);
    if (!id.trim() || !pw.trim()) {
      setError('아이디와 비밀번호를 모두 입력하세요');
      return;
    }
    setBusy(true);
    try {
      await window.dexter.secrets.set('KRX_ID', id);
      await window.dexter.secrets.set('KRX_PW', pw);
      setId('');
      setPw('');
      setEditing(false);
      await onChanged('KRX 계정 저장됨');
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
      await window.dexter.secrets.remove('KRX_ID');
      await window.dexter.secrets.remove('KRX_PW');
      await onChanged('KRX 계정 삭제됨');
    } finally {
      setBusy(false);
    }
  }

  function cancelEdit(): void {
    setEditing(false);
    setId('');
    setPw('');
    setError(null);
  }

  return (
    <div className="key-row">
      <div className="key-row-top">
        <div className="key-meta">
          <span className={`key-dot ${exists ? 'on' : 'off'}`} />
          <span className="key-name">KRX 계정</span>
        </div>

        <div className="key-action">
          {showInput ? (
            <>
              <input
                type="text"
                className="krx-input"
                placeholder="아이디"
                autoComplete="off"
                spellCheck={false}
                value={id}
                onChange={(e) => setId(e.target.value)}
              />
              <input
                type="password"
                className="krx-input"
                placeholder="비밀번호"
                autoComplete="off"
                spellCheck={false}
                value={pw}
                onChange={(e) => setPw(e.target.value)}
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
              <span className="key-set">설정됨</span>
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
