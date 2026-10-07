import { useCallback, useEffect, useState } from 'react';
import type { CursorStatus } from '../../shared/types';

export const CURSOR_INSTALL_URL = 'https://cursor.com/cli';

export interface CursorAuth {
  status: CursorStatus | null;
  busy: boolean;
  error: string | null;
  login(): Promise<boolean>;
  cancel(): void;
  refresh(): Promise<void>;
}

// Composer picker and Settings each hold this hook; a login in one refreshes the other.
const CURSOR_CHANGED = 'dexter:cursor-changed';

/** Local Cursor Agent CLI connection (installed + logged in via `cursor-agent login`). */
export function useCursor(): CursorAuth {
  const [status, setStatus] = useState<CursorStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setStatus(await window.dexter.cursor.status());
    } catch {
      setStatus({ installed: false, loggedIn: false });
    }
  }, []);

  useEffect(() => {
    void refresh();
    const onChanged = () => void refresh();
    window.addEventListener(CURSOR_CHANGED, onChanged);
    return () => window.removeEventListener(CURSOR_CHANGED, onChanged);
  }, [refresh]);

  const login = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await window.dexter.cursor.login();
      if (!r.ok && !/cancel/i.test(r.error)) setError(r.error);
      window.dispatchEvent(new Event(CURSOR_CHANGED));
      return r.ok;
    } finally {
      setBusy(false);
    }
  }, []);

  const cancel = useCallback(() => {
    void window.dexter.cursor.cancel();
  }, []);

  return { status, busy, error, login, cancel, refresh };
}

/** Free plans reject every named model; mirrors cursorModelAllowed in src/cursor/cli.ts. */
export function cursorModelAllowed(modelId: string, plan: string | undefined): boolean {
  return plan?.trim().toLowerCase() !== 'free' || modelId === 'cursor:auto';
}

/** Usable for a run: the CLI is installed and either logged in or given an API key. */
export function cursorConnected(status: CursorStatus | null | undefined, apiKeyStored: boolean): boolean {
  return !!status?.installed && (status.loggedIn || apiKeyStored);
}
