// Agent card for the marketplace grid.

import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';
import { Avatar } from '@lobehub/ui';
import { Button, Tag, theme } from 'antd';
import { Copy } from 'lucide-react';

import type { Agent } from '../../services/desktop_api';

interface AgentCardProps {
  agent: Agent;
  onClone: (agent: Agent) => void;
}

export const MarketplaceAgentCard = memo<AgentCardProps>(({ agent, onClone }) => {
  const { t } = useTranslation('agent');
  const { token } = theme.useToken();

  return (
    <Flexbox
      gap={token.marginSM}
      padding={token.paddingMD}
      style={{
        width: 280,
        borderRadius: token.borderRadiusLG,
        border: `1px solid ${token.colorBorderSecondary}`,
        background: token.colorBgContainer,
        cursor: 'pointer',
        transition: 'box-shadow 0.2s',
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLDivElement).style.boxShadow = token.boxShadowSecondary;
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLDivElement).style.boxShadow = 'none';
      }}
    >
      <Flexbox horizontal gap={token.marginSM} align="center">
        <Avatar
          avatar={agent.avatar}
          background={agent.backgroundColor || token.colorPrimaryBg}
          size={40}
          title={agent.title}
        />
        <Flexbox style={{ flex: 1, minWidth: 0 }}>
          <span
            style={{
              fontWeight: token.fontWeightStrong,
              fontSize: token.fontSize,
              color: token.colorText,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {agent.title}
          </span>
          {agent.tags && (
            <Flexbox horizontal gap={4} style={{ marginTop: 2 }}>
              {agent.tags
                .split(',')
                .slice(0, 2)
                .map((tag) => (
                  <Tag key={tag} style={{ fontSize: 10, lineHeight: '16px', margin: 0 }}>
                    {tag.trim()}
                  </Tag>
                ))}
            </Flexbox>
          )}
        </Flexbox>
      </Flexbox>

      <span
        style={{
          fontSize: token.fontSizeSM,
          color: token.colorTextSecondary,
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
          minHeight: 36,
        }}
      >
        {agent.description || t('agent.marketplace.noDescription')}
      </span>

      <Button
        size="small"
        icon={<Copy size={12} />}
        onClick={(e) => {
          e.stopPropagation();
          onClone(agent);
        }}
      >
        {t('agent.marketplace.clone')}
      </Button>
    </Flexbox>
  );
});

MarketplaceAgentCard.displayName = 'MarketplaceAgentCard';
