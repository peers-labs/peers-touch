import { useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';
import { theme, Empty, Switch } from 'antd';
import { Tag } from '@lobehub/ui';
import { Link2, Unplug, Settings2 } from 'lucide-react';
import { useAgentConnectorStore, type ConnectorInfo } from '../../store/agentConnectors';

interface AgentConnectorsPanelProps {
  agentId: string;
  onNavigateToSettings?: () => void;
}

function ConnectorStatusBadge({ status }: { status: ConnectorInfo['status'] }) {
  const { t } = useTranslation('agent');
  const { token } = theme.useToken();

  const config: Record<ConnectorInfo['status'], { color: string; label: string }> = {
    connected: { color: token.colorSuccess, label: t('agent.connectors.connected') },
    disconnected: { color: token.colorTextQuaternary, label: t('agent.connectors.disconnected') },
    expired: { color: token.colorWarning, label: t('agent.connectors.expired') },
  };

  const { color, label } = config[status];

  return (
    <Tag style={{ margin: 0, color, borderColor: color }}>
      {label}
    </Tag>
  );
}

function ConnectorRow({
  connector,
  bound,
  onToggle,
}: {
  connector: ConnectorInfo;
  bound: boolean;
  onToggle: (connectorId: string, checked: boolean) => void;
}) {
  const { token } = theme.useToken();

  return (
    <Flexbox
      horizontal
      align="center"
      gap={10}
      style={{
        minHeight: 44,
        padding: '8px 12px',
        borderRadius: 12,
        border: `1px solid ${token.colorBorderSecondary}`,
        background: token.colorBgContainer,
      }}
    >
      {connector.iconUrl ? (
        <img
          src={connector.iconUrl}
          alt=""
          style={{ width: 24, height: 24, borderRadius: 6, objectFit: 'cover' }}
        />
      ) : (
        <span
          style={{
            width: 24,
            height: 24,
            borderRadius: 6,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: connector.color || token.colorPrimaryBg,
            color: token.colorPrimary,
            fontSize: 12,
            fontWeight: 800,
          }}
        >
          <Link2 size={14} />
        </span>
      )}

      <Flexbox style={{ flex: 1, minWidth: 0 }} gap={2}>
        <span
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: token.colorText,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {connector.name}
        </span>
        {connector.scopes && connector.scopes.length > 0 && (
          <span
            style={{
              fontSize: 11,
              color: token.colorTextTertiary,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {connector.scopes.slice(0, 3).join(', ')}
            {connector.scopes.length > 3 ? '...' : ''}
          </span>
        )}
      </Flexbox>

      <ConnectorStatusBadge status={connector.status} />

      <Switch
        size="small"
        checked={bound}
        disabled={connector.status === 'disconnected'}
        onChange={(checked) => onToggle(connector.id, checked)}
      />
    </Flexbox>
  );
}

export function AgentConnectorsPanel({ agentId, onNavigateToSettings }: AgentConnectorsPanelProps) {
  const { t } = useTranslation('agent');
  const { token } = theme.useToken();

  const availableConnectors = useAgentConnectorStore((s) => s.availableConnectors);
  const loading = useAgentConnectorStore((s) => s.loading);
  const loadConnectors = useAgentConnectorStore((s) => s.loadConnectors);
  const bindConnector = useAgentConnectorStore((s) => s.bindConnector);
  const unbindConnector = useAgentConnectorStore((s) => s.unbindConnector);
  const isConnectorBound = useAgentConnectorStore((s) => s.isConnectorBound);

  useEffect(() => {
    void loadConnectors();
  }, [loadConnectors]);

  const handleToggle = useCallback(
    (connectorId: string, checked: boolean) => {
      if (checked) {
        bindConnector(agentId, connectorId);
      } else {
        unbindConnector(agentId, connectorId);
      }
    },
    [agentId, bindConnector, unbindConnector],
  );

  if (!loading && availableConnectors.length === 0) {
    return (
      <Flexbox align="center" gap={12} style={{ padding: '16px 0' }}>
        <Empty
          image={<Unplug size={36} color={token.colorTextQuaternary} />}
          description={t('agent.connectors.empty')}
        />
        {onNavigateToSettings && (
          <button
            type="button"
            onClick={onNavigateToSettings}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '6px 12px',
              borderRadius: 8,
              border: `1px solid ${token.colorBorder}`,
              background: token.colorBgContainer,
              color: token.colorPrimary,
              cursor: 'pointer',
              fontSize: 13,
              fontWeight: 500,
            }}
          >
            <Settings2 size={14} />
            {t('agent.connectors.configureInSettings')}
          </button>
        )}
      </Flexbox>
    );
  }

  return (
    <Flexbox gap={6} style={{ minHeight: 0, overflow: 'auto' }}>
      {availableConnectors.map((connector) => (
        <ConnectorRow
          key={connector.id}
          connector={connector}
          bound={isConnectorBound(agentId, connector.id)}
          onToggle={handleToggle}
        />
      ))}
    </Flexbox>
  );
}
