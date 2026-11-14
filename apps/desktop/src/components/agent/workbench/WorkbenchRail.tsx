import { IconButton } from '@peers-touch/ui';
import { useTranslation } from 'react-i18next';

import { useWorkbenchTabsStore } from '../../../store/workbenchTabs';
import { WORKBENCH_TOOLS } from './workbenchTools';

// Floating vertical quick-entry rail pinned to the vertical center of the
// conversation's right edge while the work area is hidden (Trae activity-bar
// behavior). Plain icons, no labels; each click opens the panel with that
// tool active. peers-ui IconButton owns the quiet hover treatment; geometry
// and the data-pt-workbench-rail contract live in workbench.css.
export function WorkbenchRail() {
  const { t } = useTranslation('chat');
  const openTool = useWorkbenchTabsStore((s) => s.openTool);

  return (
    <div className="wb-shell-rail" data-pt-workbench-rail aria-label={t('chat.workbench.add')}>
      {WORKBENCH_TOOLS.map((tool) => (
        <IconButton
          key={tool.id}
          actionId={`wb.rail.${tool.id}`}
          iconId={tool.iconId}
          iconSize={16}
          label={t(tool.labelKey)}
          emphasis="quiet"
          data-pt-workbench-rail-item={tool.id}
          onActivate={() => openTool(tool.id)}
        />
      ))}
    </div>
  );
}
