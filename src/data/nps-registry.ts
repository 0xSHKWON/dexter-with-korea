/**
 * Cache for the NPS domestic-equity holdings snapshot, mirroring
 * ticker-registry.ts. The dataset updates ~yearly, so a 30-day TTL is ample;
 * a failed refresh falls back to the last good snapshot.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { dexterPath } from '../utils/paths.js';
import { logger } from '../utils/logger.js';
import { fetchNpsHoldings, type NpsHoldingEntry } from './fetchers/nps-holdings.js';

const REGISTRY_FILE = dexterPath('cache', 'nps', 'holdings.json');
const DEFAULT_TTL_MS = 30 * 24 * 60 * 60 * 1000;

interface RegistryFile {
  fetchedAt: string;
  entries: NpsHoldingEntry[];
}

interface RegistryCache {
  fetchedAt: number;
  entries: NpsHoldingEntry[];
}

let memoryCache: RegistryCache | null = null;
let inflight: Promise<RegistryCache> | null = null;

function readFromDisk(): RegistryCache | null {
  if (!existsSync(REGISTRY_FILE)) return null;
  try {
    const raw = readFileSync(REGISTRY_FILE, 'utf-8');
    const parsed = JSON.parse(raw) as RegistryFile;
    if (!parsed?.entries || !Array.isArray(parsed.entries)) return null;
    return { fetchedAt: Date.parse(parsed.fetchedAt), entries: parsed.entries };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn(`[nps-registry] failed to read cache — ${message}`);
    return null;
  }
}

function writeToDisk(entries: NpsHoldingEntry[]): string {
  const dir = dirname(REGISTRY_FILE);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const fetchedAt = new Date().toISOString();
  const payload: RegistryFile = { fetchedAt, entries };
  writeFileSync(REGISTRY_FILE, JSON.stringify(payload));
  return fetchedAt;
}

async function loadRegistry(ttlMs: number): Promise<RegistryCache> {
  const now = Date.now();
  if (memoryCache && now - memoryCache.fetchedAt < ttlMs) {
    return memoryCache;
  }

  const onDisk = readFromDisk();
  if (onDisk && now - onDisk.fetchedAt < ttlMs) {
    memoryCache = onDisk;
    return onDisk;
  }

  if (inflight) return inflight;

  inflight = (async () => {
    try {
      const entries = await fetchNpsHoldings();
      const fetchedAt = Date.parse(writeToDisk(entries));
      const cache = { fetchedAt, entries };
      memoryCache = cache;
      return cache;
    } catch (error) {
      if (onDisk) {
        logger.warn(
          `[nps-registry] refresh failed, falling back to stale cache — ${error instanceof Error ? error.message : String(error)}`,
        );
        memoryCache = onDisk;
        return onDisk;
      }
      throw error;
    } finally {
      inflight = null;
    }
  })();

  return inflight;
}

export async function getNpsHoldings(options?: { ttlMs?: number }): Promise<NpsHoldingEntry[]> {
  const cache = await loadRegistry(options?.ttlMs ?? DEFAULT_TTL_MS);
  return cache.entries;
}

export function _resetNpsRegistryForTests(): void {
  memoryCache = null;
  inflight = null;
}
