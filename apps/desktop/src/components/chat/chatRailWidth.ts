// Width model and persistence for the manually resizable chat catalog rail.
//
// The rail width stays a CSS concern (`.sc-sessions` reads
// `--pt-chat-rail-width`); shared UI geometry owns the supported widths and
// this adapter owns the localStorage round-trip.

import { geometry, expandedCatalogWidth } from '@peers-touch/ui';

export const CHAT_RAIL_DEFAULT_WIDTH = geometry.chatRail.defaultWidth;
export const CHAT_RAIL_MIN_WIDTH = geometry.chatRail.minWidth;
export const CHAT_RAIL_MAX_WIDTH = geometry.chatRail.maxWidth;
export const CHAT_RAIL_WIDTH_STORAGE_KEY = 'peers.chat.railWidth';

/** Keyboard drag step (ArrowLeft / ArrowRight), in px. */
export const CHAT_RAIL_KEYBOARD_STEP = geometry.chatRail.keyboardStep;

/** Read a previously committed width; any corrupt/missing value falls back. */
export function readStoredChatRailWidth(storage: Storage): number {
  try {
    const raw = storage.getItem(CHAT_RAIL_WIDTH_STORAGE_KEY);
    if (raw === null) return CHAT_RAIL_DEFAULT_WIDTH;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return CHAT_RAIL_DEFAULT_WIDTH;
    }
    return expandedCatalogWidth(parsed);
  } catch {
    return CHAT_RAIL_DEFAULT_WIDTH;
  }
}

/** Commit only a stable width to storage. */
export function persistChatRailWidth(width: number, storage: Storage): number {
  const normalized = expandedCatalogWidth(width);
  try {
    storage.setItem(CHAT_RAIL_WIDTH_STORAGE_KEY, String(normalized));
  } catch {
    // Best-effort persistence: an unavailable storage must not block the
    // in-session resize.
  }
  return normalized;
}
