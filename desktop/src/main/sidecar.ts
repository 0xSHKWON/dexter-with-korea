/**
 * Spawns and talks to the Bun core sidecar (src/sidecar/index.ts).
 *
 * - Keys: decrypts all stored secrets and injects them as env vars at spawn
 *   time (the core's getApiKey reads process.env). Changing a key calls stop()
 *   so the next request respawns with fresh env.
 * - Paths: points the core's .dexter dir at the app's userData via DEXTER_DIR.
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import { join } from 'node:path';
import { app } from 'electron';
import { PROVIDERS } from './providers';
import { DATA_SOURCES } from './data-sources';
import { getSecret } from './db';
import { decryptSecret } from './secrets';
import type { MainToSidecar, SidecarToMain } from '../shared/sidecar';

interface SidecarTarget {
  bun: string;
  entry: string;
  cwd: string;
}

/**
 * Where to find the bun runtime + core sources.
 * - Packaged: bundled under the app's resources (bin/bun + core/).
 * - Dev: system `bun` + repo root (desktop/out/main → ../../..).
 */
function sidecarTarget(): SidecarTarget {
  if (app.isPackaged) {
    const res = process.resourcesPath;
    return {
      bun: join(res, 'bin', process.platform === 'win32' ? 'bun.exe' : 'bun'),
      entry: join(res, 'core', 'src', 'sidecar', 'index.ts'),
      cwd: join(res, 'core'),
    };
  }
  const root = process.env.DEXTER_CORE_ROOT || join(__dirname, '../../..');
  return { bun: 'bun', entry: join(root, 'src', 'sidecar', 'index.ts'), cwd: root };
}

function collectKeyEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  const envVars = [
    ...PROVIDERS.filter((p) => p.apiKeyEnvVar).map((p) => p.apiKeyEnvVar as string),
    ...DATA_SOURCES.map((d) => d.envVar),
  ];
  for (const v of envVars) {
    const buf = getSecret(v);
    if (!buf) continue;
    try {
      env[v] = decryptSecret(buf);
    } catch {
      /* undecryptable — skip */
    }
  }
  return env;
}

class SidecarManager {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private onMessage: ((msg: SidecarToMain) => void) | null = null;
  // run/convert ids awaiting a terminal reply — so a crash/stop fails them
  // instead of leaving the UI spinning forever.
  private active = new Set<string>();

  start(onMessage: (msg: SidecarToMain) => void): void {
    this.onMessage = onMessage;
  }

  /** Emit an error for every in-flight run so the renderer recovers. */
  private failActive(message: string): void {
    for (const id of this.active) this.onMessage?.({ type: 'error', id, message });
    this.active.clear();
  }

  private ensureProc(): ChildProcessWithoutNullStreams {
    if (this.proc) return this.proc;

    const target = sidecarTarget();
    const dexterDir = join(app.getPath('userData'), 'core-data');

    const proc = spawn(target.bun, ['run', target.entry], {
      cwd: target.cwd,
      env: { ...process.env, DEXTER_DIR: dexterDir, ...collectKeyEnv() },
    }) as ChildProcessWithoutNullStreams;

    const rl = createInterface({ input: proc.stdout });
    rl.on('line', (line) => {
      const t = line.trim();
      if (!t) return;
      let msg: SidecarToMain;
      try {
        msg = JSON.parse(t) as SidecarToMain;
      } catch {
        return; // ignore non-JSON
      }
      // terminal replies clear the run from the in-flight set
      if (
        (msg.type === 'done' || msg.type === 'error' || msg.type === 'convert_result') &&
        'id' in msg
      ) {
        this.active.delete(msg.id);
      }
      this.onMessage?.(msg);
    });
    proc.stderr.on('data', (d: Buffer) => process.stderr.write(`[sidecar] ${d.toString()}`));
    proc.on('error', (err) => {
      process.stderr.write(`[sidecar] spawn error: ${err.message}\n`);
      if (this.proc === proc) this.proc = null;
      this.failActive(`백그라운드 엔진을 시작할 수 없습니다: ${err.message}`);
    });
    proc.on('exit', (code) => {
      process.stderr.write(`[sidecar] exited (code ${code})\n`);
      if (this.proc === proc) this.proc = null;
      this.failActive('백그라운드 엔진이 중단되었습니다. 다시 시도해 주세요.');
    });

    this.proc = proc;
    return proc;
  }

  send(req: MainToSidecar): void {
    if (req.type === 'run' || req.type === 'convert') this.active.add(req.id);
    this.ensureProc().stdin.write(JSON.stringify(req) + '\n');
  }

  /** Kill the process so the next send() respawns with fresh keys/env. */
  stop(): void {
    this.proc?.kill();
    this.proc = null;
  }
}

export const sidecar = new SidecarManager();
