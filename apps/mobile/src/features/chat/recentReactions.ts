// Recently-used message reactions (MRU). This is a non-sensitive UI preference
// stored in the webview's localStorage; secure storage would be overkill and
// its async bridge would force the reaction row to render before recents load.

const RECENT_REACTIONS_STORAGE_KEY = 'peers-touch.mobile.recent-reactions';
const MAX_RECENT_REACTIONS = 8;

function hasStorage(): boolean {
  return typeof globalThis !== 'undefined'
    && 'localStorage' in globalThis
    && Boolean(globalThis.localStorage);
}

/** Read the MRU list, dropping anything no longer in the allowed reaction set. */
export function readRecentReactions(allowed: readonly string[]): string[] {
  if (!hasStorage()) return [];
  try {
    const raw = globalThis.localStorage.getItem(RECENT_REACTIONS_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const allowedSet = new Set(allowed);
    const seen = new Set<string>();
    const result: string[] = [];
    for (const entry of parsed) {
      if (typeof entry !== 'string' || !allowedSet.has(entry) || seen.has(entry)) continue;
      seen.add(entry);
      result.push(entry);
      if (result.length >= MAX_RECENT_REACTIONS) break;
    }
    return result;
  } catch {
    return [];
  }
}

/** Prepend a reaction (most-recent first), dedupe, cap, and persist. Returns the new list. */
export function recordRecentReaction(reaction: string, allowed: readonly string[]): string[] {
  if (!allowed.includes(reaction)) return readRecentReactions(allowed);
  const previous = readRecentReactions(allowed);
  const next = [reaction, ...previous.filter((entry) => entry !== reaction)]
    .slice(0, MAX_RECENT_REACTIONS);
  if (hasStorage()) {
    try {
      globalThis.localStorage.setItem(RECENT_REACTIONS_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Storage can be unavailable (private mode / quota); recents are cosmetic.
    }
  }
  return next;
}

/**
 * Build the collapsed quick row: recents first, then defaults fill the remaining
 * slots, each emoji appearing at most once. The caller appends the "more" button.
 */
export function buildQuickReactions(
  recents: readonly string[],
  defaults: readonly string[],
  slotCount: number,
): string[] {
  const picked: string[] = [];
  const seen = new Set<string>();
  for (const reaction of [...recents, ...defaults]) {
    if (picked.length >= slotCount) break;
    if (seen.has(reaction)) continue;
    seen.add(reaction);
    picked.push(reaction);
  }
  return picked;
}
