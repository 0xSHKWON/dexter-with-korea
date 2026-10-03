/**
 * The user's installed Claude Code CLI as an LLM backend.
 *
 * Dexter never handles Claude credentials: it runs the official `claude` binary
 * headless (`-p`), which uses whatever login the user already has (`claude auth
 * login` — a Pro/Max subscription or an API key). Dexter only passes its own
 * system prompt, disables Claude Code's built-in tools, and (in the agent path)
 * plugs its finance tools in over MCP.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, statSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';

export const CLAUDE_CODE_PREFIX = 'claude-code:';

export function stripClaudeCodePrefix(model: string): string {
  return model.startsWith(CLAUDE_CODE_PREFIX) ? model.slice(CLAUDE_CODE_PREFIX.length) : model;
}

// npm's Windows install leaves only shims (claude.cmd/.ps1) on PATH; the real
// binary sits in the package. Shims can't be spawned without a shell, and a
// shell would mangle the multi-KB --system-prompt argv.
const NPM_PACKAGE_EXE = join('node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe');

function isFile(p: string): boolean {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

/**
 * A user-supplied `claude` path → a spawnable binary. Users paste the npm
 * package folder or a shim as often as the binary itself.
 */
export function resolveClaudePath(p: string, platform: NodeJS.Platform = process.platform): string | null {
  if (isFile(p)) {
    if (platform !== 'win32' || /\.exe$/i.test(p)) return p;
    const target = join(dirname(p), NPM_PACKAGE_EXE);
    return isFile(target) ? target : null;
  }
  return [join(p, 'bin', 'claude.exe'), join(p, 'claude.exe'), join(p, 'bin', 'claude'), join(p, 'claude')].find(isFile) ?? null;
}

/**
 * Locate `claude`. GUI-launched apps (the desktop sidecar) don't inherit the
 * login shell's PATH, so the installer's default locations are probed too.
 */
export function findClaudeBinary(platform: NodeJS.Platform = process.platform): string | null {
  const override = process.env.CLAUDE_CODE_PATH;
  const resolved = override ? resolveClaudePath(override, platform) : null;
  if (resolved) return resolved;
  const win = platform === 'win32';
  const exe = win ? 'claude.exe' : 'claude';
  const home = homedir();
  const pathDirs = (process.env.PATH ?? '').split(delimiter).filter(Boolean);
  const candidates = [
    ...pathDirs.map((dir) => join(dir, exe)),
    join(home, '.local', 'bin', exe),
    join(home, '.claude', 'local', exe),
    ...(win
      ? [...pathDirs, ...(process.env.APPDATA ? [join(process.env.APPDATA, 'npm')] : [])].map((dir) => join(dir, NPM_PACKAGE_EXE))
      : ['/opt/homebrew/bin/claude', '/usr/local/bin/claude']),
  ];
  return candidates.find(isFile) ?? null;
}

export interface ClaudeCodeStatus {
  installed: boolean;
  loggedIn: boolean;
  email?: string;
  /** e.g. "claude.ai" (subscription) or "api_key". */
  authMethod?: string;
}

let statusCache: { at: number; value: ClaudeCodeStatus } | null = null;
const STATUS_TTL_MS = 30_000;

/** `claude auth status` (cached briefly — it's a subprocess and gets polled by UIs). */
export function getClaudeCodeStatus(fresh = false): ClaudeCodeStatus {
  if (!fresh && statusCache && Date.now() - statusCache.at < STATUS_TTL_MS) return statusCache.value;
  const bin = findClaudeBinary();
  let value: ClaudeCodeStatus = { installed: false, loggedIn: false };
  if (bin) {
    const r = spawnSync(bin, ['auth', 'status', '--json'], { encoding: 'utf-8', timeout: 15_000 });
    value = { installed: true, loggedIn: false };
    try {
      const parsed = JSON.parse(r.stdout) as { loggedIn?: boolean; email?: string; authMethod?: string };
      value = { installed: true, loggedIn: parsed.loggedIn === true, email: parsed.email, authMethod: parsed.authMethod };
    } catch {
      // older CLI without JSON status — treat as installed but unknown
    }
  }
  statusCache = { at: Date.now(), value };
  return value;
}

export function invalidateClaudeCodeStatus(): void {
  statusCache = null;
}

