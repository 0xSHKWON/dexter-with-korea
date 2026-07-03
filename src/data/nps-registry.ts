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

export interface NpsSnapshot {
  entries: NpsHoldingEntry[];
  /** When this snapshot was downloaded from data.go.kr (ISO). */
  fetchedAt: string;
  /** True when a refresh failed and this is the stale-fallback copy past its TTL. */
  stale: boolean;
}

/**
 * The NPS holdings snapshot WITH freshness metadata, so the "when was this data
 * obtained / is it a stale fallback" facts reach the model instead of dying in a
 * logger.warn. This is the only accessor — an entries-only variant existed
 * briefly and was removed so freshness can't be silently dropped.
 */
export async function getNpsSnapshot(options?: { ttlMs?: number }): Promise<NpsSnapshot> {
  const ttlMs = options?.ttlMs ?? DEFAULT_TTL_MS;
  const cache = await loadRegistry(ttlMs);
  return {
    entries: cache.entries,
    fetchedAt: new Date(cache.fetchedAt).toISOString(),
    stale: Date.now() - cache.fetchedAt >= ttlMs,
  };
}

export function _resetNpsRegistryForTests(): void {
  memoryCache = null;
  inflight = null;
}
