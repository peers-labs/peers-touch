/**
 * Persisted UI preference for which contact letter groups are collapsed.
 * Non-sensitive and purely cosmetic, so webview localStorage is the right
 * store (the secure bridge would add async latency to a render-time read).
 */

const COLLAPSED_GROUPS_STORAGE_KEY = 'peers-touch.mobile.contacts-collapsed-groups';

function hasStorage(): boolean {
  return typeof globalThis !== 'undefined'
    && 'localStorage' in globalThis
    && Boolean(globalThis.localStorage);
}

/** Read the collapsed letter set; corrupt payloads degrade to an empty set. */
export function readCollapsedContactGroups(): Set<string> {
  if (!hasStorage()) return new Set();
  try {
    const raw = globalThis.localStorage.getItem(COLLAPSED_GROUPS_STORAGE_KEY);
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((entry): entry is string => typeof entry === 'string'));
  } catch {
    return new Set();
  }
}

/** Persist the collapsed letter set and return it for immediate state use. */
export function writeCollapsedContactGroups(letters: ReadonlySet<string>): Set<string> {
  const next = new Set(letters);
  if (hasStorage()) {
    try {
      globalThis.localStorage.setItem(COLLAPSED_GROUPS_STORAGE_KEY, JSON.stringify([...next]));
    } catch {
      // Storage unavailable (private mode / quota); the in-memory set still works.
    }
  }
  return next;
}

/** Return a new set with one letter collapsed or expanded. */
export function withGroupCollapsed(
  letters: ReadonlySet<string>,
  letter: string,
  collapsed: boolean,
): Set<string> {
  const next = new Set(letters);
  if (collapsed) next.add(letter);
  else next.delete(letter);
  return next;
}
