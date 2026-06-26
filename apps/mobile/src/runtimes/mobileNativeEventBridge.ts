import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import {
  buildSocialHostEvent,
  type SocialHostEventPayloadLike,
} from '@peers-touch/client-chat-core';

import { dispatchSocialRuntimeExternalEvent } from '../features/social/socialRuntime';
import { readableErrorMessage } from '../utils/errorMessage';

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
    listen<SocialHostEventPayloadLike>(eventName, (event) => {
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

function dispatchNativePayload(eventName: string, payload: SocialHostEventPayloadLike | null | undefined) {
  dispatchSocialRuntimeExternalEvent(buildSocialHostEvent(eventName, payload));
}

function reportBridgeError(operation: string, error: unknown) {
  window.dispatchEvent(
    new CustomEvent('mobile-native-event-bridge:error', {
      detail: {
        operation,
        message: readableErrorMessage(error),
      },
    }),
  );
}
