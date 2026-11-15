import { useRef, useState } from 'react';
import { geometry } from '@peers-touch/ui';
import { useT } from '../prefs';

export function clampRailWidth(width: number): number {
  return Number.isFinite(width)
    ? Math.min(geometry.chatRail.maxWidth, Math.max(geometry.chatRail.minWidth, Math.round(width)))
    : geometry.chatRail.defaultWidth;
}

/** Prototype of the desktop catalog separator; identical shared bounds. */
export function ChatRailResizer({ width, onResize }: {
  width: number;
  onResize: (width: number) => void;
}) {
  const { t } = useT();
  const drag = useRef<{ x: number; width: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const finish = () => { drag.current = null; setDragging(false); };
  return (
    <div className="sk-chat-rail-resizer" role="separator"
      aria-label={t('rail.aria')} aria-orientation="vertical"
      aria-valuemin={geometry.chatRail.minWidth} aria-valuemax={geometry.chatRail.maxWidth}
      aria-valuenow={width} tabIndex={0} data-dragging={dragging ? 'true' : 'false'}
      onPointerDown={event => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { x: event.clientX, width };
        setDragging(true);
      }}
      onPointerMove={event => {
        if (drag.current) onResize(clampRailWidth(drag.current.width + event.clientX - drag.current.x));
      }}
      onPointerUp={finish} onPointerCancel={finish} onLostPointerCapture={finish}
      onDoubleClick={() => onResize(geometry.chatRail.defaultWidth)}
      onKeyDown={event => {
        const next = event.key === 'Home' ? geometry.chatRail.minWidth
          : event.key === 'End' ? geometry.chatRail.maxWidth
          : event.key === 'ArrowLeft' ? width - geometry.chatRail.keyboardStep
          : event.key === 'ArrowRight' ? width + geometry.chatRail.keyboardStep : null;
        if (next !== null) { event.preventDefault(); onResize(clampRailWidth(next)); }
      }}>
      <span className="sk-chat-rail-resizer-line" aria-hidden />
    </div>
  );
}
