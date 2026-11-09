import { useMemo, useState } from 'react';
import { Plus, Search } from 'lucide-react';
import { Dropdown, Input, theme } from 'antd';
import { useTranslation } from 'react-i18next';

import { useWorkbenchTabsStore } from '../../../store/workbenchTabs';
import { WORKBENCH_TOOLS } from './workbenchTools';

// Compact "+" menu shown inside an open work area (tab strip / launcher
// header): search box + icon/name rows, no descriptions. Mirrors Trae's
// add menu once a tab already exists.
export function WorkbenchAddMenu({ blockSize = 30 }: { blockSize?: number }) {
  const { token } = theme.useToken();
  const { t } = useTranslation('chat');
  const openTool = useWorkbenchTabsStore((state) => state.openTool);
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
        width: 264,
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
        prefix={<Search size={13} color={token.colorTextTertiary} />}
        placeholder={t('chat.workbench.searchPlaceholder')}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        variant="borderless"
        style={{ marginBottom: 4 }}
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
              fontSize: 13,
            }}
            onMouseEnter={(event) => {
              event.currentTarget.style.background = token.colorFillQuaternary;
            }}
            onMouseLeave={(event) => {
              event.currentTarget.style.background = 'transparent';
            }}
          >
            <span style={{ color: token.colorTextSecondary, display: 'inline-flex' }}>
              {tool.icon}
            </span>
            {t(tool.labelKey)}
          </button>
        ))}
        {filteredTools.length === 0 && (
          <div style={{ padding: 12, fontSize: 12, color: token.colorTextTertiary }}>
            {t('chat.workbench.searchEmpty')}
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
      placement="bottomLeft"
    >
      <button
        type="button"
        data-pt-workbench-add-toggle
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
        <Plus size={17} strokeWidth={1.85} />
      </button>
    </Dropdown>
  );
}
