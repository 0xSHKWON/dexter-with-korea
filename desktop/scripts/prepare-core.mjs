/**
 * Stages the bun runtime + core sources into desktop/resources/ so electron-builder
 * can bundle them (extraResources). Run before `electron-builder` in the `dist` script.
 *
 * At runtime the packaged app spawns `resources/bin/bun run resources/core/src/sidecar/index.ts`
 * (see src/main/sidecar.ts → sidecarTarget()).
 *
 * Note: Playwright's Chromium binary lives in a separate cache (~/.cache/ms-playwright),
 * NOT in node_modules, so it is NOT bundled here — browser/short-balance(KRX) tools
 * won't work in the packaged build until Chromium is bundled too. All other tools
 * (DART, Naver, data.go.kr, web_search, LLMs) work.
 */
import { execSync } from 'node:child_process';
import { cpSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const desktopRoot = join(here, '..');
const coreRoot = join(desktopRoot, '..');
const resBin = join(desktopRoot, 'resources', 'bin');
const resCore = join(desktopRoot, 'resources', 'core');

console.log('Staging bun + core into resources/ …');

// 1) bun runtime (current build platform)
const whichCmd = process.platform === 'win32' ? 'where bun' : 'which bun';
const bunSrc = execSync(whichCmd).toString().trim().split('\n')[0].trim();
if (!bunSrc || !existsSync(bunSrc)) {
  throw new Error('bun not found on PATH — install bun before building');
}
mkdirSync(resBin, { recursive: true });
const bunDest = join(resBin, process.platform === 'win32' ? 'bun.exe' : 'bun');
cpSync(bunSrc, bunDest);
console.log(`  bun: ${bunSrc} -> ${bunDest}`);

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

console.log('Done staging resources/.');
