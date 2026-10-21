import { Segmented, theme } from 'antd';
import { Bot, Zap } from 'lucide-react';
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
    || page === 'agent-profile'
    || page === 'agent-orchestration'
    || page === 'applet:peers.atelier';

  if (!inAgentModule) return null;

  const activeSurface = page === 'applet:peers.atelier' || page === 'agent-orchestration'
    ? 'atelier'
    : 'chat';

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
        value={activeSurface}
        options={[
          {
            value: 'chat',
            icon: <Bot size={14} />,
            label: <span data-pt-agent-module-item="chat">{t('agent.module.chat')}</span>,
          },
          {
            value: 'atelier',
            icon: <Zap size={14} />,
            label: <span data-pt-agent-module-item="atelier">{t('agent.module.atelier')}</span>,
          },
        ]}
        onChange={(value) => {
          navigation.navigateTo(value === 'atelier' ? 'applet:peers.atelier' : 'agent');
        }}
      />
    </div>
  );
}
