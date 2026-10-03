/**
 * Claude Code connection for the desktop shell: is the `claude` CLI installed
 * and logged in, and a way to run its own login (`claude auth login`).
 *
 * Dexter never touches Claude credentials — the core runs the user's Claude Code
 * headless (src/claude-code/cli.ts). The binary lookup mirrors findClaudeBinary
 * there; GUI apps don't inherit the shell PATH, hence the installer locations.
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';
import { getSetting } from './db';
import type { AuthLoginResult, ClaudeCodeStatus } from '../shared/types';

/** Settings key for a user-chosen `claude` binary; also passed to the sidecar as CLAUDE_CODE_PATH. */
export const CLAUDE_CODE_PATH_SETTING = 'claudeCodePath';

export function customClaudePath(): string | undefined {
  const p = getSetting<string>(CLAUDE_CODE_PATH_SETTING, '').trim();
  return p || undefined;
}

function findClaudeBinary(): string | null {
  const custom = customClaudePath();
  if (custom) return existsSync(custom) ? custom : null;
  const exe = process.platform === 'win32' ? 'claude.exe' : 'claude';
  const home = homedir();
  const candidates = [
    ...(process.env.PATH ?? '').split(delimiter).filter(Boolean).map((dir) => join(dir, exe)),
    join(home, '.local', 'bin', exe),
    join(home, '.claude', 'local', exe),
    '/opt/homebrew/bin/claude',
    '/usr/local/bin/claude',
  ];
  return candidates.find((p) => existsSync(p)) ?? null;
}

export function claudeCodeStatus(): ClaudeCodeStatus {
  const bin = findClaudeBinary();
  if (!bin) return { installed: false, loggedIn: false };
  const version = spawnSync(bin, ['--version'], { encoding: 'utf-8', timeout: 10_000 })
    .stdout?.trim()
    .replace(/\s*\(Claude Code\)$/, '');
  const r = spawnSync(bin, ['auth', 'status', '--json'], { encoding: 'utf-8', timeout: 15_000 });
  try {
    const s = JSON.parse(r.stdout) as Omit<ClaudeCodeStatus, 'installed' | 'path' | 'version'>;
    return {
      installed: true,
      path: bin,
      version: version || undefined,
      loggedIn: s.loggedIn === true,
      email: s.email,
      authMethod: s.authMethod,
      apiProvider: s.apiProvider,
      orgName: s.orgName,
      subscriptionType: s.subscriptionType,
    };
  } catch {
    return { installed: true, path: bin, version: version || undefined, loggedIn: false };
  }
}

let loginProc: ChildProcess | null = null;

/** Runs Claude Code's own browser login and resolves once it exits. */
export function claudeCodeLogin(): Promise<AuthLoginResult> {
  const bin = findClaudeBinary();
  if (!bin) return Promise.resolve({ ok: false, error: 'Claude Code가 설치되어 있지 않습니다.' });
  loginProc?.kill();
  return new Promise((resolve) => {
    const child = spawn(bin, ['auth', 'login', '--claudeai'], { stdio: ['ignore', 'pipe', 'pipe'] });
    loginProc = child;
    let output = '';
    child.stdout?.on('data', (d: Buffer) => (output += d.toString()));
    child.stderr?.on('data', (d: Buffer) => (output += d.toString()));
    child.on('error', (e) => resolve({ ok: false, error: e.message }));
    child.on('close', () => {
      if (loginProc === child) loginProc = null;
      const status = claudeCodeStatus();
      resolve(
        status.loggedIn
          ? { ok: true, email: status.email }
          : { ok: false, error: output.trim().split('\n').pop() || 'Login cancelled' },
      );
    });
  });
}

export function claudeCodeCancelLogin(): void {
  loginProc?.kill();
}
