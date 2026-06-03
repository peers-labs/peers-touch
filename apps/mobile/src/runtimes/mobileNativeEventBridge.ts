import { listen, type UnlistenFn } from '@tauri-apps/api/event';

import {
  dispatchSocialRuntimeExternalEvent,
  type SocialRuntimeExternalEventKind,
} from '../features/social/socialRuntime';

interface NativeRuntimeEventPayload {
  kind?: string;
  target?: string;
  sessionUlid?: string;
  session_ulid?: string;
  notificationId?: string;
  notification_id?: string;
  reason?: string;
  url?: string;
}

interface NativeRuntimeEventErrorPayload {
  operation?: string;
  message?: string;
}

const NATIVE_EVENT_NAMES = [
  'mobile:push',
  'mobile:deep-link',
  'mobile:resume',
  'mobile:notification-tap',
] as const;

export function installMobileNativeEventBridge(): () => void {
  let disposed = false;
  const unlisteners: UnlistenFn[] = [];

  NATIVE_EVENT_NAMES.forEach((eventName) => {
    listen<NativeRuntimeEventPayload>(eventName, (event) => {
      if (!disposed) dispatchNativePayload(eventName, event.payload);
    })
      .then((unlisten) => {
        if (disposed) {
          unlisten();
          return;
        }
        unlisteners.push(unlisten);
      })
      .catch((error) => reportBridgeError('listen-native-event', error));
  });

  listen<NativeRuntimeEventErrorPayload>('mobile:native-event-error', (event) => {
    reportBridgeError(event.payload?.operation || 'native-event', event.payload?.message || 'unknown');
  })
    .then((unlisten) => {
      if (disposed) {
        unlisten();
        return;
      }
      unlisteners.push(unlisten);
    })
    .catch((error) => reportBridgeError('listen-native-error-event', error));

  const onVisibilityChange = () => {
    if (document.visibilityState === 'visible') {
      dispatchSocialRuntimeExternalEvent({ kind: 'app-resume', reason: 'visibility-visible' });
    }
  };
  const onFocus = () => {
    dispatchSocialRuntimeExternalEvent({ kind: 'app-resume', reason: 'window-focus' });
  };
  const onOnline = () => {
    dispatchSocialRuntimeExternalEvent({ kind: 'network-online', reason: 'browser-online' });
  };

  document.addEventListener('visibilitychange', onVisibilityChange);
  window.addEventListener('focus', onFocus);
  window.addEventListener('online', onOnline);

  return () => {
    disposed = true;
    unlisteners.splice(0).forEach((unlisten) => unlisten());
    document.removeEventListener('visibilitychange', onVisibilityChange);
    window.removeEventListener('focus', onFocus);
    window.removeEventListener('online', onOnline);
  };
}

function dispatchNativePayload(eventName: string, payload: NativeRuntimeEventPayload | null | undefined) {
  const kind = normalizeEventKind(eventName, payload?.kind);
  dispatchSocialRuntimeExternalEvent({
    kind,
    target: payload?.target,
    sessionUlid: payload?.sessionUlid ?? payload?.session_ulid,
    notificationId: payload?.notificationId ?? payload?.notification_id,
    url: payload?.url,
    reason: payload?.reason,
  });
}

function normalizeEventKind(eventName: string, rawKind?: string): SocialRuntimeExternalEventKind {
  if (rawKind === 'push' || eventName === 'mobile:push') return 'push';
  if (rawKind === 'deep-link' || eventName === 'mobile:deep-link') return 'deep-link';
  if (rawKind === 'notification-tap' || eventName === 'mobile:notification-tap') return 'notification-tap';
  if (rawKind === 'resume' || eventName === 'mobile:resume') return 'app-resume';
  return 'native-hint';
}

function reportBridgeError(operation: string, error: unknown) {
  window.dispatchEvent(
    new CustomEvent('mobile-native-event-bridge:error', {
      detail: {
        operation,
        message: error instanceof Error ? error.message : String(error),
      },
    }),
  );
}
