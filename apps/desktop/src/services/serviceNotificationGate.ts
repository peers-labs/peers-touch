import i18n from '../i18n';
import { eventBus } from '../kernel/events';
import { EVENT } from '../kernel/events/catalog';
import type { RealtimeServiceNotificationPayload } from '../kernel/events/types';
import { currentAuthenticatedActorPtid } from '../store/session';
import { log } from '../utils/logger';
import {
  api,
  type NotificationData,
  type NotificationPreferenceData,
} from './desktop_api';

const DEDUP_TTL_MS = 5 * 60_000;
const PREFERENCE_TTL_MS = 60_000;
const ENRICH_RETRY_DELAY_MS = 800;
const NOTIFICATION_FETCH_LIMIT = 20;

let unsubscribe: (() => void) | null = null;
const recentlyNotified = new Map<string, number>();
let preferenceCache: { at: number; preferences: NotificationPreferenceData[] } | null = null;

export function installServiceNotificationGate(): void {
  if (unsubscribe) return;
  unsubscribe = eventBus.subscribe(
    EVENT.REALTIME_SERVICE_NOTIFICATION,
    onServiceNotification,
  );
  log.info('serviceNotificationGate', 'installed');
}

export function teardownServiceNotificationGate(): void {
  unsubscribe?.();
  unsubscribe = null;
  recentlyNotified.clear();
  preferenceCache = null;
}

function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

function isWindowFocused(): boolean {
  return typeof document !== 'undefined'
    && document.visibilityState === 'visible'
    && document.hasFocus();
}

function isDuplicateEvent(notificationId: string, now: number): boolean {
  if (recentlyNotified.has(notificationId)) return true;
  recentlyNotified.set(notificationId, now + DEDUP_TTL_MS);
  for (const [id, expiresAt] of recentlyNotified) {
    if (expiresAt <= now) recentlyNotified.delete(id);
  }
  return false;
}

async function onServiceNotification(
  event: RealtimeServiceNotificationPayload,
): Promise<void> {
  if (!isTauriRuntime() || !event.notificationId) return;
  if (currentAuthenticatedActorPtid() !== event.recipientActorPtid) return;
  if (isWindowFocused() || isDuplicateEvent(event.notificationId, Date.now())) return;

  const preference = await resolveCategoryPreference(event.category);
  if (preference?.pushEnabled === false) return;
  const detail = await resolveNotificationDetail(event.notificationId);
  const conversationId = detail?.targetId?.trim() || '';
  try {
    await api.nativeNotificationShow({
      notificationId: event.notificationId,
      title: detail?.title?.trim()
        || i18n.t('chat.service.notificationFallbackTitle', 'Automated update'),
      body: detail?.body?.trim()
        || i18n.t('chat.service.notificationFallbackBody', 'Open Peers Touch for details'),
      sessionUlid: conversationId || undefined,
      target: conversationId ? `chat/${conversationId}` : undefined,
      groupKey: event.groupKey || undefined,
      playSound: preference?.soundEnabled !== false,
    });
  } catch (error) {
    log.warn('serviceNotificationGate', 'native notification delivery failed', {
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
      return null;
    }
  }
  return preferenceCache.preferences.find(entry => entry.category === category) ?? null;
}

async function resolveNotificationDetail(
  notificationId: string,
  attempt = 0,
): Promise<NotificationData | null> {
  try {
    const response = await api.notificationList(
      undefined,
      undefined,
      undefined,
      NOTIFICATION_FETCH_LIMIT,
    );
    const match = (response.notifications ?? []).find(row => row.id === notificationId);
    if (match) return match;
  } catch {
    return null;
  }
  if (attempt === 0) {
    await new Promise(resolve => setTimeout(resolve, ENRICH_RETRY_DELAY_MS));
    return resolveNotificationDetail(notificationId, 1);
  }
  return null;
}
