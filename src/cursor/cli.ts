/**
 * The user's installed Cursor Agent CLI (`cursor-agent`, newer builds also `agent`)
 * as an LLM backend.
 *
 * Like Claude Code, Dexter never handles Cursor credentials: the CLI uses its own
 * `cursor-agent login`, or CURSOR_API_KEY from the environment. Unlike Claude Code
 * there is no system-prompt / JSON-schema flag and no way to switch its built-in
 * file/shell tools off, so every call runs read-only (`--mode ask`) in an empty
 * scratch dir whose `.cursor/cli.json` denies them all; `--trust` only trusts that
 * dir, and `--force` is never passed. Targets the 2026 CLI (`--trust`/`--mode`).
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, statSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';

export const CURSOR_PREFIX = 'cursor:';
export const CURSOR_INSTALL_URL = 'https://cursor.com/cli';

/** `cursor:auto` → `auto` — the id `--model` takes. */
export function stripCursorPrefix(model: string): string {
  return model.startsWith(CURSOR_PREFIX) ? model.slice(CURSOR_PREFIX.length) : model;
}

function isFile(p: string): boolean {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

/**
 * Locate the CLI. `cursor-agent` is tried before `agent` everywhere — `agent` is
 * a generic name another tool on PATH could own. GUI-launched apps (the desktop
 * sidecar) don't inherit the login shell's PATH, so install dirs are probed too.
 */
export function findCursorBinary(platform: NodeJS.Platform = process.platform): string | null {
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
  // The Windows installer ships only a .cmd shim.
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

/** Windows .cmd/.bat shims can only be spawned through a shell. Our argv is flags only. */
function needsShell(bin: string): boolean {
  return /\.(cmd|bat)$/i.test(bin);
}

export interface CursorStatus {
  installed: boolean;
  /** Logged in via `cursor-agent login`, or CURSOR_API_KEY is set. */
  loggedIn: boolean;
  email?: string;
  authMethod?: 'login' | 'api_key';
  /** `subscriptionTier` from `cursor-agent about` — "Free", "Pro", … */
  plan?: string;
}

export const CURSOR_AUTO_MODEL = `${CURSOR_PREFIX}auto`;

/** Free plans reject every named model ("Free plans can only use Auto"). */
export function isCursorFreePlan(plan: string | undefined): boolean {
  return plan?.trim().toLowerCase() === 'free';
}

/** Models the account can call; unknown plan → assume all (the CLI will say otherwise). */
export function cursorModelAllowed(modelId: string, plan: string | undefined): boolean {
  return !isCursorFreePlan(plan) || modelId === CURSOR_AUTO_MODEL;
}

/** `cursor-agent about --format json` → `subscriptionTier`. */
export function parseCursorAbout(text: string): string | undefined {
  try {
    const tier = (JSON.parse(text.trim()) as { subscriptionTier?: unknown }).subscriptionTier;
    return typeof tier === 'string' && tier.trim() ? tier.trim() : undefined;
  } catch {
    return undefined;
  }
}

// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;?]*[A-Za-z]/g;

/**
 * `cursor-agent status --format json` → `{ isAuthenticated, userInfo: { email } }`.
 * Builds without `--format` print human text ("✓ Logged in as me@x.com" / "Not logged in").
 */
export function parseCursorStatusOutput(text: string): { loggedIn: boolean; email?: string } {
  try {
    const j = JSON.parse(text.trim()) as { isAuthenticated?: boolean; userInfo?: { email?: string } };
    const email = j.userInfo?.email;
    return j.isAuthenticated === true ? { loggedIn: true, ...(email ? { email } : {}) } : { loggedIn: false };
  } catch {
    // older CLI — fall through to the text form
  }
  const plain = text.replace(ANSI, '');
  if (/not logged in/i.test(plain) || !/logged in/i.test(plain)) return { loggedIn: false };
  const email = plain.match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/)?.[0];
  return { loggedIn: true, ...(email ? { email } : {}) };
}

function hasApiKey(): boolean {
  const v = process.env.CURSOR_API_KEY?.trim();
  return !!v && !v.startsWith('your-');
}

/**
 * Child env. The CLI prefers CURSOR_API_KEY over its own login, so an unedited
 * `your-…` placeholder from env.example would break an otherwise logged-in CLI.
 */
export function cursorEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, ...extra };
  if (!hasApiKey()) delete env.CURSOR_API_KEY;
  return env;
}

let statusCache: { at: number; value: CursorStatus } | null = null;
const STATUS_TTL_MS = 30_000;

/** Installed + usable (cached briefly — it's a subprocess and gets polled by UIs). */
export function getCursorStatus(fresh = false): CursorStatus {
  if (!fresh && statusCache && Date.now() - statusCache.at < STATUS_TTL_MS) return statusCache.value;
  const bin = findCursorBinary();
  let value: CursorStatus = { installed: false, loggedIn: false };
  if (bin) {
    const run = (args: string[]) =>
      spawnSync(bin, args, { encoding: 'utf-8', timeout: 15_000, env: cursorEnv({ NO_COLOR: '1' }), shell: needsShell(bin) });
    let r = run(['status', '--format', 'json']);
    if (r.status !== 0) r = run(['status']);
    const parsed = parseCursorStatusOutput(r.stdout?.trim().startsWith('{') ? r.stdout : `${r.stdout ?? ''}\n${r.stderr ?? ''}`);
    value = parsed.loggedIn
      ? { installed: true, loggedIn: true, email: parsed.email, authMethod: 'login' }
      : hasApiKey()
        ? { installed: true, loggedIn: true, authMethod: 'api_key' }
        : { installed: true, loggedIn: false };
    if (value.loggedIn) {
      const plan = parseCursorAbout(run(['about', '--format', 'json']).stdout ?? '');
      if (plan) value.plan = plan;
    }
  }
  statusCache = { at: Date.now(), value };
  return value;
}

