import { afterAll, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { join } from 'path';
import { tmpdir } from 'os';

// config.ts binds SETTINGS_FILE at module load, so DEXTER_DIR has to be set
// before it is first imported. Any other test file importing config.js would
// win that race in a shared process — run each case in a fresh subprocess.
const CONFIG_MODULE = fileURLToPath(new URL('./config.ts', import.meta.url));
const tempDir = mkdtempSync(join(tmpdir(), 'dexter-config-test-'));
const settingsFile = join(tempDir, 'settings.json');

afterAll(() => rmSync(tempDir, { recursive: true, force: true }));
beforeEach(() => rmSync(settingsFile, { force: true }));

/** Load config in an isolated process; returns the in-memory and on-disk modelId. */
function loadWith(modelId: string): { inMemory?: string; onDisk?: string } {
  writeFileSync(settingsFile, JSON.stringify({ provider: 'openai', modelId }));

  const result = Bun.spawnSync(
    [
      'bun',
      '-e',
      `const { loadConfig } = await import(${JSON.stringify(CONFIG_MODULE)});
       console.log(JSON.stringify(loadConfig().modelId ?? null));`,
    ],
    { env: { ...process.env, DEXTER_DIR: tempDir }, stdout: 'pipe', stderr: 'pipe' },
  );

  if (result.exitCode !== 0) {
    throw new Error(`config load failed: ${result.stderr.toString()}`);
  }

  return {
    inMemory: JSON.parse(result.stdout.toString().trim()) ?? undefined,
    onDisk: (JSON.parse(readFileSync(settingsFile, 'utf-8')) as { modelId?: string }).modelId,
  };
}

describe('deprecated model migration', () => {
  // Fork policy: the immediately-previous generation stays usable. Upstream maps
  // gpt-5.5 -> gpt-5.6-sol; we must not, because loadConfig persists the rewrite
  // and would silently discard a deliberate user choice.
  it('leaves gpt-5.5 untouched in memory and on disk', () => {
    expect(loadWith('gpt-5.5')).toEqual({ inMemory: 'gpt-5.5', onDisk: 'gpt-5.5' });
  });

  it('still upgrades older tiers and persists the rewrite', () => {
    for (const legacy of ['gpt-5.4', 'gpt-5.2']) {
      expect(loadWith(legacy)).toEqual({ inMemory: 'gpt-5.6-sol', onDisk: 'gpt-5.6-sol' });
    }
  });

  it('leaves a current model untouched', () => {
    expect(loadWith('gpt-5.6-sol')).toEqual({ inMemory: 'gpt-5.6-sol', onDisk: 'gpt-5.6-sol' });
  });
});
