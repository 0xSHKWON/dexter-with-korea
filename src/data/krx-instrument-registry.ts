/**
 * Ticker ↔ ISIN registry for KRX-keyed tools, mirroring ticker-registry.ts.
 *
 * Cached to `<dexterPath>/cache/krx/instruments.json` with a 7-day TTL, an
 * in-memory index, in-flight dedup, and stale-fallback when a refresh fails
 * (e.g. KRX login unavailable) so tools degrade gracefully.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { dexterPath } from '../utils/paths.js';
import { logger } from '../utils/logger.js';
import { fetchKrxInstruments, type KrxInstrumentEntry } from './fetchers/krx-instruments.js';

const REGISTRY_FILE = dexterPath('cache', 'krx', 'instruments.json');
const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

interface RegistryFile {
  fetchedAt: string;
  entries: KrxInstrumentEntry[];
}

interface RegistryCache {
  fetchedAt: number;
  byTicker: Map<string, KrxInstrumentEntry>;
  byName: Map<string, KrxInstrumentEntry>;
}

let memoryCache: RegistryCache | null = null;
let inflight: Promise<RegistryCache> | null = null;

export function buildKrxIndex(entries: KrxInstrumentEntry[], fetchedAt: number): RegistryCache {
  const byTicker = new Map<string, KrxInstrumentEntry>();
  const byName = new Map<string, KrxInstrumentEntry>();
  for (const entry of entries) {
    if (entry.ticker) byTicker.set(entry.ticker, entry);
    if (entry.name) byName.set(entry.name, entry);
  }
  return { fetchedAt, byTicker, byName };
}

function readFromDisk(): RegistryCache | null {
  if (!existsSync(REGISTRY_FILE)) return null;
  try {
    const raw = readFileSync(REGISTRY_FILE, 'utf-8');
    const parsed = JSON.parse(raw) as RegistryFile;
    if (!parsed?.entries || !Array.isArray(parsed.entries)) return null;
    return buildKrxIndex(parsed.entries, Date.parse(parsed.fetchedAt));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn(`[krx-instrument-registry] failed to read cache — ${message}`);
    return null;
  }
}

function writeToDisk(entries: KrxInstrumentEntry[]): string {
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
      const entries = await fetchKrxInstruments();
      const fetchedAt = Date.parse(writeToDisk(entries));
      const cache = buildKrxIndex(entries, fetchedAt);
      memoryCache = cache;
      return cache;
    } catch (error) {
      if (onDisk) {
        logger.warn(
          `[krx-instrument-registry] refresh failed, falling back to stale cache — ${error instanceof Error ? error.message : String(error)}`,
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

export async function resolveIsin(
  ticker: string,
  options?: { ttlMs?: number },
): Promise<{ isin: string; name: string; market: string } | null> {
  const normalized = ticker.trim();
  if (!/^\d{6}$/.test(normalized)) return null;
  const cache = await loadRegistry(options?.ttlMs ?? DEFAULT_TTL_MS);
  const entry = cache.byTicker.get(normalized);
  if (!entry) return null;
  return { isin: entry.isin, name: entry.name, market: entry.market };
}

export function _resetKrxInstrumentRegistryForTests(): void {
  memoryCache = null;
  inflight = null;
}
