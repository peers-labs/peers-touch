import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import {
  buildSocialHostEvent,
  type SocialHostEvent,
  type SocialHostEventPayloadLike,
} from '@peers-touch/client-chat-core';

import { log } from '../utils/logger';

interface DesktopHostEventErrorPayload {
  operation?: string;
  message?: string;
}

const DESKTOP_NATIVE_EVENT_NAMES = [
  'desktop:resume',
  'desktop:tray-open',
  'desktop:notification-tap',
] as const;

export function installDesktopSocialHostAdapter(
  dispatch: (event: SocialHostEvent) => void,
): () => void {
  let disposed = false;
  const unlisteners: UnlistenFn[] = [];

  DESKTOP_NATIVE_EVENT_NAMES.forEach((eventName) => {
    listen<SocialHostEventPayloadLike>(eventName, (event) => {
      if (!disposed) dispatch(buildSocialHostEvent(eventName, event.payload));
    })
      .then((unlisten) => {
        if (disposed) {
          unlisten();
          return;
        }
        unlisteners.push(unlisten);
      })
      .catch((error) => {
        log.warn('socialHostAdapter', 'listen desktop host event failed', { eventName, error });
      });
  });

  listen<DesktopHostEventErrorPayload>('desktop:native-event-error', (event) => {
    log.warn('socialHostAdapter', 'desktop native host event error', {
      operation: event.payload?.operation,
      message: event.payload?.message,
    });
  })
    .then((unlisten) => {
      if (disposed) {
        unlisten();
        return;
      }
      unlisteners.push(unlisten);
    })
    .catch((error) => {
      log.warn('socialHostAdapter', 'listen desktop native error event failed', { error });
    });

  const onVisibilityChange = () => {
    if (document.visibilityState === 'visible') {
      dispatch({ kind: 'app-resume', reason: 'visibility-visible' });
    }
  };
  const onFocus = () => {
    dispatch({ kind: 'app-resume', reason: 'window-focus' });
  };
  const onOnline = () => {
    dispatch({ kind: 'network-online', reason: 'browser-online' });
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
