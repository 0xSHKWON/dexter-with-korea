/**
 * Stages the bun runtime + core sources into desktop/resources/ so electron-builder
 * can bundle them (extraResources). Run before `electron-builder` in the `dist` script.
 *
 * At runtime the packaged app spawns `resources/bin/bun run resources/core/src/sidecar/index.ts`
 * (see src/main/sidecar.ts → sidecarTarget()).
 *
 * Note: Playwright's Chromium binary lives in a separate cache (~/.cache/ms-playwright),
 * NOT in node_modules, so it is NOT bundled here — only the generic `browser` tool
 * (src/tools/browser) needs Chromium, so it is the one tool that won't work in the
 * packaged build until Chromium is bundled too. Everything else works: DART, Naver,
 * data.go.kr, KRX short-balance (pure HTTP fetch, no browser), web_search, web_fetch
 * (axios), LLMs.
 */
import { execSync } from 'node:child_process';
import {
  cpSync, mkdirSync, rmSync, existsSync, realpathSync, chmodSync, statSync, readdirSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Recursively delete symlinks under a dir. macOS codesign rejects symlinks inside
 * an app bundle ("invalid destination for symbolic link in bundle"), which voids
 * even ad-hoc signing → the downloaded app shows "is damaged and can't be opened".
 * The only symlinks here are node_modules/.bin CLI shims, never used at runtime
 * (the sidecar require()s packages directly). Returns the count removed.
 */
function stripSymlinks(dir) {
  let n = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isSymbolicLink()) {
      rmSync(p, { force: true });
      n++;
    } else if (entry.isDirectory()) {
      n += stripSymlinks(p);
    }
  }
  return n;
}

const here = dirname(fileURLToPath(import.meta.url));
const desktopRoot = join(here, '..');
const coreRoot = join(desktopRoot, '..');
const resBin = join(desktopRoot, 'resources', 'bin');
const resCore = join(desktopRoot, 'resources', 'core');

console.log('Staging bun + core into resources/ …');

// 1) bun runtime (current build platform)
const whichCmd = process.platform === 'win32' ? 'where bun' : 'which bun';
const bunOnPath = execSync(whichCmd).toString().trim().split('\n')[0].trim();
if (!bunOnPath || !existsSync(bunOnPath)) {
  throw new Error('bun not found on PATH — install bun before building');
}
// `which bun` is often a symlink (e.g. Homebrew → ../Cellar/...). Resolve it to the
// REAL binary and dereference on copy — otherwise resources/bin/bun ships as a dangling
// symlink to the build machine's path and the packaged app can't spawn the sidecar.
const bunSrc = realpathSync(bunOnPath);
mkdirSync(resBin, { recursive: true });
const bunDest = join(resBin, process.platform === 'win32' ? 'bun.exe' : 'bun');
// Remove any prior copy first: a stale dest symlink would resolve to the same real
// path as bunSrc and cpSync({dereference}) errors with "src and dest cannot be the same".
rmSync(bunDest, { force: true });
cpSync(bunSrc, bunDest, { dereference: true });
chmodSync(bunDest, 0o755);
const bunMB = (statSync(bunDest).size / 1e6).toFixed(0);
console.log(`  bun: ${bunSrc} -> ${bunDest} (${bunMB} MB real binary)`);

// 2) core sources + deps
rmSync(resCore, { recursive: true, force: true });
mkdirSync(resCore, { recursive: true });
const ITEMS = ['src', 'node_modules', 'package.json', 'tsconfig.json', 'SOUL.md', 'AGENTS.md'];
for (const item of ITEMS) {
  const from = join(coreRoot, item);
  if (!existsSync(from)) continue;
  cpSync(from, join(resCore, item), { recursive: true });
  console.log(`  core: ${item}`);
}

// Remove symlinks so macOS code signing (incl. ad-hoc) stays valid.
const removed = stripSymlinks(resCore);
console.log(`  stripped ${removed} symlink(s) from core (codesign-safe)`);

console.log('Done staging resources/.');
