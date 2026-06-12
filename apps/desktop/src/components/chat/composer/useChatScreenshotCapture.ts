import { useCallback, useEffect } from 'react';

import { captureChatScreenshot } from '../../../services/chatAttachments';
import type { ChatAttachmentInput } from '../../../services/desktop_api';
import { log } from '../../../utils/logger';

interface UseChatScreenshotCaptureOptions {
  conversationId: string;
  disabled: boolean;
  editing: boolean;
  enabled: boolean;
  onCaptured: (attachment: ChatAttachmentInput) => void;
  onFailed: () => void;
}

export function useChatScreenshotCapture({
  conversationId,
  disabled,
  editing,
  enabled,
  onCaptured,
  onFailed,
}: UseChatScreenshotCaptureOptions) {
  const captureScreenshot = useCallback(async () => {
    if (!enabled || disabled || editing) return;
    try {
      onCaptured(await captureChatScreenshot({ conversationId }));
    } catch (error) {
      if (error instanceof Error && error.message.toLowerCase().includes('screenshot cancelled')) {
        return;
      }
      log.warn('chat', 'screenshot capture failed', error);
      onFailed();
    }
  }, [conversationId, disabled, editing, enabled, onCaptured, onFailed]);

  useEffect(() => {
    if (!enabled) return undefined;
    const handleShortcut = (event: globalThis.KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || !event.shiftKey) return;
      if (event.key.toLowerCase() !== 'a') return;
      event.preventDefault();
      captureScreenshot();
    };
    window.addEventListener('keydown', handleShortcut);
    return () => window.removeEventListener('keydown', handleShortcut);
  }, [captureScreenshot, enabled]);

  return { captureScreenshot };
}
