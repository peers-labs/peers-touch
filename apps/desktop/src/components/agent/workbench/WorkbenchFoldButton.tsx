import { PanelRightClose } from 'lucide-react';
import { theme } from 'antd';
import { useTranslation } from 'react-i18next';

import { useWorkbenchTabsStore } from '../../../store/workbenchTabs';

// Panel-header hide control (Trae "Hide right panel"). When the panel is
// hidden the floating rail is the only way back; there is no fold button in
// the conversation header.
export function WorkbenchFoldButton({ blockSize = 28 }: { blockSize?: number }) {
  const { token } = theme.useToken();
  const { t } = useTranslation('chat');
  const closePanel = useWorkbenchTabsStore((s) => s.closePanel);

  return (
    <button
      type="button"
      data-pt-workbench-fold
      data-pt-workbench-open="true"
      aria-label={t('chat.workbench.hide')}
      title={t('chat.workbench.hide')}
      onClick={closePanel}
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
      <PanelRightClose size={16} strokeWidth={1.85} />
    </button>
  );
}
