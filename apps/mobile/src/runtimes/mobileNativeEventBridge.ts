import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import {
  buildSocialHostEvent,
  type SocialHostEventPayloadLike,
} from '@peers-touch/client-chat-core';

import { dispatchSocialRuntimeExternalEvent } from '../features/social/socialRuntime';
import type { OAuthPublicProjection } from '../services/mobileCommands';
import { readableErrorMessage } from '../utils/errorMessage';
import { getMobileLifecycleKernel } from '../app/lifecycle/MobileLifecycleKernel';
import {
  applyAuthRuntimeProjection,
  restoreAuthRuntimeProjection,
} from './authRuntime';
import { installNativeLifecycleBridge } from './nativeLifecycleBridge';
import { wakeActiveMessagingSession } from './messagingRuntime';

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

let lifecycleTransition: Promise<void> = Promise.resolve();

export function installMobileNativeEventBridge(): () => void {
  let disposed = false;
  const unlisteners: UnlistenFn[] = [];

  // W7: Install the lifecycle generation bridge listeners
  const teardownLifecycleBridge = installNativeLifecycleBridge();

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

  listen<OAuthPublicProjection>('mobile:oauth-projection', (event) => {
    if (!disposed) applyAuthRuntimeProjection(event.payload);
  })
    .then((unlisten) => {
      if (disposed) {
        unlisten();
        return;
      }
      unlisteners.push(unlisten);
      void restoreAuthRuntimeProjection();
    })
    .catch((error) => reportBridgeError('listen-oauth-projection', error));

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
    enqueueLifecycleTransition(
      document.visibilityState === 'visible',
      'visibility-change',
    );
  };
  const onFocus = () => {
    dispatchSocialRuntimeExternalEvent({ kind: 'app-resume', reason: 'window-focus' });
    enqueueLifecycleTransition(true, 'window-focus');
  };
  const onOnline = () => {
    dispatchSocialRuntimeExternalEvent({ kind: 'network-online', reason: 'browser-online' });
    void wakeActiveMessagingSession().catch((error) => {
      reportBridgeError('messaging-network-wake', error);
    });
  };

  document.addEventListener('visibilitychange', onVisibilityChange);
  window.addEventListener('focus', onFocus);
  window.addEventListener('online', onOnline);

  return () => {
    disposed = true;
    teardownLifecycleBridge();
    unlisteners.splice(0).forEach((unlisten) => unlisten());
    document.removeEventListener('visibilitychange', onVisibilityChange);
    window.removeEventListener('focus', onFocus);
    window.removeEventListener('online', onOnline);
  };
}

function dispatchNativePayload(eventName: string, payload: SocialHostEventPayloadLike | null | undefined) {
  dispatchSocialRuntimeExternalEvent(buildSocialHostEvent(eventName, payload));
  if (eventName === 'mobile:resume') {
    enqueueLifecycleTransition(true, 'native-resume');
  }
}

function enqueueLifecycleTransition(foreground: boolean, reason: string): void {
  lifecycleTransition = lifecycleTransition
    .then(async () => {
      const kernel = getMobileLifecycleKernel();
      const phase = kernel.getPhase();
      if (!foreground) {
        if (phase === 'ACTIVE') await kernel.suspend();
        return;
      }
      if (phase === 'SUSPENDED') {
        await kernel.resume();
        return;
      }
      if (phase === 'ACTIVE') {
        await wakeActiveMessagingSession();
      }
    })
    .catch((error) => {
      reportBridgeError(`lifecycle-${reason}`, error);
    });
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
