import { useMemo, useState, type ReactNode } from 'react';
import { Brain, Globe, PanelRightClose, PanelRightOpen, Plus, TerminalSquare } from 'lucide-react';
import { Dropdown, Input, theme } from 'antd';
import { useTranslation } from 'react-i18next';

import { useWorkbenchTabsStore, type WorkbenchToolId } from '../../../store/workbenchTabs';

interface ToolMeta {
  id: WorkbenchToolId;
  icon: ReactNode;
  labelKey: string;
  descKey: string;
}

export const WORKBENCH_TOOLS: ToolMeta[] = [
  {
    id: 'terminal',
    icon: <TerminalSquare size={14} />,
    labelKey: 'chat.workbench.tab.terminal',
    descKey: 'chat.workbench.desc.terminal',
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

// Shared searchable "+" entry used by the conversation header and the open
// panel header. Opening a tool is the only action; placement/tabs live in the
// workbench store.
export function WorkbenchAddMenu({ blockSize = 32 }: { blockSize?: number }) {
  const { token } = theme.useToken();
  const { t } = useTranslation('chat');
  const openTool = useWorkbenchTabsStore((state) => state.openTool);
  const tabs = useWorkbenchTabsStore((state) => state.tabs);
  const [menuOpen, setMenuOpen] = useState(false);
  const [query, setQuery] = useState('');

  const filteredTools = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return WORKBENCH_TOOLS;
    return WORKBENCH_TOOLS.filter(
      (tool) =>
        t(tool.labelKey).toLowerCase().includes(needle)
        || t(tool.descKey).toLowerCase().includes(needle),
    );
  }, [query, t]);

  const menu = (
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
            onMouseEnter={(event) => {
              event.currentTarget.style.background = token.colorFillQuaternary;
            }}
            onMouseLeave={(event) => {
              event.currentTarget.style.background = 'transparent';
            }}
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

  return (
    <Dropdown
      trigger={['click']}
      open={menuOpen}
      onOpenChange={setMenuOpen}
      dropdownRender={() => menu}
      placement="bottomRight"
    >
      <button
        type="button"
        data-pt-workbench-add-toggle
        data-pt-workbench-has-open-tab={tabs.length > 0 ? 'true' : 'false'}
        aria-label={t('chat.workbench.add')}
        title={t('chat.workbench.add')}
        style={{
          width: blockSize,
          height: blockSize,
          flexShrink: 0,
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
      >
        {tabs.length > 0
          ? <PanelRightClose size={16} strokeWidth={1.85} />
          : <PanelRightOpen size={16} strokeWidth={1.85} />}
      </button>
    </Dropdown>
  );
}
