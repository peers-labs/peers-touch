import type { KeyboardEvent as ReactKeyboardEvent } from 'react';

export const DEFAULT_CHAT_SCREENSHOT_SHORTCUT = 'Mod+Shift+A';

interface ShortcutSpec {
  alt: boolean;
  ctrl: boolean;
  key: string;
  meta: boolean;
  mod: boolean;
  shift: boolean;
}

const MODIFIER_KEYS = new Set(['Alt', 'Control', 'Meta', 'Shift']);

function normalizeKey(key: string): string {
  if (key.length === 1) return key.toUpperCase();
  return key;
}

export function normalizeChatScreenshotShortcut(value: unknown): string {
  return parseChatScreenshotShortcut(value) ? String(value) : DEFAULT_CHAT_SCREENSHOT_SHORTCUT;
}

export function parseChatScreenshotShortcut(value: unknown): ShortcutSpec | null {
  if (typeof value !== 'string') return null;
  const tokens = value.split('+').map((token) => token.trim()).filter(Boolean);
  if (tokens.length < 2) return null;

  const spec: ShortcutSpec = {
    alt: false,
    ctrl: false,
    key: '',
    meta: false,
    mod: false,
    shift: false,
  };

  for (const token of tokens) {
    const lower = token.toLowerCase();
    if (lower === 'mod') spec.mod = true;
    else if (lower === 'meta' || lower === 'cmd' || lower === 'command') spec.meta = true;
    else if (lower === 'ctrl' || lower === 'control') spec.ctrl = true;
    else if (lower === 'shift') spec.shift = true;
    else if (lower === 'alt' || lower === 'option') spec.alt = true;
    else if (!spec.key) spec.key = normalizeKey(token);
    else return null;
  }

  if (!spec.key || MODIFIER_KEYS.has(spec.key)) return null;
  if (!spec.mod && !spec.meta && !spec.ctrl && !spec.alt && !spec.shift) return null;
  return spec;
}

export function chatScreenshotShortcutFromKeyboardEvent(event: KeyboardEvent | ReactKeyboardEvent): string | null {
  const nativeKey = normalizeKey(event.key);
  if (MODIFIER_KEYS.has(nativeKey)) return null;
  const parts = [
    event.metaKey ? 'Meta' : '',
    event.ctrlKey ? 'Ctrl' : '',
    event.altKey ? 'Alt' : '',
    event.shiftKey ? 'Shift' : '',
    nativeKey,
  ].filter(Boolean);
  return parts.length >= 2 ? parts.join('+') : null;
}

export function formatChatScreenshotShortcut(value: unknown): string {
  const normalized = normalizeChatScreenshotShortcut(value);
  return normalized
    .split('+')
    .map((part) => {
      const lower = part.toLowerCase();
      if (lower === 'mod') return '⌘/Ctrl';
      if (lower === 'meta') return '⌘';
      if (lower === 'ctrl') return 'Ctrl';
      if (lower === 'alt') return 'Alt';
      if (lower === 'shift') return 'Shift';
      return part.length === 1 ? part.toUpperCase() : part;
    })
    .join(' + ');
}

export function chatScreenshotShortcutMatches(event: KeyboardEvent, value: unknown): boolean {
  const spec = parseChatScreenshotShortcut(normalizeChatScreenshotShortcut(value));
  if (!spec) return false;
  const keyMatches = normalizeKey(event.key) === spec.key;
  const modMatches = spec.mod
    ? event.metaKey || event.ctrlKey
    : event.metaKey === spec.meta && event.ctrlKey === spec.ctrl;
  return keyMatches
    && modMatches
    && event.altKey === spec.alt
    && event.shiftKey === spec.shift;
}
