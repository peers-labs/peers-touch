import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { theme } from 'antd';

interface PanelToggleDockProps {
  open: boolean;
  title: string;
  onClick: () => void;
}

export function PanelToggleDock({ open, title, onClick }: PanelToggleDockProps) {
  const { token } = theme.useToken();

  return (
    <div
      data-pt-panel-toggle-dock="left"
      style={{
        position: 'absolute',
        left: 10,
        bottom: 14,
        width: 28,
        height: 28,
        zIndex: 2,
      }}
    >
      <button
        type="button"
        aria-label={title}
        title={title}
        onClick={onClick}
        style={{
          width: 28,
          height: 28,
          border: 0,
          borderRadius: 7,
          background: 'transparent',
          color: token.colorTextSecondary,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          padding: 0,
        }}
      >
        {open ? (
          <PanelLeftClose size={15} strokeWidth={1.85} />
        ) : (
          <PanelLeftOpen size={15} strokeWidth={1.85} />
        )}
      </button>
    </div>
  );
}
