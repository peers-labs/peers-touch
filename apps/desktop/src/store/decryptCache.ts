/**
 * Message decrypt cache — stores decrypted plaintext keyed by message ULID.
 *
 * Purpose: Avoid re-decrypting messages on every conversation switch.
 * Cache is in-memory only (no persistence needed since the Rust crypto
 * store persists chain state; re-decrypting a seen message is always
 * possible, just expensive due to IPC overhead).
 *
 * Design:
 * - LRU-ish: evicts oldest entries when size exceeds MAX_ENTRIES.
 * - Scoped to the current session (cleared on logout).
 * - Thread-safe for single-threaded JS; no locking needed.
 */

interface CachedDecrypt {
  content: string;
  type: number;
  attachments: unknown[];
  /** Timestamp of cache insertion (for LRU eviction). */
  cachedAt: number;
}

const MAX_ENTRIES = 5000;

const cache = new Map<string, CachedDecrypt>();

/**
 * Get cached decrypted content for a message ULID.
 * Returns null if not cached (caller should decrypt and then `set`).
 */
export function getDecryptCache(messageUlid: string): CachedDecrypt | null {
  return cache.get(messageUlid) ?? null;
}

/**
 * Store decrypted content for a message ULID.
 */
export function setDecryptCache(messageUlid: string, entry: CachedDecrypt): void {
  if (cache.size >= MAX_ENTRIES) {
    // Evict oldest 20% by cachedAt
    const entries = [...cache.entries()].sort((a, b) => a[1].cachedAt - b[1].cachedAt);
    const evictCount = Math.floor(MAX_ENTRIES * 0.2);
    for (let i = 0; i < evictCount; i++) {
      cache.delete(entries[i][0]);
    }
  }
  cache.set(messageUlid, entry);
}

/**
 * Check if a message ULID is cached.
 */
export function hasDecryptCache(messageUlid: string): boolean {
  return cache.has(messageUlid);
}

/**
 * Invalidate a specific message (e.g. on edit/recall).
 */
export function invalidateDecryptCache(messageUlid: string): void {
  cache.delete(messageUlid);
}

/**
 * Clear all cached decrypts (e.g. on logout).
 */
export function clearDecryptCache(): void {
  cache.clear();
}
