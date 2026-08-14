import { theme } from 'antd';
import { ActionIcon } from '@lobehub/ui';
import { Terminal } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useChatTerminalStore } from '../../store/chatTerminal';

export function TerminalToggleButton() {
  const { t } = useTranslation('agent');
  const { token } = theme.useToken();
  const visible = useChatTerminalStore((s) => s.visible);
  const toggle = useChatTerminalStore((s) => s.toggle);

  return (
    <ActionIcon
      icon={Terminal}
      onClick={toggle}
      size="small"
      title={t('agent.terminal.title')}
      style={{
        color: visible ? token.colorPrimary : token.colorTextTertiary,
        background: visible ? token.colorPrimaryBg : 'transparent',
        borderRadius: 6,
        transition: 'all 0.15s',
      }}
    />
  );
}
