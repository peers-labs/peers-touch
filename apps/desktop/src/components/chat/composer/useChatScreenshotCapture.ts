import { useCallback, useEffect, useRef, useState } from 'react';

import { imServiceV1 } from '../../../services/im-service';
import type { MessagingLocalAttachmentIntent } from '../../../services/im-service-contract';
import { RustCommandException } from '../../../services/desktop_api';
import { chatScreenshotShortcutMatches } from '../../../utils/chatScreenshotShortcut';
import { log } from '../../../utils/logger';
import { useActiveChatSettingsSlice } from '../useActiveSocialChatStore';

const CHAT_SCREENSHOT_SHORTCUT_EVENT = 'chat:screenshot-shortcut';

interface UseChatScreenshotCaptureOptions {
  conversationId: string;
  disabled: boolean;
  editing: boolean;
  enabled: boolean;
  onCaptured: (attachment: MessagingLocalAttachmentIntent) => void;
  onFailed: (reason?: string) => void;
}

export function useChatScreenshotCapture({
  disabled,
  editing,
  enabled,
  onCaptured,
  onFailed,
}: UseChatScreenshotCaptureOptions) {
  const shortcut = useActiveChatSettingsSlice((state) => state.chatScreenshotShortcut);
  const [capturing, setCapturing] = useState(false);
  const capturingRef = useRef(false);

  const captureScreenshot = useCallback(async () => {
    if (!enabled || disabled || editing || capturingRef.current) return;
    capturingRef.current = true;
    setCapturing(true);
    try {
      onCaptured(await imServiceV1.messaging.captureAttachmentSource());
    } catch (error) {
      const reason = error instanceof RustCommandException
        ? String(error.details?.reason ?? '')
        : '';
      log.warn('chat', 'screenshot capture failed', error);
      onFailed(reason || undefined);
    } finally {
      capturingRef.current = false;
      setCapturing(false);
    }
  }, [disabled, editing, enabled, onCaptured, onFailed]);

  useEffect(() => {
    if (!enabled) return undefined;
    let disposed = false;
    let unlisten: (() => void) | undefined;

    import('@tauri-apps/api/event')
      .then(({ listen }) => listen(CHAT_SCREENSHOT_SHORTCUT_EVENT, () => {
        if (!disposed) captureScreenshot();
      }))
      .then((nextUnlisten) => {
        if (disposed) {
          nextUnlisten();
          return;
        }
        unlisten = nextUnlisten;
      })
      .catch((error) => {
        log.warn('chat', 'listen global screenshot shortcut failed', error);
      });

    const handleShortcutFallback = (event: globalThis.KeyboardEvent) => {
      if (!chatScreenshotShortcutMatches(event, shortcut)) return;
      event.preventDefault();
      captureScreenshot();
    };
    window.addEventListener('keydown', handleShortcutFallback);

    return () => {
      disposed = true;
      window.removeEventListener('keydown', handleShortcutFallback);
      if (unlisten) unlisten();
    };
  }, [captureScreenshot, enabled, shortcut]);

  return { captureScreenshot, capturing };
}
