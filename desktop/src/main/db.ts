/**
 * Local SQLite store for the desktop app.
 *
 * - `settings`: plain key/value app config (provider, modelId, UI prefs …),
 *   value JSON-encoded. Mirrors the core's `.dexter/settings.json` shape.
 * - `secrets`: API keys, stored as safeStorage ciphertext (NEVER plaintext).
 *   See `secrets.ts` for encrypt/decrypt.
 *
 * DB lives in Electron's per-user `userData` dir, so it is naturally isolated
 * from the CLI's CWD-relative `.dexter/` dir until the sidecar wires them up.
 */
import { join } from 'node:path';
import { app } from 'electron';
import Database from 'better-sqlite3';

let db: Database.Database | null = null;

export function initDb(): Database.Database {
  if (db) return db;
  const dbPath = join(app.getPath('userData'), 'dexter-desktop.db');
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS secrets (
      env_var    TEXT PRIMARY KEY,
      ciphertext BLOB NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS work_conversions (
      id         TEXT PRIMARY KEY,
      created_at INTEGER NOT NULL,
      title      TEXT NOT NULL,
      raw        TEXT NOT NULL,
      result     TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS chat_conversations (
      id         TEXT PRIMARY KEY,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      title      TEXT NOT NULL,
      messages   TEXT NOT NULL
    );
  `);
  return db;
}

function getDb(): Database.Database {
  if (!db) throw new Error('DB not initialized — call initDb() first');
  return db;
}

// ── settings ──────────────────────────────────────────────────────────────

export function getSetting<T>(key: string, defaultValue: T): T {
  const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get(key) as
    | { value: string }
    | undefined;
  if (!row) return defaultValue;
  try {
    return JSON.parse(row.value) as T;
  } catch {
    return defaultValue;
  }
}

export function setSetting(key: string, value: unknown): void {
  getDb()
    .prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)')
    .run(key, JSON.stringify(value));
}

export function getAllSettings(): Record<string, unknown> {
  const rows = getDb().prepare('SELECT key, value FROM settings').all() as {
    key: string;
    value: string;
  }[];
  const out: Record<string, unknown> = {};
  for (const r of rows) {
    try {
      out[r.key] = JSON.parse(r.value);
    } catch {
      out[r.key] = r.value;
    }
  }
  return out;
}

// ── secrets (ciphertext only) ───────────────────────────────────────────────

export function setSecret(envVar: string, ciphertext: Buffer): void {
  getDb()
    .prepare('INSERT OR REPLACE INTO secrets (env_var, ciphertext, updated_at) VALUES (?, ?, ?)')
    .run(envVar, ciphertext, Date.now());
}

export function getSecret(envVar: string): Buffer | null {
  const row = getDb().prepare('SELECT ciphertext FROM secrets WHERE env_var = ?').get(envVar) as
    | { ciphertext: Buffer }
    | undefined;
  return row ? row.ciphertext : null;
}

export function getSecretUpdatedAt(envVar: string): number | null {
  const row = getDb().prepare('SELECT updated_at FROM secrets WHERE env_var = ?').get(envVar) as
    | { updated_at: number }
    | undefined;
  return row ? row.updated_at : null;
}

export function deleteSecret(envVar: string): void {
  getDb().prepare('DELETE FROM secrets WHERE env_var = ?').run(envVar);
}

// ── work conversions (archive) ──────────────────────────────────────────────

export interface ConversionRow {
  id: string;
  created_at: number;
  title: string;
  raw: string;
  result: string;
}

export function insertConversion(r: ConversionRow): void {
  getDb()
    .prepare('INSERT INTO work_conversions (id, created_at, title, raw, result) VALUES (?, ?, ?, ?, ?)')
    .run(r.id, r.created_at, r.title, r.raw, r.result);
}

export function listConversionRows(): ConversionRow[] {
  return getDb()
    .prepare('SELECT id, created_at, title, raw, result FROM work_conversions ORDER BY created_at DESC')
    .all() as ConversionRow[];
}

export function deleteConversion(id: string): void {
  getDb().prepare('DELETE FROM work_conversions WHERE id = ?').run(id);
}

// ── chat conversations (archive) ────────────────────────────────────────────

export interface ChatRow {
  id: string;
  created_at: number;
  updated_at: number;
  title: string;
  messages: string;
}

export function upsertChat(r: ChatRow): void {
  getDb()
    .prepare(
      `INSERT INTO chat_conversations (id, created_at, updated_at, title, messages)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET updated_at = excluded.updated_at, title = excluded.title, messages = excluded.messages`,
    )
    .run(r.id, r.created_at, r.updated_at, r.title, r.messages);
}

export function listChatRows(): ChatRow[] {
  return getDb()
    .prepare('SELECT id, created_at, updated_at, title, messages FROM chat_conversations ORDER BY updated_at DESC')
    .all() as ChatRow[];
}

export function deleteChat(id: string): void {
  getDb().prepare('DELETE FROM chat_conversations WHERE id = ?').run(id);
}
