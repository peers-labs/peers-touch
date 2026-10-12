/**
 * OS banner gate for bot notifications (BOT-A31/A32/A33/A35).
 *
 * The realtime `botNotification` arm is a minimal wake signal: the inbox and
 * unread badge are driven by the envelope/conversation projections. This gate
 * decides whether the event also becomes a native OS notification:
 *
 *   1. Focus layer — a visible, focused window gets in-app updates only.
 *   2. Device push layer — a category with `pushEnabled=false` suppresses the
 *      banner; `soundEnabled=false` keeps it silent. Station-level preference
 *      suppression happens before the row/event exists (A33, server side).
 *
 * Title/body/conversation come from the authoritative notification row
 * (fetched lazily). A stable `notificationId` makes the OS replace the prior
 * surface, so each event yields exactly one notification per device (A35).
 */

import { eventBus } from '../kernel/events';
import { EVENT } from '../kernel/events/catalog';
import type { RealtimeBotNotificationPayload } from '../kernel/events/types';
import {
  api,
  type NotificationData,
  type NotificationPreferenceData,
} from './desktop_api';
import { currentAuthenticatedActorPtid } from '../store/session';
import i18n from '../i18n';
import { log } from '../utils/logger';

const DEDUP_TTL_MS = 5 * 60_000;
const PREFERENCE_TTL_MS = 60_000;
const ENRICH_RETRY_DELAY_MS = 800;
const NOTIFICATION_FETCH_LIMIT = 20;

let unsubscribe: (() => void) | null = null;
const recentlyNotified = new Map<string, number>();
let preferenceCache: { at: number; preferences: NotificationPreferenceData[] } | null = null;

/** Subscribe to the bot wake signal while the social realtime bridge is up. */
export function installBotNotificationGate(): void {
  if (unsubscribe) return;
  unsubscribe = eventBus.subscribe(EVENT.REALTIME_BOT_NOTIFICATION, onBotNotification);
  log.info('botNotificationGate', 'installed');
}

export function teardownBotNotificationGate(): void {
  if (unsubscribe) unsubscribe();
  unsubscribe = null;
  recentlyNotified.clear();
  preferenceCache = null;
}

function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/** A32/A33: suppress the OS banner when the window is visible and focused. */
function isWindowFocused(): boolean {
  return typeof document !== 'undefined'
    && document.visibilityState === 'visible'
    && document.hasFocus();
}

/** Keep one surface per event even if the frame is redelivered (A35). */
function isDuplicateEvent(notificationId: string, now: number): boolean {
  if (recentlyNotified.has(notificationId)) return true;
  recentlyNotified.set(notificationId, now + DEDUP_TTL_MS);
  for (const [id, expiresAt] of recentlyNotified) {
    if (expiresAt <= now) recentlyNotified.delete(id);
  }
  return false;
}

async function onBotNotification(event: RealtimeBotNotificationPayload): Promise<void> {
  if (!isTauriRuntime()) return;
  if (!event.notificationId) return;
  if (currentAuthenticatedActorPtid() !== event.recipientActorPtid) return;
  if (isWindowFocused()) return;

  const now = Date.now();
  if (isDuplicateEvent(event.notificationId, now)) return;

  const preference = await resolveCategoryPreference(event.category);
  if (preference?.pushEnabled === false) return;
  const playSound = preference?.soundEnabled !== false;

  const detail = await resolveNotificationDetail(event.notificationId);
  const title = detail?.title?.trim()
    || i18n.t('chat.bot.notificationFallbackTitle');
  const body = detail?.body?.trim()
    || i18n.t('chat.bot.notificationFallbackBody');
  const conversationId = detail?.targetId?.trim() || '';

  try {
    await api.nativeNotificationShow({
      notificationId: event.notificationId,
      title,
      body,
      sessionUlid: conversationId || undefined,
      target: conversationId ? `chat/${conversationId}` : undefined,
      groupKey: event.groupKey || undefined,
      playSound,
    });
  } catch (error) {
    log.warn('botNotificationGate', 'native notification delivery failed', {
      notificationId: event.notificationId,
      error,
    });
  }
}

async function resolveCategoryPreference(
  category: number,
): Promise<NotificationPreferenceData | null> {
  const now = Date.now();
  if (!preferenceCache || now - preferenceCache.at > PREFERENCE_TTL_MS) {
    try {
      const snapshot = await api.notificationPreferences();
      preferenceCache = { at: now, preferences: snapshot.preferences ?? [] };
    } catch {
      // Fail open: the station layer is the hard mute gate; an unavailable
      // preference read must not silently drop a notification.
      return null;
    }
  }
  return preferenceCache.preferences.find((entry) => entry.category === category) ?? null;
}

async function resolveNotificationDetail(
  notificationId: string,
  attempt = 0,
): Promise<NotificationData | null> {
  let rows: NotificationData[] = [];
  try {
    const response = await api.notificationList(
      undefined,
      undefined,
      undefined,
      NOTIFICATION_FETCH_LIMIT,
    );
    rows = response.notifications ?? [];
  } catch {
    return null;
  }

  const match = rows.find((row) => row.id === notificationId);
  if (match) return match;
  if (attempt === 0) {
    await delay(ENRICH_RETRY_DELAY_MS);
    return resolveNotificationDetail(notificationId, attempt + 1);
  }
  return null;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
