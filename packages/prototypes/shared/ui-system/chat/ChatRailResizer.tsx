import { useRef, useState } from 'react';
import { geometry, normalizeChatRailWidth, resizeChatRailWidth, type ChatRailResizeDirection } from '@peers-touch/ui';
import { useT } from '../prefs';

/** Prototype of the desktop separator; identical shared snapping policy. */
export function ChatRailResizer({ width, onResize }: {
  width: number;
  onResize: (width: number) => void;
}) {
  const { t } = useT();
  const drag = useRef<{
    pointerId: number; x: number; lastX: number; width: number; direction: ChatRailResizeDirection;
  } | null>(null);
  const [dragging, setDragging] = useState(false);
  const move = (event: React.PointerEvent<HTMLDivElement>) => {
    const state = drag.current;
    if (!state || state.pointerId !== event.pointerId) return;
    if (event.clientX !== state.lastX) {
      state.direction = event.clientX < state.lastX ? -1 : 1;
      state.lastX = event.clientX;
    }
    onResize(resizeChatRailWidth(state.width + event.clientX - state.x, state.direction));
  };
  const finish = (event: React.PointerEvent<HTMLDivElement>) => {
    if (drag.current?.pointerId !== event.pointerId) return;
    drag.current = null;
    setDragging(false);
  };
  return (
    <div className="sk-chat-rail-resizer" role="separator"
      aria-label={t('rail.aria')} aria-orientation="vertical"
      aria-valuemin={geometry.chatRail.minWidth} aria-valuemax={geometry.chatRail.maxWidth}
      aria-valuenow={normalizeChatRailWidth(width)} tabIndex={0} data-dragging={dragging ? 'true' : 'false'}
      onPointerDown={event => {
        if (event.button !== 0 || drag.current) return;
        event.preventDefault();
        drag.current = {
          pointerId: event.pointerId, x: event.clientX, lastX: event.clientX,
          width: normalizeChatRailWidth(width), direction: 0,
        };
        try {
          event.currentTarget.setPointerCapture(event.pointerId);
        } catch {
          // The ref still owns the drag when capture is unavailable.
        }
        setDragging(true);
      }}
      onPointerMove={move}
      onPointerUp={event => { move(event); finish(event); }}
      onPointerCancel={finish} onLostPointerCapture={finish}
      onDoubleClick={() => onResize(geometry.chatRail.defaultWidth)}
      onKeyDown={event => {
        const next = event.key === 'Home' ? geometry.chatRail.minWidth
          : event.key === 'End' ? geometry.chatRail.maxWidth
          : event.key === 'ArrowLeft' ? width - geometry.chatRail.keyboardStep
          : event.key === 'ArrowRight' ? width + geometry.chatRail.keyboardStep : null;
        if (next !== null) {
          event.preventDefault();
          onResize(resizeChatRailWidth(next, event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0));
        }
      }}>
      <span className="sk-chat-rail-resizer-line" aria-hidden />
    </div>
  );
}
