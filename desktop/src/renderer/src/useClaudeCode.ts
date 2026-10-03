import { useCallback, useEffect, useState } from 'react';
import type { ClaudeCodeStatus } from '../../shared/types';

export const CLAUDE_CODE_INSTALL_URL = 'https://claude.com/claude-code';

export interface ClaudeCodeAuth {
  status: ClaudeCodeStatus | null;
  busy: boolean;
  error: string | null;
  login(): Promise<boolean>;
  cancel(): void;
  refresh(): Promise<void>;
}

// Composer picker and Settings each hold this hook; a login in one refreshes the other.
const CLAUDE_CODE_CHANGED = 'dexter:claude-code-changed';

/** Local Claude Code CLI connection (installed + logged in via `claude auth login`). */
export function useClaudeCode(): ClaudeCodeAuth {
  const [status, setStatus] = useState<ClaudeCodeStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setStatus(await window.dexter.claudeCode.status());
    } catch {
      setStatus({ installed: false, loggedIn: false });
    }
  }, []);

  useEffect(() => {
    void refresh();
    const onChanged = () => void refresh();
    window.addEventListener(CLAUDE_CODE_CHANGED, onChanged);
    return () => window.removeEventListener(CLAUDE_CODE_CHANGED, onChanged);
  }, [refresh]);

  const login = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await window.dexter.claudeCode.login();
      if (!r.ok && !/cancel/i.test(r.error)) setError(r.error);
      window.dispatchEvent(new Event(CLAUDE_CODE_CHANGED));
      return r.ok;
    } finally {
      setBusy(false);
    }
  }, []);

  const cancel = useCallback(() => {
    void window.dexter.claudeCode.cancel();
  }, []);

  return { status, busy, error, login, cancel, refresh };
}
