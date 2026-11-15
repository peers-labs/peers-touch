// Width model and persistence for the manually resizable chat catalog rail.
//
// The rail width stays a CSS concern (`.sc-sessions` reads
// `--pt-chat-rail-width`); this module only owns the numeric clamp and the
// localStorage round-trip so both stay unit-testable without a DOM.

import { geometry } from '@peers-touch/ui';

export const CHAT_RAIL_DEFAULT_WIDTH = geometry.chatRail.defaultWidth;
export const CHAT_RAIL_MIN_WIDTH = geometry.chatRail.minWidth;
export const CHAT_RAIL_MAX_WIDTH = geometry.chatRail.maxWidth;
export const CHAT_RAIL_COMPACT_WIDTH = geometry.chatRail.compactWidth;
export const CHAT_RAIL_WIDTH_STORAGE_KEY = 'peers.chat.railWidth';

/** Keyboard drag step (ArrowLeft / ArrowRight), in px. */
export const CHAT_RAIL_KEYBOARD_STEP = geometry.chatRail.keyboardStep;

/** Clamp an arbitrary input into the supported rail width band. */
export function clampChatRailWidth(width: number): number {
  if (!Number.isFinite(width)) return CHAT_RAIL_DEFAULT_WIDTH;
  return Math.min(
    CHAT_RAIL_MAX_WIDTH,
    Math.max(CHAT_RAIL_MIN_WIDTH, Math.round(width)),
  );
}

/** Read a previously committed width; any corrupt/missing value falls back. */
export function readStoredChatRailWidth(storage: Storage): number {
  try {
    const raw = storage.getItem(CHAT_RAIL_WIDTH_STORAGE_KEY);
    if (raw === null) return CHAT_RAIL_DEFAULT_WIDTH;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return CHAT_RAIL_DEFAULT_WIDTH;
    }
    return clampChatRailWidth(parsed);
  } catch {
    return CHAT_RAIL_DEFAULT_WIDTH;
  }
}

/** Commit a width to storage, normalizing it through the same clamp. */
export function persistChatRailWidth(width: number, storage: Storage): number {
  const clamped = clampChatRailWidth(width);
  try {
    storage.setItem(CHAT_RAIL_WIDTH_STORAGE_KEY, String(clamped));
  } catch {
    // Best-effort persistence: an unavailable storage must not block the
    // in-session resize.
  }
  return clamped;
}
