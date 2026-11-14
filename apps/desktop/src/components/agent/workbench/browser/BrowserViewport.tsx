import { useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent, type WheelEvent as ReactWheelEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { useBrowserSessionsStore, type BrowserFrameView } from '../../../../store/browserSessions';

// CDP modifier bit field: Alt=1, Ctrl=2, Meta/Command=4, Shift=8.
function modifierMask(event: ReactKeyboardEvent | MouseEvent): number {
  let mask = 0;
  if (event.altKey) mask |= 1;
  if (event.ctrlKey) mask |= 2;
  if (event.metaKey) mask |= 4;
  if (event.shiftKey) mask |= 8;
  return mask;
}

function buttonBit(button: number): number {
  if (button === 1) return 4;
  if (button === 2) return 2;
  return 1;
}

// Non-printable keys forwarded as raw key events; single-character keys are
// committed through Input.insertText so host IME compositions (compositionend)
// land in the focused page element.
const NAVIGATION_KEYS = new Set([
  'Enter',
  'Backspace',
  'Delete',
  'Tab',
  'Escape',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Home',
  'End',
  'PageUp',
  'PageDown',
  'Insert',
]);

interface BrowserViewportProps {
  sessionId: string;
  tabId: string;
  frame: BrowserFrameView | null;
}

// Live view of the remote Page: screencast frame + raw input bridge. This is
// intentionally browser-chrome-free — tab strip and navigation live above.
export function BrowserViewport({ sessionId, tabId, frame }: BrowserViewportProps) {
  const { t } = useTranslation('chat');
  const containerRef = useRef<HTMLDivElement>(null);
  const startStream = useBrowserSessionsStore((state) => state.startStream);
  const stopStream = useBrowserSessionsStore((state) => state.stopStream);
  const sendMouse = useBrowserSessionsStore((state) => state.sendMouse);
  const sendWheel = useBrowserSessionsStore((state) => state.sendWheel);
  const sendKey = useBrowserSessionsStore((state) => state.sendKey);
  const insertText = useBrowserSessionsStore((state) => state.insertText);
  // The encoded frame's real pixel size: the coordinate space CDP expects.
  const naturalRef = useRef<{ w: number; h: number } | null>(null);

  // Size the remote browser window to this container in CSS pixels; the Rust
  // side resizes the OS window and streams frames back 1:1.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;
    let cancelled = false;
    const publish = (width: number, height: number) => {
      if (cancelled || width < 2 || height < 2) return;
      void startStream(sessionId, tabId, width, height).catch(() => undefined);
    };
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect) publish(rect.width, rect.height);
    });
    observer.observe(container);
    publish(container.clientWidth, container.clientHeight);
    return () => {
      cancelled = true;
      observer.disconnect();
      void stopStream(sessionId, tabId).catch(() => undefined);
    };
  }, [sessionId, tabId, startStream, stopStream]);

  const pointFromEvent = (event: React.MouseEvent): { x: number; y: number } | null => {
    const natural = naturalRef.current;
    const container = containerRef.current;
    if (!natural || !container) return null;
    const rect = container.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    // The frame is letterboxed with object-fit: contain; map the click onto
    // the displayed content rect and then into the encoded frame's pixels.
    const scale = Math.min(rect.width / natural.w, rect.height / natural.h);
    const contentW = natural.w * scale;
    const contentH = natural.h * scale;
    const left = rect.left + (rect.width - contentW) / 2;
    const top = rect.top + (rect.height - contentH) / 2;
    const px = event.clientX - left;
    const py = event.clientY - top;
    if (px < 0 || py < 0 || px > contentW || py > contentH) return null;
    return {
      x: (px / contentW) * natural.w,
      y: (py / contentH) * natural.h,
    };
  };

  const handleMouse = (kind: 'moved' | 'pressed' | 'released', event: React.MouseEvent) => {
    const point = pointFromEvent(event);
    if (!point) return;
    const button = event.button === 1 ? 'middle' : event.button === 2 ? 'right' : 'left';
    void sendMouse(sessionId, tabId, {
      kind,
      x: point.x,
      y: point.y,
      button,
      buttons: kind === 'released' ? 0 : buttonBit(event.button),
      clickCount: kind === 'pressed' ? event.detail : 0,
    }).catch(() => undefined);
  };

  const handleWheel = (event: ReactWheelEvent) => {
    const point = pointFromEvent(event);
    if (!point) return;
    void sendWheel(sessionId, tabId, point.x, point.y, event.deltaX, event.deltaY).catch(() => undefined);
  };

  const handleKey = async (kind: 'down' | 'up', event: ReactKeyboardEvent) => {
    if (event.nativeEvent.isComposing) return;
    const modifiers = modifierMask(event);
    const printable = event.key.length === 1;
    const hasModifier = event.ctrlKey || event.metaKey || event.altKey;
    if (kind === 'down' && printable && !hasModifier) {
      event.preventDefault();
      await insertText(sessionId, tabId, event.key).catch(() => undefined);
      return;
    }
    if (!printable || hasModifier || NAVIGATION_KEYS.has(event.key) || event.key.startsWith('F')) {
      event.preventDefault();
      await sendKey(sessionId, tabId, kind, event.key, event.code, modifiers).catch(() => undefined);
    }
  };

  return (
    <div
      data-pt-browser-frame
      tabIndex={0}
      ref={containerRef}
      onMouseDown={(event) => {
        event.currentTarget.focus();
        handleMouse('pressed', event);
      }}
      onMouseUp={(event) => handleMouse('released', event)}
      onMouseMove={(event) => {
        if (event.buttons !== 0) handleMouse('moved', event);
      }}
      onMouseLeave={(event) => {
        if (event.buttons !== 0) handleMouse('moved', event);
      }}
      onContextMenu={(event) => event.preventDefault()}
      onWheel={handleWheel}
      onKeyDown={(event) => void handleKey('down', event)}
      onKeyUp={(event) => void handleKey('up', event)}
      onCompositionEnd={(event) => {
        if (event.data) void insertText(sessionId, tabId, event.data).catch(() => undefined);
      }}
      style={{
        flex: 1,
        minHeight: 0,
        position: 'relative',
        overflow: 'hidden',
        background: 'var(--pt-surface)',
        cursor: 'default',
        outline: 'none',
      }}
    >
      {frame ? (
        <img
          src={frame.dataUrl}
          alt=""
          draggable={false}
          data-pt-browser-frame-img
          onLoad={(event) => {
            naturalRef.current = {
              w: event.currentTarget.naturalWidth,
              h: event.currentTarget.naturalHeight,
            };
          }}
          style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block', pointerEvents: 'none' }}
        />
      ) : (
        <div className="wb-browser__connecting">
          {t('chat.browser.connecting')}
        </div>
      )}
    </div>
  );
}
