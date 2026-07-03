import {
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
} from 'lucide-react';

const D = {
  textSecondary: '#595959',
  fillHover: '#f3f1fb',
  primary: '#6b5bd6',
} as const;

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
  const Icon =
    side === 'left'
      ? open ? PanelLeftClose : PanelLeftOpen
      : open ? PanelRightClose : PanelRightOpen;

  return (
    <button
      title={title ?? (open ? '折叠面板' : '展开面板')}
      onClick={onClick}
      style={{
        width: 28,
        height: 28,
        border: 0,
        borderRadius: 7,
        background: 'transparent',
        color: D.textSecondary,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
        flexShrink: 0,
      }}
      onMouseEnter={(event) => {
        event.currentTarget.style.background = D.fillHover;
        event.currentTarget.style.color = D.primary;
      }}
      onMouseLeave={(event) => {
        event.currentTarget.style.background = 'transparent';
        event.currentTarget.style.color = D.textSecondary;
      }}
    >
      <Icon size={15} strokeWidth={1.85} />
    </button>
  );
}
