import { app } from 'electron';
import type { UpdateInfo, UpdateStatus } from '../shared/types';

// Remote manifest, served raw from the repo's main branch. Bump `minRequired` to
// force-update old clients; bump `latest` (≤ installed) for an optional nudge.
const MANIFEST_URL =
  'https://raw.githubusercontent.com/0xSHKWON/dexter-with-korea/main/update.json';
const RELEASES_URL = 'https://github.com/0xSHKWON/dexter-with-korea/releases/latest';

/** Numeric dot-version compare: 1 if a>b, -1 if a<b, 0 if equal. */
function cmp(a: string, b: string): number {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d > 0 ? 1 : -1;
  }
  return 0;
}

export async function checkForUpdate(): Promise<UpdateInfo> {
  const current = app.getVersion();
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5000);
    // cache-bust so a freshly published manifest is seen immediately
    const res = await fetch(`${MANIFEST_URL}?t=${Date.now()}`, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`manifest ${res.status}`);
    const m = (await res.json()) as Partial<{
      latest: string;
      minRequired: string;
      url: string;
      notes: string;
    }>;
    const latest = m.latest ?? current;
    const minRequired = m.minRequired ?? '0.0.0';
    const url = m.url || RELEASES_URL;
    const notes = m.notes || '';

    let status: UpdateStatus = 'ok';
    if (cmp(current, minRequired) < 0) status = 'required';
    else if (cmp(current, latest) < 0) status = 'optional';

    return { status, current, latest, url, notes };
  } catch {
    // Fail-open: never lock the app out when the manifest is unreachable (offline,
    // GitHub down, etc.). A forced update must not brick a working install.
    return { status: 'ok', current, latest: null, url: RELEASES_URL, notes: '' };
  }
}
