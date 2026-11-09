import { theme } from 'antd';
import { useTranslation } from 'react-i18next';

import { useWorkbenchTabsStore } from '../../../store/workbenchTabs';
import { WORKBENCH_TOOLS } from './workbenchTools';

// Floating vertical quick-entry rail pinned to the vertical center of the
// conversation's right edge while the work area is hidden (Trae activity-bar
// behavior). Plain icons, no labels; each click opens the panel with that
// tool active.
export function WorkbenchRail() {
  const { token } = theme.useToken();
  const { t } = useTranslation('chat');
  const openTool = useWorkbenchTabsStore((s) => s.openTool);

  return (
    <div
      data-pt-workbench-rail
      style={{
        position: 'absolute',
        top: '50%',
        right: 8,
        transform: 'translateY(-50%)',
        zIndex: 20,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 2,
        padding: '6px 4px',
        borderRadius: 12,
        background: token.colorBgContainer,
        border: `1px solid ${token.colorBorderSecondary}`,
        boxShadow: token.boxShadowTertiary,
      }}
    >
      {WORKBENCH_TOOLS.map((tool) => (
        <button
          key={tool.id}
          type="button"
          data-pt-workbench-rail-item={tool.id}
          aria-label={t(tool.labelKey)}
          title={t(tool.labelKey)}
          onClick={() => openTool(tool.id)}
          style={{
            width: 30,
            height: 30,
            border: 'none',
            borderRadius: 8,
            background: 'transparent',
            color: token.colorTextSecondary,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            padding: 0,
          }}
          onMouseEnter={(event) => {
            event.currentTarget.style.background = token.colorFillQuaternary;
            event.currentTarget.style.color = token.colorText;
          }}
          onMouseLeave={(event) => {
            event.currentTarget.style.background = 'transparent';
            event.currentTarget.style.color = token.colorTextSecondary;
          }}
        >
          {tool.icon}
        </button>
      ))}
    </div>
  );
}
