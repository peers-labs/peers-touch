import { theme } from 'antd';
import {
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
} from 'lucide-react';
import type { CSSProperties } from 'react';

const TOGGLE_HOVER_BG = '#f3f1fb';
const TOGGLE_COLOR = '#595959';

const DOCK: Record<'left' | 'right', CSSProperties> = {
  left: {
    position: 'absolute',
    left: 10,
    bottom: 14,
    width: 28,
    height: 28,
    zIndex: 2,
  },
  right: {
    position: 'absolute',
    right: 10,
    top: 14,
    width: 28,
    height: 28,
    zIndex: 2,
  },
};

export function PanelToggleButton({
  side,
  open,
  title,
  onClick,
}: {
  side: 'left' | 'right';
  open: boolean;
  title?: string;
  onClick: () => void;
}) {
  const { token } = theme.useToken();
  const Icon =
    side === 'left'
      ? open ? PanelLeftClose : PanelLeftOpen
      : open ? PanelRightClose : PanelRightOpen;

  return (
    <button
      type="button"
      title={title ?? (open ? 'Collapse panel' : 'Expand panel')}
      onClick={onClick}
      style={{
        width: 28,
        height: 28,
        border: 0,
        borderRadius: 7,
        background: 'transparent',
        color: TOGGLE_COLOR,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
        flexShrink: 0,
        padding: 0,
      }}
      onMouseEnter={(event) => {
        event.currentTarget.style.background = TOGGLE_HOVER_BG;
        event.currentTarget.style.color = token.colorPrimary;
      }}
      onMouseLeave={(event) => {
        event.currentTarget.style.background = 'transparent';
        event.currentTarget.style.color = TOGGLE_COLOR;
      }}
    >
      <Icon size={15} strokeWidth={1.85} />
    </button>
  );
}

export function PanelToggleDock({
  side,
  open,
  title,
  onClick,
}: {
  side: 'left' | 'right';
  open: boolean;
  title?: string;
  onClick: () => void;
}) {
  return (
    <div style={DOCK[side]} data-panel-toggle-dock={side}>
      <PanelToggleButton side={side} open={open} title={title} onClick={onClick} />
    </div>
  );
}
