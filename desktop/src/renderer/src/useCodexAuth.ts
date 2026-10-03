import { useCallback, useEffect, useState } from 'react';
import type { OAuthStatus } from '../../shared/types';

export interface DevicePrompt {
  url: string;
  userCode: string;
}

export interface CodexAuth {
  status: OAuthStatus | null;
  busy: boolean;
  /** Set while a device-code login waits for the user to enter the code. */
  device: DevicePrompt | null;
  error: string | null;
  login(mode?: 'browser' | 'device'): Promise<boolean>;
  cancel(): void;
  logout(): Promise<void>;
  refresh(): Promise<void>;
}

// Several views hold this hook at once (composer picker, Settings); a login or
// logout in one must refresh the others.
const AUTH_CHANGED = 'dexter:auth-changed';

/** ChatGPT (Codex) subscription login state + actions, shared by Settings and the model picker. */
export function useCodexAuth(): CodexAuth {
  const [status, setStatus] = useState<OAuthStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [device, setDevice] = useState<DevicePrompt | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setStatus(await window.dexter.auth.status());
    } catch {
      setStatus({ loggedIn: false });
    }
  }, []);

  useEffect(() => {
    void refresh();
    const onChanged = () => void refresh();
    window.addEventListener(AUTH_CHANGED, onChanged);
    const off = window.dexter.chat.onEvent((msg) => {
      if (msg.type === 'auth_prompt' && msg.userCode) setDevice({ url: msg.url, userCode: msg.userCode });
    });
    return () => {
      window.removeEventListener(AUTH_CHANGED, onChanged);
      off();
    };
  }, [refresh]);

  const login = useCallback(
    async (mode: 'browser' | 'device' = 'browser') => {
      setBusy(true);
      setError(null);
      setDevice(null);
      try {
        const r = await window.dexter.auth.login(mode);
        if (!r.ok && !/cancel/i.test(r.error)) setError(r.error);
        window.dispatchEvent(new Event(AUTH_CHANGED));
        return r.ok;
      } finally {
        setBusy(false);
        setDevice(null);
      }
    },
    [],
  );

  const cancel = useCallback(() => {
    void window.dexter.auth.cancel();
  }, []);

  const logout = useCallback(async () => {
    await window.dexter.auth.logout();
    window.dispatchEvent(new Event(AUTH_CHANGED));
  }, []);

  return { status, busy, device, error, login, cancel, logout, refresh };
}
