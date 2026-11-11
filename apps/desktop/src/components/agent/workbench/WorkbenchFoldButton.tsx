import { IconButton } from '@peers-touch/ui';
import { useTranslation } from 'react-i18next';

import { useWorkbenchTabsStore } from '../../../store/workbenchTabs';

// Panel-header hide control (Trae "Hide right panel"). When the panel is
// hidden the floating rail is the only way back; there is no fold button in
// the conversation header.
//
// Migrated from a raw lucide <button> + antd theme token to a peers-ui
// IconButton. The store action, i18n label and data-* contract are unchanged;
// only the view primitive and its hand-rolled styling are replaced.
export function WorkbenchFoldButton({ blockSize = 28 }: { blockSize?: number }) {
  const { t } = useTranslation('chat');
  const closePanel = useWorkbenchTabsStore((s) => s.closePanel);

  return (
    <IconButton
      actionId="agent.workbench.fold"
      iconId="panel-right-close"
      iconSize={16}
      label={t('chat.workbench.hide')}
      emphasis="quiet"
      density="compact"
      data-pt-workbench-fold
      data-pt-workbench-open="true"
      style={{ width: blockSize, height: blockSize }}
      onActivate={closePanel}
    />
  );
}
