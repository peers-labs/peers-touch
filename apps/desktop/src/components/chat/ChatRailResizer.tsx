import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { normalizeChatRailWidth, resizeChatRailWidth, type ChatRailResizeDirection } from '@peers-touch/ui';
import { WindowDragRegion } from '../shell/WindowDragRegion';

import {
  CHAT_RAIL_KEYBOARD_STEP,
  CHAT_RAIL_MAX_WIDTH,
  CHAT_RAIL_MIN_WIDTH,
} from './chatRailWidth';

interface ChatRailResizerProps {
  /** Current rail width in px, mirrored into aria-value* and drag math. */
  width: number;
  /** Live stable-width update; persistence happens on drop. */
  onPreview: (width: number) => void;
  /** Commits a width on pointer drop / keyboard action. */
  onCommit: (width: number) => void;
  /** Double-click restore of the default 300px rail. */
  onReset: () => void;
}

// Manual drag handle on the catalog rail's right edge (wide surfaces only;
// the 720px single-pane swap hides it in CSS). Pointer capture keeps the
// drag alive when the cursor leaves the thin strip, and double-click resets.
export function ChatRailResizer({
  width,
  onPreview,
  onCommit,
  onReset,
}: ChatRailResizerProps) {
  const { t } = useTranslation('chat');
  const [dragging, setDragging] = useState(false);
  const dragState = useRef<{
    pointerId: number;
    startX: number;
    lastX: number;
    startWidth: number;
    width: number;
    direction: ChatRailResizeDirection;
  } | null>(null);

  useEffect(() => () => {
    if (dragState.current) delete document.body.dataset.chatRailResizing;
  }, []);

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || dragState.current) return;
    event.preventDefault();
    const startWidth = normalizeChatRailWidth(width);
    dragState.current = {
      pointerId: event.pointerId, startX: event.clientX, lastX: event.clientX,
      startWidth, width: startWidth, direction: 0,
    };
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Drag state already lives in the ref; capture is only an enhancement.
    }
    document.body.dataset.chatRailResizing = 'true';
    setDragging(true);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const state = dragState.current;
    if (!state || state.pointerId !== event.pointerId) return;
    if (event.clientX !== state.lastX) {
      state.direction = event.clientX < state.lastX ? -1 : 1;
      state.lastX = event.clientX;
    }
    state.width = resizeChatRailWidth(
      state.startWidth + (event.clientX - state.startX), state.direction,
    );
    onPreview(state.width);
  };

  const finishDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    const state = dragState.current;
    if (!state || state.pointerId !== event.pointerId) return;
    const committedWidth = state.width;
    dragState.current = null;
    delete document.body.dataset.chatRailResizing;
    setDragging(false);
    onCommit(committedWidth);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      onCommit(resizeChatRailWidth(width - CHAT_RAIL_KEYBOARD_STEP, -1));
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      onCommit(resizeChatRailWidth(width + CHAT_RAIL_KEYBOARD_STEP, 1));
    } else if (event.key === 'Home') {
      event.preventDefault();
      onCommit(CHAT_RAIL_MIN_WIDTH);
    } else if (event.key === 'End') {
      event.preventDefault();
      onCommit(CHAT_RAIL_MAX_WIDTH);
    }
  };

  return (
    <WindowDragRegion mode="none"><div
      role="separator"
      aria-orientation="vertical"
      aria-label={t('chat.rail.resize')}
      title={t('chat.rail.resize')}
      aria-valuenow={normalizeChatRailWidth(width)}
      aria-valuemin={CHAT_RAIL_MIN_WIDTH}
      aria-valuemax={CHAT_RAIL_MAX_WIDTH}
      tabIndex={0}
      className="sc-chat-rail-resizer"
      data-chat-rail-resize
      data-dragging={dragging ? 'true' : 'false'}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={event => { handlePointerMove(event); finishDrag(event); }}
      onPointerCancel={finishDrag}
      onLostPointerCapture={finishDrag}
      onDoubleClick={onReset}
      onKeyDown={handleKeyDown}
    >
      <span className="sc-chat-rail-resizer__line" aria-hidden="true" />
    </div></WindowDragRegion>
  );
}
