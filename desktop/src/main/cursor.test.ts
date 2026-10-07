/**
 * detectCursorBinary hand-mirrors the core's findCursorBinary (the desktop main
 * bundle doesn't import the core). Runs the same lookups against both.
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { detectCursorBinary } from './cursor.js';
import { findCursorBinary } from '../../../src/cursor/cli.js';

const impls = { desktop: detectCursorBinary, core: findCursorBinary };
const KEYS = ['PATH', 'HOME', 'LOCALAPPDATA', 'CURSOR_AGENT_PATH'] as const;
let saved: Record<string, string | undefined>;
let root: string;

function touch(p: string): string {
  mkdirSync(join(p, '..'), { recursive: true });
  writeFileSync(p, '');
  return p;
}

beforeEach(() => {
  saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  root = mkdtempSync(join(tmpdir(), 'dexter-cursor-bin-'));
  process.env.HOME = join(root, 'home');
  delete process.env.LOCALAPPDATA;
  delete process.env.CURSOR_AGENT_PATH;
});
afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  rmSync(root, { recursive: true, force: true });
});

for (const [name, find] of Object.entries(impls)) {
  describe(`${name} cursor binary lookup`, () => {
    it('prefers cursor-agent over a generic `agent` earlier on PATH', () => {
      touch(join(root, 'a', 'agent'));
      const cursor = touch(join(root, 'b', 'cursor-agent'));
      process.env.PATH = [join(root, 'a'), join(root, 'b')].join(delimiter);
      expect(find('darwin')).toBe(cursor);
    });

    it('falls back to ~/.local/bin/agent (new installer name)', () => {
      process.env.PATH = '';
      const agent = touch(join(root, 'home', '.local', 'bin', 'agent'));
      expect(find('darwin')).toBe(agent);
    });

    it('finds the Windows .cmd shim under %LOCALAPPDATA%\\cursor-agent', () => {
      process.env.PATH = '';
      process.env.LOCALAPPDATA = join(root, 'local');
      const shim = touch(join(root, 'local', 'cursor-agent', 'agent.cmd'));
      expect(find('win32')).toBe(shim);
    });

    it('honours CURSOR_AGENT_PATH', () => {
      process.env.CURSOR_AGENT_PATH = touch(join(root, 'custom', 'my-agent'));
      expect(find('darwin')).toBe(process.env.CURSOR_AGENT_PATH);
    });
  });
}
