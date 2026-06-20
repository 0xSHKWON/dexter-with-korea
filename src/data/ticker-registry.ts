import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { dexterPath } from '../utils/paths.js';
import { logger } from '../utils/logger.js';
import { fetchDartCorpCodes, type CorpCodeEntry } from './fetchers/dart-corp-codes.js';

const REGISTRY_FILE = dexterPath('cache', 'dart', 'corp-codes.json');
const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

interface RegistryFile {
  fetchedAt: string;
  entries: CorpCodeEntry[];
}

interface RegistryCache {
  fetchedAt: number;
  byTicker: Map<string, CorpCodeEntry>;
  byCorpName: Map<string, CorpCodeEntry>;
}

let memoryCache: RegistryCache | null = null;
let inflight: Promise<RegistryCache> | null = null;

function buildIndex(entries: CorpCodeEntry[], fetchedAt: number): RegistryCache {
  const byTicker = new Map<string, CorpCodeEntry>();
  const byCorpName = new Map<string, CorpCodeEntry>();
  for (const entry of entries) {
    if (entry.stock_code) {
      byTicker.set(entry.stock_code, entry);
    }
    if (entry.corp_name) {
      byCorpName.set(entry.corp_name, entry);
    }
  }
  return { fetchedAt, byTicker, byCorpName };
}

function readFromDisk(): RegistryCache | null {
  if (!existsSync(REGISTRY_FILE)) return null;
  try {
    const raw = readFileSync(REGISTRY_FILE, 'utf-8');
    const parsed = JSON.parse(raw) as RegistryFile;
    if (!parsed?.entries || !Array.isArray(parsed.entries)) return null;
    return buildIndex(parsed.entries, Date.parse(parsed.fetchedAt));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn(`[ticker-registry] failed to read cache — ${message}`);
    return null;
  }
}

function writeToDisk(entries: CorpCodeEntry[]): string {
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
      const entries = await fetchDartCorpCodes();
      const fetchedAt = Date.parse(writeToDisk(entries));
      const cache = buildIndex(entries, fetchedAt);
      memoryCache = cache;
      return cache;
    } catch (error) {
      if (onDisk) {
        logger.warn(`[ticker-registry] refresh failed, falling back to stale cache — ${error instanceof Error ? error.message : String(error)}`);
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

export async function resolveTicker(
  ticker: string,
  options?: { ttlMs?: number },
): Promise<{ corp_code: string; corp_name: string } | null> {
  const normalized = ticker.trim();
  if (!/^\d{6}$/.test(normalized)) return null;
  const cache = await loadRegistry(options?.ttlMs ?? DEFAULT_TTL_MS);
  const entry = cache.byTicker.get(normalized);
  if (!entry) return null;
  return { corp_code: entry.corp_code, corp_name: entry.corp_name };
}

export async function resolveCorpName(
  name: string,
  options?: { ttlMs?: number },
): Promise<{ corp_code: string; corp_name: string; stock_code: string | null } | null> {
  const trimmed = name.trim();
  if (!trimmed) return null;
  const cache = await loadRegistry(options?.ttlMs ?? DEFAULT_TTL_MS);
  const entry = cache.byCorpName.get(trimmed);
  if (!entry) return null;
  return {
    corp_code: entry.corp_code,
    corp_name: entry.corp_name,
    stock_code: entry.stock_code,
  };
}

export function _resetTickerRegistryForTests(): void {
  memoryCache = null;
  inflight = null;
}
