import ThreeLogo from './ThreeLogo';
import type { UpdateInfo } from '../../../shared/types';

interface Props {
  info: UpdateInfo;
}

/**
 * Full-screen lock shown when the installed build is below the required minimum.
 * Service is unavailable until the user updates — only the update action is offered.
 */
export default function UpdateGate({ info }: Props): JSX.Element {
  return (
    <div className="update-gate">
      <ThreeLogo size={88} />
      <h1>업데이트가 필요합니다</h1>
      <p className="muted">
        새 버전이 나왔어요. 계속 사용하려면 최신 버전으로 업데이트해 주세요.
      </p>
      {info.notes && <div className="update-notes">{info.notes}</div>}
      <button className="btn primary update-cta" onClick={() => void window.dexter.update.open(info.url)}>
        업데이트 다운로드
      </button>
      <p className="update-ver">
        현재 v{info.current}
        {info.latest ? ` · 최신 v${info.latest}` : ''}
      </p>
    </div>
  );
}
