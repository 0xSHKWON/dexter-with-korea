import { join } from 'node:path';

const DEFAULT_DEXTER_DIR = '.dexter';

/**
 * Base directory for Dexter runtime state (settings, scratchpad, memory).
 * Defaults to a CWD-relative `.dexter`; the desktop app overrides this via
 * the DEXTER_DIR env var to point at the per-user data dir.
 */
export function getDexterDir(): string {
  return process.env.DEXTER_DIR || DEFAULT_DEXTER_DIR;
}

export function dexterPath(...segments: string[]): string {
  return join(getDexterDir(), ...segments);
}
