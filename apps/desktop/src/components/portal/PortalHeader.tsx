import { Flexbox } from 'react-layout-kit';
import { ActionIcon } from '@lobehub/ui';
import { X } from 'lucide-react';
import { theme } from 'antd';

import { usePortalStore, type PortalView } from '../../store/portal';

interface PortalHeaderProps {
  activeView: PortalView | null;
}

function viewTitle(view: PortalView | null): string {
  if (!view || view.type === 'artifacts') return 'Artifacts';
  if (view.type === 'artifactDetail') return view.artifact.title || 'Artifact';
  if (view.type === 'toolDetail') return 'Tool Detail';
  return 'Portal';
}

export function PortalHeader({ activeView }: PortalHeaderProps) {
  const { token } = theme.useToken();

  return (
    <Flexbox
      horizontal
      align="center"
      justify="space-between"
      style={{
        height: 44,
        padding: '0 12px',
        borderBottom: `1px solid ${token.colorBorderSecondary}`,
        flexShrink: 0,
      }}
    >
      <span style={{ fontSize: 14, fontWeight: 500, color: token.colorText }}>
        {viewTitle(activeView)}
      </span>
      <ActionIcon
        icon={X}
        size="small"
        onClick={() => usePortalStore.getState().close()}
      />
    </Flexbox>
  );
}
