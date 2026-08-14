// MCP server card for the marketplace grid.

import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';
import { Avatar } from '@lobehub/ui';
import { Tag, theme } from 'antd';
import { Server } from 'lucide-react';

import type { MCPServerItem } from '../../services/desktop_api';

interface MCPCardProps {
  server: MCPServerItem;
}

export const MarketplaceMCPCard = memo<MCPCardProps>(({ server }) => {
  const { t } = useTranslation('agent');
  const { token } = theme.useToken();

  const statusColor =
    server.status === 'connected'
      ? 'success'
      : server.status === 'failed'
        ? 'error'
        : 'default';

  return (
    <Flexbox
      gap={token.marginSM}
      padding={token.paddingMD}
      style={{
        width: 280,
        borderRadius: token.borderRadiusLG,
        border: `1px solid ${token.colorBorderSecondary}`,
        background: token.colorBgContainer,
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
          avatar={server.metaAvatar || <Server size={20} />}
          size={36}
          title={server.title || server.name}
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
            {server.title || server.name}
          </span>
          <Flexbox horizontal gap={4}>
            <Tag style={{ fontSize: 10, lineHeight: '16px', margin: 0 }}>{server.type}</Tag>
            <Tag color={statusColor} style={{ fontSize: 10, lineHeight: '16px', margin: 0 }}>
              {server.status || 'unknown'}
            </Tag>
          </Flexbox>
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
        {server.description || t('agent.marketplace.noDescription')}
      </span>

      <Flexbox horizontal gap={4} align="center" justify="space-between">
        <span style={{ fontSize: token.fontSizeSM, color: token.colorTextTertiary }}>
          {t('agent.marketplace.toolCount', { count: server.toolCount })}
        </span>
        <Tag color={server.enabled ? 'green' : undefined} style={{ margin: 0 }}>
          {server.enabled ? t('agent.marketplace.enabled') : t('agent.marketplace.disabled')}
        </Tag>
      </Flexbox>
    </Flexbox>
  );
});

MarketplaceMCPCard.displayName = 'MarketplaceMCPCard';
