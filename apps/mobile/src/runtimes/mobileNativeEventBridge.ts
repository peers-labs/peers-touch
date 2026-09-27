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
import { readActiveSessionProjection } from './sessionRuntime';
import {
  activateNativePush,
  deactivateNativePush,
  drainNativePush,
  drainScheduledReconcile,
  getLifecycleGeneration,
  installNativeLifecycleBridge,
  reconcileNativeLifecycle,
  type LifecycleEventPayload,
  type NativePushScope,
  type NetworkState,
} from './nativeLifecycleBridge';
import {
  wakeActiveMessagingSession,
} from './messagingRuntime';
import { getRecoveryProjection } from './recoveryProjection';

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

export interface MobileNativeEventBridgeInstallation {
  readonly ready: Promise<void>;
  teardown(): Promise<void>;
}

export function installMobileNativeEventBridge(): MobileNativeEventBridgeInstallation {
  let disposed = false;
  const unlisteners: UnlistenFn[] = [];
  let nativeLifecycleCallbacksAvailable = false;
  let nativeNetworkCallbacksAvailable = false;

  const lifecycleBridge = installNativeLifecycleBridge({
    onLifecycleEvent: handleCanonicalLifecycleEvent,
    onNetworkStateChange: handleNativeNetworkStateChange,
    onNativeListenerReady: () => {
      nativeLifecycleCallbacksAvailable = true;
    },
    onNativeNetworkListenerReady: () => {
      nativeNetworkCallbacksAvailable = true;
    },
    onPushCallbacksAvailable: async () => {
      const scope = activePushScope();
      if (!scope) return;
      await drainNativePush(scope);
    },
    onScheduledCallbacksAvailable: async () => {
      const scope = activePushScope();
      if (!scope) return;
      await drainScheduledReconcile(scope);
    },
  });

  const installListener = async <Payload>(
    eventName: string,
    operation: string,
    handler: (payload: Payload) => void | Promise<void>,
  ): Promise<void> => {
    try {
      const unlisten = await listen<Payload>(eventName, (event) => {
        if (disposed) return;
        try {
          void Promise.resolve(handler(event.payload)).catch((error) => {
            reportBridgeError(operation, error);
          });
        } catch (error) {
          reportBridgeError(operation, error);
        }
      });
      if (disposed) {
        unlisten();
        return;
      }
      unlisteners.push(unlisten);
    } catch (error) {
      reportBridgeError(operation, error);
    }
  };

  const nativeEventListenersReady = Promise.all(NATIVE_EVENT_NAMES.map(
    (eventName) => installListener<SocialHostEventPayloadLike>(
      eventName,
      'listen-native-event',
      (payload) => dispatchNativePayload(eventName, payload),
    ),
  ));

  const oauthListenerReady = installListener<OAuthPublicProjection>(
    'mobile:oauth-projection',
    'listen-oauth-projection',
    (payload) => {
      applyAuthRuntimeProjection(payload);
    },
  ).then(async () => {
    if (!disposed) await restoreAuthRuntimeProjection();
  }).catch((error) => {
    reportBridgeError('restore-oauth-projection', error);
  });

  const errorListenerReady = installListener<NativeRuntimeEventErrorPayload>(
    'mobile:native-event-error',
    'listen-native-error-event',
    (payload) => {
      reportBridgeError(payload?.operation || 'native-event', payload?.message || 'unknown');
    },
  );

  const onVisibilityChange = () => {
    if (nativeLifecycleCallbacksAvailable) return;
    const foreground = document.visibilityState === 'visible';
    void enqueueLifecycleTransition(
      foreground,
      'visibility-change',
    ).then(() => {
      if (foreground) {
        dispatchSocialRuntimeExternalEvent({
          kind: 'app-resume',
          reason: 'visibility-visible',
        });
      }
    });
  };
  const onFocus = () => {
    if (nativeLifecycleCallbacksAvailable) return;
    void enqueueLifecycleTransition(true, 'window-focus').then(() => {
      dispatchSocialRuntimeExternalEvent({
        kind: 'app-resume',
        reason: 'window-focus',
      });
    });
  };
  const onOnline = () => {
    if (nativeNetworkCallbacksAvailable) return;
    void handleConnectionRestored('browser-online');
  };
  const onOffline = () => {
    if (nativeNetworkCallbacksAvailable) return;
    getRecoveryProjection().reportDeviceLocalFlag('no-network');
  };

  document.addEventListener('visibilitychange', onVisibilityChange);
  window.addEventListener('focus', onFocus);
  window.addEventListener('online', onOnline);
  window.addEventListener('offline', onOffline);

  const ready = Promise.all([
    lifecycleBridge.ready,
    nativeEventListenersReady,
    oauthListenerReady,
    errorListenerReady,
  ]).then(async () => {
    await ensureNativePushActive();
    if (disposed || nativeNetworkCallbacksAvailable) return;
    if (
      typeof navigator === 'undefined'
      || typeof navigator.onLine !== 'boolean'
    ) {
      return;
    }
    if (navigator.onLine === false) {
      onOffline();
      return;
    }
    await handleConnectionRestored('browser-online');
  });

  async function teardown(): Promise<void> {
    if (disposed) return;
    disposed = true;
    await deactivateNativePush().catch((error) => {
      reportBridgeError('native-push-deactivate', error);
    });
    await lifecycleBridge.teardown();
    await Promise.all(
      unlisteners.splice(0).map((unlisten) => Promise.resolve(unlisten())),
    );
    document.removeEventListener('visibilitychange', onVisibilityChange);
    window.removeEventListener('focus', onFocus);
    window.removeEventListener('online', onOnline);
    window.removeEventListener('offline', onOffline);
  }

  return { ready, teardown };
}