/** An empty scratch cwd, so no project CLAUDE.md / .claude settings leak into Dexter's prompt. */
let scratchDir: string | null = null;
export function claudeScratchDir(): string {
  if (!scratchDir || !existsSync(scratchDir)) scratchDir = mkdtempSync(join(tmpdir(), 'dexter-claude-'));
  return scratchDir;
}

/** Flags shared by every Dexter → Claude Code invocation. */
export function baseClaudeArgs(model: string, systemPrompt: string): string[] {
  return [
    '-p',
    '--model',
    stripClaudeCodePrefix(model),
    '--system-prompt',
    systemPrompt,
    // Dexter brings its own tools; Claude Code's file/shell tools stay off.
    '--tools',
    '',
    '--no-session-persistence',
    // Only the (empty) project scope: the user's own hooks/plugins must not run
    // inside Dexter. (--bare would also do this but disables OAuth logins.)
    '--setting-sources',
    'project',
  ];
}

/**
 * Child env. Dexter's own ANTHROPIC_API_KEY (from .env, meant for the Anthropic
 * provider) would make Claude Code bill that key instead of the user's login.
 */
export function claudeEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, ...extra };
  delete env.ANTHROPIC_API_KEY;
  delete env.ANTHROPIC_AUTH_TOKEN;
  return env;
}

export function requireClaudeBinary(): string {
  const bin = findClaudeBinary();
  if (!bin) {
    throw new Error(
      'Claude Code is not installed. Install it (https://claude.com/claude-code) and run `claude auth login`.',
    );
  }
  return bin;
}

export interface ClaudeResultMessage {
  type: 'result';
  subtype: string;
  is_error: boolean;
  result?: string;
  structured_output?: unknown;
  num_turns?: number;
  usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number };
}

export interface RunOnceOptions {
  model: string;
  systemPrompt: string;
  prompt: string;
  /** Constrain the reply to this JSON schema (`--json-schema`); read `structured_output`. */
  jsonSchema?: object;
  signal?: AbortSignal;
}

/** One non-agentic completion: prompt in, final result message out. */
export function runClaudeOnce(opts: RunOnceOptions): Promise<ClaudeResultMessage> {
  const bin = requireClaudeBinary();
  const args = [...baseClaudeArgs(opts.model, opts.systemPrompt), '--output-format', 'json'];
  if (opts.jsonSchema) args.push('--json-schema', JSON.stringify(opts.jsonSchema));

  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { cwd: claudeScratchDir(), env: claudeEnv(), stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', (d: Buffer) => (out += d.toString()));
    child.stderr.on('data', (d: Buffer) => (err += d.toString()));
    const onAbort = () => child.kill();
    opts.signal?.addEventListener('abort', onAbort, { once: true });
    child.on('error', reject);
    child.on('close', (code) => {
      opts.signal?.removeEventListener('abort', onAbort);
      if (opts.signal?.aborted) return reject(new Error('Aborted'));
      try {
        const msg = JSON.parse(out) as ClaudeResultMessage;
        if (msg.is_error) return reject(new Error(`[Claude Code] ${msg.result ?? msg.subtype}`));
        resolve(msg);
      } catch {
        reject(new Error(`[Claude Code] exited ${code}: ${(err || out).trim().slice(0, 500)}`));
      }
    });
    child.stdin.end(opts.prompt);
  });
}

/**
 * Claude Code's own login (`claude auth login`): it opens the browser and stores
 * the credentials in Claude Code's keychain/config — Dexter never sees them.
 */
export function loginClaudeCode(opts: { onOutput?: (line: string) => void; signal?: AbortSignal } = {}): Promise<ClaudeCodeStatus> {
  const bin = requireClaudeBinary();
  return new Promise((resolve, reject) => {
    const child = spawn(bin, ['auth', 'login', '--claudeai'], { env: claudeEnv(), stdio: ['ignore', 'pipe', 'pipe'] });
    const forward = (d: Buffer) => {
      for (const line of d.toString().split('\n')) if (line.trim()) opts.onOutput?.(line.trim());
    };
    child.stdout.on('data', forward);
    child.stderr.on('data', forward);
    const onAbort = () => child.kill();
    opts.signal?.addEventListener('abort', onAbort, { once: true });
    child.on('error', reject);
    child.on('close', (code) => {
      opts.signal?.removeEventListener('abort', onAbort);
      const status = getClaudeCodeStatus(true);
      if (status.loggedIn) resolve(status);
      else reject(new Error(opts.signal?.aborted ? 'Login cancelled' : `claude auth login exited (${code})`));
    });
  });
}
