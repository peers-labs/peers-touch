import { Segmented, theme } from 'antd';
import { Bot } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Navigation, Page } from '../../types/navigation';

interface AgentModuleNavProps {
  navigation: Navigation;
  page: Page;
}

export function AgentModuleNav({ navigation, page }: AgentModuleNavProps) {
  const { t } = useTranslation('agent');
  const { token } = theme.useToken();
  const inAgentModule = page === 'agent'
    || page === 'agent-profile';

  if (!inAgentModule) return null;

  return (
    <div
      data-pt-agent-module-nav
      style={{
        height: 42,
        display: 'flex',
        alignItems: 'center',
        flexShrink: 0,
        padding: '0 10px',
        borderBottom: `1px solid ${token.colorBorderSecondary}`,
        background: token.colorBgContainer,
      }}
    >
      <Segmented
        size="small"
        value="chat"
        options={[
          {
            value: 'chat',
            icon: <Bot size={14} />,
            label: <span data-pt-agent-module-item="chat">{t('agent.module.chat')}</span>,
          },
        ]}
        onChange={() => navigation.navigateTo('agent')}
      />
    </div>
  );
}
