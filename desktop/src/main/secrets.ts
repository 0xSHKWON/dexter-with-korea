/**
 * API-key encryption via Electron safeStorage.
 *
 * safeStorage binds the encryption key to the OS keychain (macOS Keychain,
 * Windows DPAPI), so ciphertext at rest in the SQLite DB is useless without the
 * logged-in user's session. We never persist or hand plaintext keys to the
 * renderer — only an "exists" flag plus the last 4 chars for visual confirmation.
 */
import { safeStorage } from 'electron';

export function isEncryptionAvailable(): boolean {
  return safeStorage.isEncryptionAvailable();
}

export function encryptSecret(plaintext: string): Buffer {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('OS secure storage is unavailable on this system');
  }
  return safeStorage.encryptString(plaintext);
}

export function decryptSecret(ciphertext: Buffer): string {
  return safeStorage.decryptString(ciphertext);
}

/** Last 4 chars of a stored key for UI confirmation, or null if undecryptable. */
export function previewLast4(ciphertext: Buffer): string | null {
  try {
    const plain = decryptSecret(ciphertext);
    return plain.length >= 4 ? plain.slice(-4) : plain;
  } catch {
    return null;
  }
}