export function invalidateCursorStatus(): void {
  statusCache = null;
}

/** Project permissions for the scratch cwd: every built-in tool denied. */
export const CURSOR_DENY_ALL = { permissions: { allow: [], deny: ['Shell(*)', 'Read(**)', 'Write(**)'] } };

let scratchDir: string | null = null;
/** Empty cwd with a deny-all `.cursor/cli.json`, so no project rules or tool access leak in. */
export function cursorScratchDir(): string {
  if (!scratchDir || !existsSync(join(scratchDir, '.cursor', 'cli.json'))) {
    scratchDir = mkdtempSync(join(tmpdir(), 'dexter-cursor-'));
    mkdirSync(join(scratchDir, '.cursor'), { recursive: true });
    writeFileSync(join(scratchDir, '.cursor', 'cli.json'), JSON.stringify(CURSOR_DENY_ALL));
  }
  return scratchDir;
}

export function requireCursorBinary(): string {
  const bin = findCursorBinary();
  if (!bin) {
    throw new Error(`Cursor Agent CLI is not installed. Install it (${CURSOR_INSTALL_URL}) and run \`cursor-agent login\`.`);
  }
  return bin;
}

export interface CursorResultMessage {
  type: 'result';
  subtype: string;
  is_error: boolean;
  result?: string;
  usage?: { inputTokens?: number; outputTokens?: number; cacheReadTokens?: number; cacheWriteTokens?: number };
}

function parseResult(text: string): CursorResultMessage | null {
  try {
    const msg = JSON.parse(text.trim()) as CursorResultMessage;
    return msg?.type === 'result' ? msg : null;
  } catch {
    return null;
  }
}

/**
 * One completion: prompt in (over stdin — Dexter's prompts outgrow argv limits,
 * and a non-TTY stdin replaces the positional prompt), result message out.
 * Settles as soon as the result line arrives and stops the CLI — some builds
 * print it and then never exit, and a grace timer would orphan it if Dexter quits.
 */
export function runCursorOnce(opts: { model: string; prompt: string; signal?: AbortSignal }): Promise<CursorResultMessage> {
  const bin = requireCursorBinary();
  const args = ['-p', '--output-format', 'json', '--trust', '--mode', 'ask', '--model', stripCursorPrefix(opts.model)];

  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, {
      cwd: cursorScratchDir(),
      env: cursorEnv(),
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: needsShell(bin),
    });
    let out = '';
    let err = '';
    let settled = false;
    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      opts.signal?.removeEventListener('abort', onAbort);
      fn();
    };
    const finish = (msg: CursorResultMessage) => {
      settle(() => (msg.is_error ? reject(new Error(`[Cursor] ${msg.result ?? msg.subtype}`)) : resolve(msg)));
      if (child.exitCode === null) child.kill();
    };
    child.stdout.on('data', (d: Buffer) => {
      out += d.toString();
      const msg = parseResult(out);
      if (msg) finish(msg);
    });
    child.stderr.on('data', (d: Buffer) => (err += d.toString()));
    const onAbort = () => {
      child.kill();
      settle(() => reject(new Error('Aborted')));
    };
    opts.signal?.addEventListener('abort', onAbort, { once: true });
    child.on('error', (e) => settle(() => reject(e)));
    child.on('close', (code) => {
      const msg = parseResult(out);
      if (msg) return finish(msg);
      // Failures (auth, quota, unknown model, workspace trust) are plain text with exit 1.
      const detail = (err || out).trim();
      if (/free plans can only use auto/i.test(detail)) {
        return settle(() =>
          reject(new Error('[Cursor] Free plan can only use the Auto model — pick Cursor → Auto (/model), or upgrade the Cursor plan.')),
        );
      }
      settle(() => reject(new Error(`[Cursor] exited ${code}: ${detail.slice(0, 500)}`)));
    });
    child.stdin.end(opts.prompt);
  });
}

/** Cursor's own browser login (`cursor-agent login`) — the CLI stores the credentials. */
export function loginCursor(opts: { onOutput?: (line: string) => void; signal?: AbortSignal } = {}): Promise<CursorStatus> {
  const bin = requireCursorBinary();
  return new Promise((resolve, reject) => {
    const child = spawn(bin, ['login'], {
      env: cursorEnv({ NO_COLOR: '1' }),
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: needsShell(bin),
    });
    const forward = (d: Buffer) => {
      for (const line of d.toString().replace(ANSI, '').split('\n')) if (line.trim()) opts.onOutput?.(line.trim());
    };
    child.stdout.on('data', forward);
    child.stderr.on('data', forward);
    const onAbort = () => child.kill();
    opts.signal?.addEventListener('abort', onAbort, { once: true });
    child.on('error', reject);
    child.on('close', (code) => {
      opts.signal?.removeEventListener('abort', onAbort);
      const status = getCursorStatus(true);
      if (status.loggedIn) resolve(status);
      else reject(new Error(opts.signal?.aborted ? 'Login cancelled' : `cursor-agent login exited (${code})`));
    });
  });
}
