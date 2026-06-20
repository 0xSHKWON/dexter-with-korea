import { useEffect, useRef, useState } from 'react';
import type { ConversionRecord, SidecarToMain } from '../../../shared/sidecar';

const PLACEHOLDER = `엑셀에서 계정과목과 금액을 복사해 붙여넣으세요. 예:

보통예금        1,200,000
외상매출금      3,400,000
미지급금          500,000
매출액         12,000,000`;

interface Props {
  conversion: ConversionRecord | null;
  onSaved: (rec: ConversionRecord) => void;
}

export default function WorkView({ conversion, onSaved }: Props): JSX.Element {
  const [raw, setRaw] = useState('');
  const [converting, setConverting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activeRef = useRef<string | null>(null);
  const rawRef = useRef('');
  const onSavedRef = useRef(onSaved);
  useEffect(() => {
    onSavedRef.current = onSaved;
  });

  // Reset transient state when the selection changes.
  useEffect(() => {
    setError(null);
    setConverting(false);
    activeRef.current = null;
    if (!conversion) setRaw('');
  }, [conversion?.id]);

  // convert_result / error arrive on the shared sidecar event channel.
  useEffect(() => {
    return window.dexter.chat.onEvent((msg: SidecarToMain) => {
      if (!activeRef.current) return;
      if ('id' in msg && msg.id !== activeRef.current) return;
      if (msg.type === 'convert_result') {
        activeRef.current = null;
        setConverting(false);
        void window.dexter.work
          .save(rawRef.current, msg.result)
          .then((rec) => onSavedRef.current(rec))
          .catch((e) => setError(e instanceof Error ? e.message : String(e)));
      } else if (msg.type === 'error') {
        activeRef.current = null;
        setConverting(false);
        setError(msg.message);
      }
    });
  }, []);

  async function convert(): Promise<void> {
    if (!raw.trim() || converting) return;
    setError(null);
    setConverting(true);
    rawRef.current = raw;
    try {
      const { runId } = await window.dexter.work.convert(raw);
      activeRef.current = runId;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setConverting(false);
    }
  }

  async function downloadExcel(): Promise<void> {
    if (!conversion) return;
    try {
      await window.dexter.work.export(conversion.result);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  // ── preview an existing conversion ──────────────────────────────────────
  if (conversion) {
    const { result } = conversion;
    return (
      <div className="work">
        <header className="page-head">
          <h1>{conversion.title}</h1>
          <p className="sub">
            {new Date(conversion.createdAt).toLocaleString('ko-KR')} · 매핑은 AI 제안이니 제출 전 확인하세요.
          </p>
        </header>

        {result.warnings.length > 0 && (
          <div className="banner warn">
            <b>검토 필요</b>
            <ul>
              {result.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </div>
        )}
        {error && <div className="banner warn">오류: {error}</div>}

        <section className="card">
          <div className="card-head-row">
            <h2>
              매핑 결과 <span className="muted">({result.mappings.length}건 — 검수 후 다운로드)</span>
            </h2>
            <button className="btn" onClick={() => void downloadExcel()}>
              엑셀 다운로드
            </button>
          </div>
          <div className="map-table-wrap">
            <table className="map-table">
              <thead>
                <tr>
                  <th>원본 계정</th>
                  <th>표준 계정과목</th>
                  <th>금액</th>
                  <th>구분</th>
                  <th>비고</th>
                </tr>
              </thead>
              <tbody>
                {result.mappings.map((m, i) => (
                  <tr key={i}>
                    <td>{m.original}</td>
                    <td>{m.standard}</td>
                    <td className="num">{Number.isFinite(m.amount) ? m.amount.toLocaleString() : m.amount}</td>
                    <td>{m.statement}</td>
                    <td className="note">{m.note ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    );
  }

  // ── new conversion (input) ──────────────────────────────────────────────
  return (
    <div className="work">
      <header className="page-head">
        <h1>엑셀 산출</h1>
        <p className="sub">
          시산표·장부를 붙여넣으면 DART 표준 계정과목으로 매핑합니다. 매핑은 AI 제안이니 제출 전 확인하세요.
        </p>
      </header>

      <section className="card">
        <h2>데이터 붙여넣기</h2>
        <textarea
          className="work-input"
          placeholder={PLACEHOLDER}
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          spellCheck={false}
        />
        <div className="work-actions">
          <button className="btn primary" onClick={() => void convert()} disabled={!raw.trim() || converting}>
            {converting ? '변환 중…' : 'DART 표준으로 변환'}
          </button>
        </div>
      </section>

      {error && <div className="banner warn">오류: {error}</div>}
    </div>
  );
}
