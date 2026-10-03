/**
 * `claude` binary lookup — hand-mirrors findClaudeBinary/resolveClaudePath in
 * src/claude-code/cli.ts (the desktop main bundle doesn't import the core).
 * claude-binary.test.ts runs the same cases against both to catch drift.
 *
 * GUI apps don't inherit the shell PATH, hence the installer locations.
 */
import { statSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';

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

/** Auto-detect (no custom path set). */
export function detectClaudeBinary(platform: NodeJS.Platform = process.platform): string | null {
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