async function handleCanonicalLifecycleEvent(
  payload: LifecycleEventPayload,
): Promise<void> {
  if (payload.state === 'wakeup') {
    await handleMessagingWake('messaging-background-wake');
    return;
  }
  if (payload.state === 'background') {
    enqueueLifecycleTransition(false, 'native-background');
    return;
  }
  if (payload.state !== 'foreground') return;

  await enqueueLifecycleTransition(true, 'native-resume');
  if (readActiveSessionProjection()) {
    await ensureNativePushActive();
    await reconcileNativeLifecycle(true);
  }
  dispatchSocialRuntimeExternalEvent({
    kind: 'app-resume',
    reason: 'native-lifecycle-foreground',
  });
}

async function ensureNativePushActive(): Promise<void> {
  const scope = activePushScope();
  if (!scope || getLifecycleGeneration() === 0) return;
  await activateNativePush(scope);
  await drainNativePush(scope);
}

function activePushScope(): NativePushScope | null {
  const session = readActiveSessionProjection();
  if (
    !session
    || !session.stationPeerId
    || !session.actorPtid
    || !session.sessionId
  ) {
    return null;
  }
  return {
    stationPeerId: session.stationPeerId,
    actorPtid: session.actorPtid,
    sessionId: session.sessionId,
    environment: import.meta.env.PROD ? 'production' : 'development',
  };
}

async function handleNativeNetworkStateChange(
  state: NetworkState,
  connectionRestored: boolean,
): Promise<void> {
  if (!state.connected) {
    getRecoveryProjection().reportDeviceLocalFlag('no-network');
    return;
  }
  if (connectionRestored) {
    await handleConnectionRestored('native-network-restored');
    return;
  }
  getRecoveryProjection().clearDeviceLocalFlag('no-network');
}

async function handleConnectionRestored(
  reason: 'native-network-restored' | 'browser-online',
): Promise<void> {
  getRecoveryProjection().clearDeviceLocalFlag('no-network');
  dispatchSocialRuntimeExternalEvent({
    kind: 'network-online',
    reason,
  });
  try {
    await ensureNativePushActive();
  } catch (error) {
    reportBridgeError('native-push-network-retry', error);
  }
  await handleMessagingWake('messaging-network-wake');
}

async function handleMessagingWake(operation: string): Promise<void> {
  if (getMobileLifecycleKernel().getPhase() !== 'ACTIVE') return;
  try {
    await wakeActiveMessagingSession();
  } catch (error) {
    reportBridgeError(operation, error);
  }
}

function dispatchNativePayload(eventName: string, payload: SocialHostEventPayloadLike | null | undefined) {
  if (eventName === 'mobile:resume') {
    void enqueueLifecycleTransition(true, 'native-resume').then(() => {
      dispatchSocialRuntimeExternalEvent(buildSocialHostEvent(eventName, payload));
    });
    return;
  }
  dispatchSocialRuntimeExternalEvent(buildSocialHostEvent(eventName, payload));
}

function enqueueLifecycleTransition(
  foreground: boolean,
  reason:
    | 'native-background'
    | 'native-resume'
    | 'visibility-change'
    | 'window-focus',
): Promise<void> {
  lifecycleTransition = lifecycleTransition
    .then(async () => {
      const kernel = getMobileLifecycleKernel();
      const phase = kernel.getPhase();
      if (!foreground) {
        if (phase === 'ACTIVE') {
          await kernel.suspend(
            reason === 'native-background'
              ? 'app-background'
              : 'visibility-change',
          );
        }
        return;
      }
      if (phase === 'SUSPENDED') {
        await kernel.resume(
          reason === 'native-resume' ? 'native-resume' : 'app-resume',
        );
        return;
      }
      if (phase === 'ACTIVE') {
        await wakeActiveMessagingSession();
      }
    })
    .catch((error) => {
      reportBridgeError(`lifecycle-${reason}`, error);
    });
  return lifecycleTransition;
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
