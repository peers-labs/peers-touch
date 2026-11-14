import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  CHAT_RAIL_KEYBOARD_STEP,
  CHAT_RAIL_MAX_WIDTH,
  CHAT_RAIL_MIN_WIDTH,
  clampChatRailWidth,
} from './chatRailWidth';

interface ChatRailResizerProps {
  /** Current rail width in px, mirrored into aria-value* and drag math. */
  width: number;
  /** Live drag update; clamps but does not persist (commit happens on drop). */
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
  const dragState = useRef<{ startX: number; startWidth: number } | null>(null);

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    dragState.current = { startX: event.clientX, startWidth: width };
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
    if (!state) return;
    onPreview(state.startWidth + (event.clientX - state.startX));
  };

  const finishDrag = () => {
    if (!dragState.current) return;
    dragState.current = null;
    delete document.body.dataset.chatRailResizing;
    setDragging(false);
    onCommit(width);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      onCommit(width - CHAT_RAIL_KEYBOARD_STEP);
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      onCommit(width + CHAT_RAIL_KEYBOARD_STEP);
    } else if (event.key === 'Home') {
      event.preventDefault();
      onCommit(CHAT_RAIL_MIN_WIDTH);
    } else if (event.key === 'End') {
      event.preventDefault();
      onCommit(CHAT_RAIL_MAX_WIDTH);
    }
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={t('chat.rail.resize')}
      title={t('chat.rail.resize')}
      aria-valuenow={clampChatRailWidth(width)}
      aria-valuemin={CHAT_RAIL_MIN_WIDTH}
      aria-valuemax={CHAT_RAIL_MAX_WIDTH}
      tabIndex={0}
      className="sc-chat-rail-resizer"
      data-chat-rail-resize
      data-dragging={dragging ? 'true' : 'false'}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={finishDrag}
      onPointerCancel={finishDrag}
      onDoubleClick={onReset}
      onKeyDown={handleKeyDown}
    >
      <span className="sc-chat-rail-resizer__line" aria-hidden="true" />
    </div>
  );
}
