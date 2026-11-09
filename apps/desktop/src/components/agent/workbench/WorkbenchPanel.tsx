import { useMemo, type ReactNode } from 'react';
import { Brain, Globe, TerminalSquare, X } from 'lucide-react';
import { theme } from 'antd';
import { useTranslation } from 'react-i18next';

import { useWorkbenchTabsStore, type WorkbenchToolId } from '../../../store/workbenchTabs';
import { TerminalDock } from './terminal/TerminalDock';
import { BrowserDock } from './browser/BrowserDock';
import { MemoryReviewDock } from './memory/MemoryReviewDock';
import { WorkbenchAddMenu } from './WorkbenchAddMenu';

const PANEL_WIDTH = 420;

interface ToolMeta {
  id: WorkbenchToolId;
  icon: ReactNode;
  labelKey: string;
  closeAttr?: string;
}

const TOOLS: ToolMeta[] = [
  {
    id: 'terminal',
    icon: <TerminalSquare size={14} />,
    labelKey: 'chat.workbench.tab.terminal',
    closeAttr: 'data-pt-terminal-close',
  },
  {
    id: 'browser',
    icon: <Globe size={14} />,
    labelKey: 'chat.workbench.tab.browser',
  },
  {
    id: 'memory',
    icon: <Brain size={14} />,
    labelKey: 'chat.workbench.tab.memory',
  },
];

// Trae-style unified right work area: device tools open as tabs in one
// full-height split panel instead of independent floating drawers. With no
// tab open the panel renders nothing — its entry is the panel switch in the
// conversation header (WorkbenchAddMenu).
export function WorkbenchPanel() {
  const { token } = theme.useToken();
  const { t } = useTranslation('chat');
  const tabs = useWorkbenchTabsStore((s) => s.tabs);
  const active = useWorkbenchTabsStore((s) => s.active);
  const closeTool = useWorkbenchTabsStore((s) => s.closeTool);
  const setActive = useWorkbenchTabsStore((s) => s.setActive);

  const metaById = useMemo(() => new Map(TOOLS.map((tool) => [tool.id, tool])), []);

  if (tabs.length === 0) return null;

  return (
    <aside
      data-pt-workbench-panel
      style={{
        // Keep the preferred 420px split but yield space when the artifact
        // PortalPanel is also open: a rigid 0 0 420 item pushed the portal
        // past the viewport and collapsed the chat frame to zero width on
        // smaller windows.
        flex: '0 1 420px',
        width: PANEL_WIDTH,
        minWidth: 320,
        maxWidth: '92%',
        height: '100%',
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        background: token.colorBgContainer,
        borderLeft: `1px solid ${token.colorBorderSecondary}`,
      }}
    >
      <header
        style={{
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '8px 10px',
          borderBottom: `1px solid ${token.colorBorderSecondary}`,
          overflowX: 'auto',
        }}
      >
        {tabs.map((toolId) => {
          const meta = metaById.get(toolId);
          if (!meta) return null;
          const isActive = active === toolId;
          return (
            <div
              key={toolId}
              data-pt-workbench-tab={toolId}
              onClick={() => setActive(toolId)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                height: 30,
                padding: '0 6px 0 10px',
                borderRadius: 8,
                flexShrink: 0,
                cursor: 'pointer',
                fontSize: 12,
                fontWeight: isActive ? 600 : 400,
                color: isActive ? token.colorPrimaryText : token.colorTextSecondary,
                background: isActive ? token.colorPrimaryBg : 'transparent',
              }}
            >
              {meta.icon}
              <span>{t(meta.labelKey)}</span>
              <button
                type="button"
                {...(meta.closeAttr ? { [meta.closeAttr]: '' } : {})}
                data-pt-workbench-close={toolId}
                aria-label={`${t(meta.labelKey)} ×`}
                onClick={(event) => {
                  event.stopPropagation();
                  closeTool(toolId);
                }}
                style={{
                  width: 18,
                  height: 18,
                  border: 'none',
                  borderRadius: 5,
                  background: 'transparent',
                  color: 'inherit',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  padding: 0,
                }}
              >
                <X size={12} />
              </button>
            </div>
          );
        })}
        <div style={{ flex: 1 }} />
        <WorkbenchAddMenu blockSize={30} />
      </header>

      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        {active ? (
          <>
            <TerminalDock />
            <BrowserDock />
            <MemoryReviewDock />
          </>
        ) : null}
      </div>
    </aside>
  );
}
