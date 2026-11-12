import { useRef, useState } from 'react';
import { theme } from 'antd';
import { useTranslation } from 'react-i18next';

import {
  DEFAULT_PANEL_WIDTH,
  useWorkbenchTabsStore,
} from '../../../store/workbenchTabs';

const PANEL_WIDTH_STORAGE_KEY = 'peers.workbench.panelWidth';

// Drag handle on the work area's left edge. Dragging left grows the panel;
// the chat column always keeps its minimum width (enforced by the store).
// Double-click restores the default width. The committed width survives
// restarts.
export function WorkbenchResizeHandle() {
  const { token } = theme.useToken();
  const { t } = useTranslation('chat');
  const setPanelWidth = useWorkbenchTabsStore((s) => s.setPanelWidth);
  const [dragging, setDragging] = useState(false);
  const dragState = useRef<{
    startX: number;
    startWidth: number;
    containerWidth: number;
  } | null>(null);

  const commitWidth = (width: number) => {
    window.localStorage.setItem(PANEL_WIDTH_STORAGE_KEY, String(Math.round(width)));
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const rail = event.currentTarget.closest('[data-pt-conversation-rail]');
    const panel = event.currentTarget.closest('[data-pt-workbench-panel]') as HTMLElement | null;
    if (!rail || !panel) return;
    event.preventDefault();
    // The rail contains only the chat wrapper and this panel; the agent/topic
    // rails are outer siblings, so its width is exactly the space shared by
    // chat + panel. The store clamp reserves the chat-column floor.
    const containerWidth = rail.getBoundingClientRect().width;
    dragState.current = {
      startX: event.clientX,
      startWidth: panel.getBoundingClientRect().width,
      containerWidth,
    };
    // Capture keeps move/up events flowing when the cursor leaves the thin
    // handle strip; guard for environments where the pointer id is inactive.
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Drag state already lives in the ref; capture is only an enhancement.
    }
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    setDragging(true);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const state = dragState.current;
    if (!state) return;
    // The handle is the panel's left edge: moving the pointer left widens it.
    const nextWidth = state.startWidth + (state.startX - event.clientX);
    setPanelWidth(nextWidth, state.containerWidth);
  };

  const handleDoubleClick = (event: React.MouseEvent<HTMLDivElement>) => {
    // Reset through the same clamp as dragging so the default can never clip
    // the chat column in a narrow rail.
    const rail = event.currentTarget.closest('[data-pt-conversation-rail]');
    if (!rail) return;
    setPanelWidth(DEFAULT_PANEL_WIDTH, rail.getBoundingClientRect().width);
    commitWidth(useWorkbenchTabsStore.getState().panelWidth);
  };

  const finishDrag = () => {
    if (!dragState.current) return;
    commitWidth(useWorkbenchTabsStore.getState().panelWidth);
    dragState.current = null;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    setDragging(false);
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={t('chat.workbench.resize')}
      title={t('chat.workbench.resize')}
      data-pt-workbench-resize
      data-pt-workbench-resizing={dragging ? 'true' : 'false'}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={finishDrag}
      onPointerCancel={finishDrag}
      onDoubleClick={handleDoubleClick}
      style={{
        position: 'absolute',
        top: 0,
        bottom: 0,
        left: -3,
        width: 7,
        zIndex: 30,
        cursor: 'col-resize',
        display: 'flex',
        alignItems: 'stretch',
        justifyContent: 'center',
        touchAction: 'none',
      }}
    >
      <div
        style={{
          width: dragging ? 2 : 1,
          background: dragging ? token.colorPrimary : 'transparent',
          transition: dragging ? 'none' : 'background 120ms',
        }}
        onMouseEnter={(event) => {
          if (!dragging) event.currentTarget.style.background = token.colorPrimaryBorderHover;
        }}
        onMouseLeave={(event) => {
          if (!dragging) event.currentTarget.style.background = 'transparent';
        }}
      />
    </div>
  );
}
