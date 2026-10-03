import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFileTool } from './read-file.js';
import { MAX_TOOL_RESULT_CHARS } from '../../utils/tool-result-storage.js';

const TEST_DIR = join(process.cwd(), '.dexter', 'read-file-tests');

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe('read_file oversized lines', () => {
  test('automatically switches to resumable byte ranges', async () => {
    mkdirSync(TEST_DIR, { recursive: true });
    const path = join(TEST_DIR, 'large-result.json');
    const original = JSON.stringify({
      data: {
        filing: 'AWS '.repeat(30_000),
        marker: 'end-of-result',
      },
    });
    writeFileSync(path, original, 'utf-8');

    const firstRawResult = await readFileTool.invoke({ path, offset: 1, limit: 120 });
    let result = JSON.parse(firstRawResult);
    let reconstructed = result.data.content as string;

    expect(firstRawResult.length).toBeLessThanOrEqual(MAX_TOOL_RESULT_CHARS);
    expect(result.data.truncated).toBe(true);
    expect(result.data.byteRange.start).toBe(0);
    expect(result.data.nextByteOffset).toBeGreaterThan(0);
    expect(result.data.continuation).toContain('byteOffset=');

    while (result.data.truncated) {
      result = JSON.parse(await readFileTool.invoke({
        path,
        byteOffset: result.data.nextByteOffset,
      }));
      reconstructed += result.data.content;
    }

    expect(reconstructed).toBe(original);
    expect(reconstructed).toContain('end-of-result');
  });

  test('keeps byte boundaries valid for multibyte UTF-8 text', async () => {
    mkdirSync(TEST_DIR, { recursive: true });
    const path = join(TEST_DIR, 'unicode.json');
    const original = JSON.stringify({ data: '🌕'.repeat(20_000) });
    writeFileSync(path, original, 'utf-8');

    let result = JSON.parse(await readFileTool.invoke({ path }));
    let reconstructed = result.data.content as string;

    while (result.data.truncated) {
      result = JSON.parse(await readFileTool.invoke({
        path,
        byteOffset: result.data.nextByteOffset,
      }));
      reconstructed += result.data.content;
    }

    expect(reconstructed).toBe(original);
    expect(reconstructed).not.toContain('�');
  });

  test('shrinks chunks whose JSON escaping would cross the persistence cap', async () => {
    mkdirSync(TEST_DIR, { recursive: true });
    const path = join(TEST_DIR, 'control-characters.txt');
    writeFileSync(path, '\0'.repeat(60_000), 'utf-8');

    const rawResult = await readFileTool.invoke({ path });
    const result = JSON.parse(rawResult);

    expect(rawResult.length).toBeLessThanOrEqual(MAX_TOOL_RESULT_CHARS);
    expect(result.data.truncated).toBe(true);
    expect(result.data.nextByteOffset).toBeLessThan(32 * 1024);
  });
});

describe('read_file sandbox', () => {
  // Spawned in a fresh process: tool-result-storage binds DEXTER_DIR at load.
  function readWithDexterDir(dexterDir: string, path: string): { ok: boolean; out: string } {
    const r = Bun.spawnSync(
      [
        'bun',
        '-e',
        `const { readFileTool } = await import(${JSON.stringify(join(import.meta.dir, 'read-file.ts'))});
         try { const out = await readFileTool.invoke({ path: ${JSON.stringify(path)} }); console.log(JSON.stringify({ ok: true, out })); }
         catch (e) { console.log(JSON.stringify({ ok: false, out: String(e) })); }`,
      ],
      { env: { ...process.env, DEXTER_DIR: dexterDir }, stdout: 'pipe', stderr: 'pipe' },
    );
    return JSON.parse(r.stdout.toString().trim().split('\n').pop() ?? '{}');
  }

  test('reads persisted tool results even when DEXTER_DIR is outside cwd (desktop sidecar)', () => {
    const outside = mkdtempSync(join(tmpdir(), 'dexter-userdata-'));
    try {
      mkdirSync(join(outside, 'tool-results'), { recursive: true });
      const persisted = join(outside, 'tool-results', 'call_1.txt');
      writeFileSync(persisted, 'full large result', 'utf-8');
      const r = readWithDexterDir(outside, persisted);
      expect(r.ok).toBe(true);
      expect(r.out).toContain('full large result');

      // The exception is only the results dir — the rest of DEXTER_DIR stays off-limits.
      const secret = join(outside, 'auth.json');
      writeFileSync(secret, '{"token":"x"}', 'utf-8');
      const denied = readWithDexterDir(outside, secret);
      expect(denied.ok).toBe(false);
      expect(denied.out).toContain('escapes sandbox root');
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
});
