/**
 * Windows npm installs leave only claude.cmd on PATH (the real binary is
 * node_modules/@anthropic-ai/claude-code/bin/claude.exe), and users paste the
 * package folder into the path setting — both used to fail with spawn ENOENT.
 * Runs against the desktop lookup and the core one, which are hand-mirrored.
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as desktop from './claude-binary.js';
import * as core from '../../../src/claude-code/cli.js';

const impls = {
  desktop: { resolve: desktop.resolveClaudePath, detect: desktop.detectClaudeBinary },
  core: {
    resolve: core.resolveClaudePath,
    detect: (platform: NodeJS.Platform) => {
      const prev = process.env.CLAUDE_CODE_PATH;
      delete process.env.CLAUDE_CODE_PATH;
      try {
        return core.findClaudeBinary(platform);
      } finally {
        if (prev !== undefined) process.env.CLAUDE_CODE_PATH = prev;
      }
    },
  },
};

let root: string;
let npmDir: string;
let pkgDir: string;
let exe: string;
const saved = { PATH: process.env.PATH, APPDATA: process.env.APPDATA, HOME: process.env.HOME };

function touch(p: string): void {
  mkdirSync(join(p, '..'), { recursive: true });
  writeFileSync(p, '');
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'claude-bin-'));
  npmDir = join(root, 'npm');
  pkgDir = join(npmDir, 'node_modules', '@anthropic-ai', 'claude-code');
  exe = join(pkgDir, 'bin', 'claude.exe');
  touch(exe);
  touch(join(npmDir, 'claude.cmd'));
  process.env.HOME = join(root, 'home');
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

for (const [name, impl] of Object.entries(impls)) {
  describe(`${name} claude binary lookup`, () => {
    it('resolves the npm package folder to its bin/claude.exe', () => {
      expect(impl.resolve(pkgDir, 'win32')).toBe(exe);
      expect(impl.resolve(join(pkgDir, 'bin'), 'win32')).toBe(exe);
    });

    it('resolves the npm claude.cmd shim to the real binary on Windows', () => {
      expect(impl.resolve(join(npmDir, 'claude.cmd'), 'win32')).toBe(exe);
    });

    it('returns the binary itself unchanged', () => {
      expect(impl.resolve(exe, 'win32')).toBe(exe);
    });

    it('rejects a folder with no binary instead of reporting it as installed', () => {
      expect(impl.resolve(npmDir, 'win32')).toBeNull();
      expect(impl.resolve(join(root, 'missing'), 'win32')).toBeNull();
    });

    it('auto-detects an npm install via PATH on Windows', () => {
      process.env.PATH = npmDir;
      delete process.env.APPDATA;
      expect(impl.detect('win32')).toBe(exe);
    });

    it('auto-detects an npm install via %APPDATA%\\npm when PATH lacks it', () => {
      process.env.PATH = join(root, 'empty');
      process.env.APPDATA = root;
      expect(impl.detect('win32')).toBe(exe);
    });
  });
}
