import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Spin, theme } from 'antd';
import { useTranslation } from 'react-i18next';
import type { BrowserElementInfo, BrowserSnapshot } from '../../../../services/desktop_api';
import type { BrowserScreenshotView } from '../../../../store/browserSessions';

interface BrowserViewportProps {
  snapshot: BrowserSnapshot | undefined;
  screenshot: BrowserScreenshotView | null;
  busy: boolean;
  agentLease: boolean;
  onHotspotClick: (ref: string) => void;
}

interface FrameRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

// In-panel live viewport: renders the real device browser frame (CDP
// screenshot) with the accessibility elements overlaid as click targets.
// Coordinates are viewport-space in the snapshot, so they are mapped with
// the same object-fit:contain math used to letterbox the frame image.
export function BrowserViewport({
  snapshot,
  screenshot,
  busy,
  agentLease,
  onHotspotClick,
}: BrowserViewportProps) {
  const { t } = useTranslation('chat');
  const { token } = theme.useToken();
  const containerRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ width: 0, height: 0 });
  const [frame, setFrame] = useState<FrameRect | null>(null);

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => {
      const rect = el.getBoundingClientRect();
      setBox({ width: rect.width, height: rect.height });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!box.width || !box.height || !screenshot?.innerWidth || !screenshot?.innerHeight) {
      setFrame(null);
      return;
    }
    const scale = Math.min(
      box.width / screenshot.innerWidth,
      box.height / screenshot.innerHeight,
    );
    const width = screenshot.innerWidth * scale;
    const height = screenshot.innerHeight * scale;
    setFrame({
      left: (box.width - width) / 2,
      top: (box.height - height) / 2,
      width,
      height,
    });
  }, [box, screenshot]);

  const elements = snapshot?.elements ?? [];

  return (
    <div
      data-pt-browser-viewport
      ref={containerRef}
      style={{
        position: 'relative',
        flex: 1,
        minHeight: 0,
        overflow: 'hidden',
        borderRadius: 8,
        border: `1px solid ${token.colorBorderSecondary}`,
        background: token.colorFillQuaternary,
      }}
    >
      {screenshot ? (
        <img
          data-pt-browser-viewport-img
          src={screenshot.dataUrl}
          alt={snapshot?.tab?.url || 'browser viewport'}
          draggable={false}
          style={{
            position: 'absolute',
            left: frame?.left ?? 0,
            top: frame?.top ?? 0,
            width: frame?.width ?? '100%',
            height: frame?.height ?? '100%',
            display: 'block',
            userSelect: 'none',
          }}
        />
      ) : (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            color: token.colorTextTertiary,
            fontSize: 12,
          }}
        >
          {busy ? <Spin size="small" /> : null}
          <span data-pt-browser-viewport-empty>{t('chat.browser.viewport.empty')}</span>
        </div>
      )}

      {frame && screenshot && agentLease ? elements.map((element) => {
        const rect = hotspotRect(element, frame, screenshot);
        if (!rect) return null;
        return (
          <button
            key={element.ref}
            type="button"
            data-pt-browser-hotspot={element.ref}
            title={`${element.tag}${element.inputType ? `(${element.inputType})` : ''} ${element.name}`.trim()}
            onClick={() => onHotspotClick(element.ref)}
            style={{
              position: 'absolute',
              left: rect.left,
              top: rect.top,
              width: rect.width,
              height: rect.height,
              minWidth: 6,
              minHeight: 6,
              padding: 0,
              border: 0,
              background: 'transparent',
              cursor: 'pointer',
            }}
            onMouseEnter={(event) => {
              event.currentTarget.style.background = token.colorPrimaryBg;
              event.currentTarget.style.outline = `1px solid ${token.colorPrimaryBorder}`;
            }}
            onMouseLeave={(event) => {
              event.currentTarget.style.background = 'transparent';
              event.currentTarget.style.outline = 'none';
            }}
          />
        );
      }) : null}
    </div>
  );
}

function hotspotRect(
  element: BrowserElementInfo,
  frame: FrameRect,
  screenshot: BrowserScreenshotView,
): FrameRect | null {
  if (!element.width || !element.height) return null;
  // Coordinates are viewport-space; rows slightly past the captured edge
  // are clamped rather than dropped — clicks target the CDP element ref,
  // not the rectangle, so the overlay only needs to be approximately right.
  const scaleX = frame.width / screenshot.innerWidth;
  const scaleY = frame.height / screenshot.innerHeight;
  const left = clamp(element.x * scaleX, 0, frame.width);
  const top = clamp(element.y * scaleY, 0, frame.height);
  const right = clamp((element.x + element.width) * scaleX, 0, frame.width);
  const bottom = clamp((element.y + element.height) * scaleY, 0, frame.height);
  return {
    left: frame.left + left,
    top: frame.top + top,
    width: Math.max(6, right - left),
    height: Math.max(6, bottom - top),
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
