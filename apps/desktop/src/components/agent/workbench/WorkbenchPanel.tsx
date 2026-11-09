import { useMemo, useState, type ReactNode } from 'react';
import { Brain, Globe, Plus, TerminalSquare, X } from 'lucide-react';
import { Dropdown, Input, theme } from 'antd';
import { useTranslation } from 'react-i18next';

import { useWorkbenchTabsStore, type WorkbenchToolId } from '../../../store/workbenchTabs';
import { TerminalDock } from './terminal/TerminalDock';
import { BrowserDock } from './browser/BrowserDock';
import { MemoryReviewDock } from './memory/MemoryReviewDock';

const PANEL_WIDTH = 420;

interface ToolMeta {
  id: WorkbenchToolId;
  icon: ReactNode;
  labelKey: string;
  descKey: string;
  closeAttr?: string;
}

const TOOLS: ToolMeta[] = [
  {
    id: 'terminal',
    icon: <TerminalSquare size={14} />,
    labelKey: 'chat.workbench.tab.terminal',
    descKey: 'chat.workbench.desc.terminal',
    closeAttr: 'data-pt-terminal-close',
  },
  {
    id: 'browser',
    icon: <Globe size={14} />,
    labelKey: 'chat.workbench.tab.browser',
    descKey: 'chat.workbench.desc.browser',
  },
  {
    id: 'memory',
    icon: <Brain size={14} />,
    labelKey: 'chat.workbench.tab.memory',
    descKey: 'chat.workbench.desc.memory',
  },
];

// Trae-style unified right work area: device tools open as tabs in one
// full-height split panel instead of independent floating drawers. The "+"
// menu is searchable and lists every tool with an icon and description.
export function WorkbenchPanel() {
  const { token } = theme.useToken();
  const { t } = useTranslation('chat');
  const tabs = useWorkbenchTabsStore((s) => s.tabs);
  const active = useWorkbenchTabsStore((s) => s.active);
  const openTool = useWorkbenchTabsStore((s) => s.openTool);
  const closeTool = useWorkbenchTabsStore((s) => s.closeTool);
  const setActive = useWorkbenchTabsStore((s) => s.setActive);
  const [menuOpen, setMenuOpen] = useState(false);
  const [query, setQuery] = useState('');

  const metaById = useMemo(() => new Map(TOOLS.map((tool) => [tool.id, tool])), []);

  const filteredTools = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return TOOLS;
    return TOOLS.filter((tool) =>
      t(tool.labelKey).toLowerCase().includes(needle)
      || t(tool.descKey).toLowerCase().includes(needle),
    );
  }, [query, t]);

  const addMenu = (
    <div
      data-pt-workbench-add-menu
      style={{
        width: 300,
        background: token.colorBgElevated,
        borderRadius: 12,
        boxShadow: token.boxShadowSecondary,
        border: `1px solid ${token.colorBorderSecondary}`,
        padding: 8,
      }}
    >
      <Input
        autoFocus
        allowClear
        prefix={<Plus size={13} color={token.colorTextTertiary} />}
        placeholder={t('chat.workbench.searchPlaceholder')}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        style={{ marginBottom: 8 }}
      />
      <div role="list" style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {filteredTools.map((tool) => (
          <button
            key={tool.id}
            type="button"
            role="listitem"
            data-pt-workbench-add={tool.id}
            onClick={() => {
              openTool(tool.id);
              setMenuOpen(false);
              setQuery('');
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              width: '100%',
              textAlign: 'left',
              border: 'none',
              background: 'transparent',
              borderRadius: 8,
              padding: '8px 10px',
              cursor: 'pointer',
              color: token.colorText,
            }}
            onMouseEnter={(event) => { event.currentTarget.style.background = token.colorFillQuaternary; }}
            onMouseLeave={(event) => { event.currentTarget.style.background = 'transparent'; }}
          >
            <span
              style={{
                width: 28,
                height: 28,
                borderRadius: 8,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
                background: token.colorFillQuaternary,
                color: token.colorTextSecondary,
              }}
            >
              {tool.icon}
            </span>
            <span style={{ minWidth: 0 }}>
              <span style={{ display: 'block', fontSize: 13, fontWeight: 500 }}>
                {t(tool.labelKey)}
              </span>
              <span
                style={{
                  display: 'block',
                  fontSize: 11,
                  color: token.colorTextTertiary,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {t(tool.descKey)}
              </span>
            </span>
          </button>
        ))}
        {filteredTools.length === 0 && (
          <div style={{ padding: 12, fontSize: 12, color: token.colorTextTertiary }}>
            {t('chat.workbench.searchPlaceholder')}
          </div>
        )}
      </div>
    </div>
  );

  const addButton = (
    <Dropdown
      trigger={['click']}
      open={menuOpen}
      onOpenChange={setMenuOpen}
      dropdownRender={() => addMenu}
      placement="bottomRight"
    >
      <button
        type="button"
        data-pt-workbench-add-toggle
        aria-label={t('chat.workbench.add')}
        title={t('chat.workbench.add')}
        style={{
          width: 30,
          height: 30,
          flexShrink: 0,
          border: 'none',
          borderRadius: 8,
          background: 'transparent',
          color: token.colorTextSecondary,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
        }}
      >
        <Plus size={16} />
      </button>
    </Dropdown>
  );

  // Collapsed state: no tool tab open. Keep a slim permanent entry strip on
  // the right edge instead of putting tool shortcuts inside the composer.
  if (tabs.length === 0) {
    return (
      <aside
        data-pt-workbench-panel
        data-pt-workbench-collapsed
        style={{
          flex: '0 0 44px',
          width: 44,
          height: '100%',
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          paddingTop: 8,
          background: token.colorBgContainer,
          borderLeft: `1px solid ${token.colorBorderSecondary}`,
        }}
      >
        {addButton}
      </aside>
    );
  }

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
        {addButton}
      </header>

      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        {active ? (
          <>
            <TerminalDock />
            <BrowserDock />
            <MemoryReviewDock />
          </>
        ) : (
          <div
            data-pt-workbench-empty
            style={{
              margin: 'auto',
              padding: 24,
              textAlign: 'center',
              color: token.colorTextTertiary,
              fontSize: 13,
            }}
          >
            <strong style={{ display: 'block', color: token.colorText, marginBottom: 6 }}>
              {t('chat.workbench.empty.title')}
            </strong>
            {t('chat.workbench.empty.hint')}
          </div>
        )}
      </div>
    </aside>
  );
}
