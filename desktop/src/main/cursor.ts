/**
 * Cursor connection for the desktop shell: is the Cursor Agent CLI installed and
 * logged in, and a way to run its own login (`cursor-agent login`).
 *
 * Dexter never touches Cursor credentials — the core runs the CLI headless
 * (src/cursor/cli.ts). A Cursor API key, if stored, reaches the CLI as
 * CURSOR_API_KEY through the sidecar env like any other provider key.
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { statSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';
import type { AuthLoginResult, CursorStatus } from '../shared/types';

function isFile(p: string): boolean {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

/**
 * Hand-mirrors findCursorBinary in src/cursor/cli.ts (the desktop main bundle
 * doesn't import the core); cursor.test.ts runs both to catch drift.
 */
export function detectCursorBinary(platform: NodeJS.Platform = process.platform): string | null {
  const override = process.env.CURSOR_AGENT_PATH;
  if (override && isFile(override)) return override;
  const win = platform === 'win32';
  // HOME first: Bun caches homedir(), and tests point HOME at a sandbox.
  const home = process.env.HOME || homedir();
  const dirs = [
    ...(process.env.PATH ?? '').split(delimiter).filter(Boolean),
    join(home, '.local', 'bin'),
    join(home, '.cursor', 'bin'),
    ...(win
      ? process.env.LOCALAPPDATA
        ? [join(process.env.LOCALAPPDATA, 'cursor-agent')]
        : []
      : ['/opt/homebrew/bin', '/usr/local/bin']),
  ];
  const exts = win ? ['.exe', '.cmd', '.bat', ''] : [''];
  for (const name of ['cursor-agent', 'agent']) {
    for (const dir of dirs) {
      for (const ext of exts) {
        const p = join(dir, name + ext);
        if (isFile(p)) return p;
      }
    }
  }
  return null;
}

const needsShell = (bin: string): boolean => /\.(cmd|bat)$/i.test(bin);
// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;?]*[A-Za-z]/g;

function run(bin: string, args: string[]): { ok: boolean; out: string } {
  const r = spawnSync(bin, args, {
    encoding: 'utf-8',
    timeout: 15_000,
    env: { ...process.env, NO_COLOR: '1' },
    shell: needsShell(bin),
  });
  return { ok: r.status === 0, out: `${r.stdout ?? ''}\n${r.stderr ?? ''}`.replace(ANSI, '') };
}

/** Mirrors parseCursorStatusOutput in src/cursor/cli.ts: JSON status, else the older text form. */
function parseStatus(text: string): { loggedIn: boolean; email?: string } {
  try {
    const j = JSON.parse(text.trim()) as { isAuthenticated?: boolean; userInfo?: { email?: string } };
    return { loggedIn: j.isAuthenticated === true, email: j.isAuthenticated ? j.userInfo?.email : undefined };
  } catch {
    const loggedIn = /logged in/i.test(text) && !/not logged in/i.test(text);
    return { loggedIn, email: loggedIn ? text.match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/)?.[0] : undefined };
  }
}

export function cursorStatus(): CursorStatus {
  const bin = detectCursorBinary();
  if (!bin) return { installed: false, loggedIn: false };
  const version = run(bin, ['--version']).out.trim() || undefined;
  let status = run(bin, ['status', '--format', 'json']);
  if (!status.ok) status = run(bin, ['status']);
  const { loggedIn, email } = parseStatus(status.out);
  return { installed: true, loggedIn, path: bin, version, ...(email ? { email } : {}) };
}

let loginProc: ChildProcess | null = null;

/** Runs `cursor-agent login` (opens the browser) and resolves once it exits. */
export function cursorLogin(): Promise<AuthLoginResult> {
  const bin = detectCursorBinary();
  if (!bin) return Promise.resolve({ ok: false, error: 'Cursor Agent CLI가 설치되어 있지 않습니다.' });
  loginProc?.kill();
  return new Promise((resolve) => {
    const child = spawn(bin, ['login'], {
      env: { ...process.env, NO_COLOR: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: needsShell(bin),
    });
    loginProc = child;
    let output = '';
    child.stdout?.on('data', (d: Buffer) => (output += d.toString()));
    child.stderr?.on('data', (d: Buffer) => (output += d.toString()));
    child.on('error', (e) => resolve({ ok: false, error: e.message }));
    child.on('close', () => {
      if (loginProc === child) loginProc = null;
      const status = cursorStatus();
      resolve(
        status.loggedIn
          ? { ok: true, email: status.email }
          : { ok: false, error: output.replace(ANSI, '').trim().split('\n').pop() || 'Login cancelled' },
      );
    });
  });
}

export function cursorCancelLogin(): void {
  loginProc?.kill();
}
