/**
 * emoji-palette — single source of truth for the COMPOSER emoji palette.
 *
 * This is the emoji a user inserts into a message they are composing. It is
 * deliberately separate from chat-domain reactions (the fixed reaction set a
 * reader pins onto an existing message): reactions are a closed 16-kind
 * vocabulary, while the composer palette is a broader general-purpose emoji
 * set plus a per-device "recent" list. Desktop and mobile composers both read
 * this module so the palette content can never fork between surfaces.
 *
 * Only data + pure persistence helpers live here; each surface renders its own
 * panel container (desktop 10-column popover, mobile touch grid).
 */

export const COMPOSER_EMOJI_RECENT_KEY = 'peers-touch:prototype:recent-emojis';

/** Four groups of ten; flattened for the grid, group boundaries only seed the
    initial ordering. Kept as groups so future category labelling has an axis. */
export const COMPOSER_EMOJI_GROUPS: readonly (readonly string[])[] = [
  ['😀', '😁', '😂', '🤣', '😊', '😍', '😘', '😎', '😭', '😡'],
  ['👍', '👎', '👏', '🙏', '💪', '🤝', '👌', '✌️', '🤟', '👋'],
  ['❤️', '💔', '💕', '💯', '✨', '🔥', '🎉', '🌹', '⭐', '💤'],
  ['😅', '😇', '🙂', '🙃', '😉', '😌', '😋', '🤔', '🤫', '😴'],
];

export const COMPOSER_EMOJIS: readonly string[] = COMPOSER_EMOJI_GROUPS.flat();

const RECENT_LIMIT = 24;

export function loadRecentEmojis(): string[] {
  try {
    const raw = window.localStorage.getItem(COMPOSER_EMOJI_RECENT_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

/** Most-recent-first, de-duplicated, capped. Pure: returns the next list. */
export function nextRecentEmojis(prev: readonly string[], emoji: string): string[] {
  return [emoji, ...prev.filter(item => item !== emoji)].slice(0, RECENT_LIMIT);
}

export function persistRecentEmojis(list: readonly string[]): void {
  try {
    window.localStorage.setItem(COMPOSER_EMOJI_RECENT_KEY, JSON.stringify(list));
  } catch {
    // Storage can be unavailable (private mode); recency is non-essential.
  }
}
