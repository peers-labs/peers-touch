import { useCallback, useEffect, useRef, useState } from 'react';

import { captureChatScreenshot } from '../../../services/chatAttachments';
import { RustCommandException, type ChatAttachmentInput } from '../../../services/desktop_api';
import { useSettingsStore } from '../../../store/settings';
import { chatScreenshotShortcutMatches } from '../../../utils/chatScreenshotShortcut';
import { log } from '../../../utils/logger';

const CHAT_SCREENSHOT_SHORTCUT_EVENT = 'chat:screenshot-shortcut';

interface UseChatScreenshotCaptureOptions {
  conversationId: string;
  disabled: boolean;
  editing: boolean;
  enabled: boolean;
  onCaptured: (attachment: ChatAttachmentInput) => void;
  onFailed: (reason?: string) => void;
}

export function useChatScreenshotCapture({
  conversationId,
  disabled,
  editing,
  enabled,
  onCaptured,
  onFailed,
}: UseChatScreenshotCaptureOptions) {
  const shortcut = useSettingsStore((state) => state.chatScreenshotShortcut);
  const [capturing, setCapturing] = useState(false);
  const capturingRef = useRef(false);

  const captureScreenshot = useCallback(async () => {
    if (!enabled || disabled || editing || capturingRef.current) return;
    capturingRef.current = true;
    setCapturing(true);
    try {
      onCaptured(await captureChatScreenshot({ conversationId }));
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
  }, [conversationId, disabled, editing, enabled, onCaptured, onFailed]);

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
