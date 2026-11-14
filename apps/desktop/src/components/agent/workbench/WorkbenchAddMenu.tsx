import { useMemo, useState } from 'react';
import { Button, Icon, IconButton, Popover, TextField } from '@peers-touch/ui';
import { useTranslation } from 'react-i18next';

import { useWorkbenchTabsStore } from '../../../store/workbenchTabs';
import { WORKBENCH_TOOLS } from './workbenchTools';

// Compact "+" menu shown inside an open work area (tab strip / launcher
// header): search box + icon/name rows, no descriptions. Mirrors Trae's
// add menu once a tab already exists. State stays local; the real store is
// only touched when a tool is opened.
export function WorkbenchAddMenu({ blockSize = 30 }: { blockSize?: number }) {
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
    <div className="wb-shell-addmenu" data-pt-workbench-add-menu>
      <TextField
        autoFocus
        clearable
        value={query}
        aria-label={t('chat.workbench.searchPlaceholder')}
        placeholder={t('chat.workbench.searchPlaceholder')}
        onClear={() => setQuery('')}
        onValueChange={setQuery}
      />
      <div role="list" className="wb-shell-addmenu__list">
        {filteredTools.map((tool) => (
          <Button
            key={tool.id}
            actionId={`wb.add.${tool.id}`}
            emphasis="quiet"
            fullWidth
            label={t(tool.labelKey)}
            leading={<Icon iconId={tool.iconId} size={14} />}
            data-pt-workbench-add={tool.id}
            onActivate={() => {
              openTool(tool.id);
              setMenuOpen(false);
              setQuery('');
            }}
          />
        ))}
        {filteredTools.length === 0 && (
          <span className="wb-shell-addmenu__empty">{t('chat.workbench.searchEmpty')}</span>
        )}
      </div>
    </div>
  );

  return (
    <Popover
      open={menuOpen}
      onOpenChange={setMenuOpen}
      placement="bottom"
      label={t('chat.workbench.add')}
      content={menu}
    >
      <IconButton
        actionId="wb.add-toggle"
        iconId="plus"
        iconSize={17}
        label={t('chat.workbench.add')}
        emphasis="quiet"
        data-pt-workbench-add-toggle
        style={{ width: blockSize, height: blockSize, flexShrink: 0 }}
      />
    </Popover>
  );
}
