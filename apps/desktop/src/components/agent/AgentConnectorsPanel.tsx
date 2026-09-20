import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';
import { App, theme, Empty, Switch } from 'antd';
import { Button, Tag } from '@lobehub/ui';
import { Link2, Unplug, Settings2 } from 'lucide-react';
import { useAgentConnectorStore, type ConnectorInfo } from '../../store/agentConnectors';
import {
  selectAgentCapabilityBindingsBySource,
  selectAgentCapabilityReadinessBySource,
  selectCapabilityManifestsBySource,
  useAgentCapabilityStore,
  type AgentCapabilityState,
} from '../../store/agentCapabilities';
import {
  CapabilityReadinessState,
  CapabilitySourceKind,
  type AgentCapabilityBinding,
  type CapabilityManifest,
  type CapabilityReadiness,
} from '../../gen/proto/domain/agent/capability_pb';

interface AgentConnectorsPanelProps {
  agentId: string;
  onNavigateToSettings?: () => void;
}

interface ConnectorCapabilityProjection {
  manifests: CapabilityManifest[];
  bindings: AgentCapabilityBinding[];
  readiness: CapabilityReadiness[];
}

const EMPTY_CONNECTOR_BINDINGS: AgentCapabilityBinding[] = [];

function createConnectorCapabilitySelector(agentId: string) {
  let manifestsReference: CapabilityManifest[] | undefined;
  let bindingsReference: AgentCapabilityBinding[] | undefined;
  let readinessReference: ReturnType<typeof useAgentCapabilityStore.getState>['readinessByAgentId'][string];
  let projection: ConnectorCapabilityProjection | undefined;

  return (state: AgentCapabilityState): ConnectorCapabilityProjection => {
    const bindings = state.bindingsByAgentId[agentId] ?? EMPTY_CONNECTOR_BINDINGS;
    const readiness = state.readinessByAgentId[agentId];
    if (
      projection
      && manifestsReference === state.manifests
      && bindingsReference === bindings
      && readinessReference === readiness
    ) {
      return projection;
    }
    manifestsReference = state.manifests;
    bindingsReference = bindings;
    readinessReference = readiness;
    projection = {
      manifests: selectCapabilityManifestsBySource(
        state,
        CapabilitySourceKind.CONNECTOR,
      ),
      bindings: selectAgentCapabilityBindingsBySource(
        state,
        agentId,
        CapabilitySourceKind.CONNECTOR,
      ),
      readiness: selectAgentCapabilityReadinessBySource(
        state,
        agentId,
        CapabilitySourceKind.CONNECTOR,
      ),
    };
    return projection;
  };
}

function connectorBindingReadiness(
  bindings: AgentCapabilityBinding[],
  readiness: CapabilityReadiness[],
): CapabilityReadinessState {
  const states = bindings.map((binding) => readiness.find(
    (item) =>
      item.bindingId === binding.bindingId
      && item.bindingRevision === binding.revision,
  )?.state ?? CapabilityReadinessState.UNKNOWN);
  if (states.some((state) =>
    state === CapabilityReadinessState.UNAVAILABLE
    || state === CapabilityReadinessState.BLOCKED)) {
    return CapabilityReadinessState.UNAVAILABLE;
  }
  if (states.some((state) =>
    state === CapabilityReadinessState.UNKNOWN
    || state === CapabilityReadinessState.UNSPECIFIED)) {
    return CapabilityReadinessState.UNKNOWN;
  }
  if (states.some((state) => state === CapabilityReadinessState.DEGRADED)) {
    return CapabilityReadinessState.DEGRADED;
  }
  return CapabilityReadinessState.READY;
}

function ConnectorStatusBadge({ status }: { status: ConnectorInfo['status'] }) {
  const { t } = useTranslation('agent');
  const { token } = theme.useToken();

  const config: Record<ConnectorInfo['status'], { color: string; label: string }> = {
    connected: { color: token.colorSuccess, label: t('agent.connectors.connected') },
    disconnected: { color: token.colorTextQuaternary, label: t('agent.connectors.disconnected') },
    expired: { color: token.colorWarning, label: t('agent.connectors.expired') },
    revoked: { color: token.colorError, label: t('agent.connectors.revoked') },
    revocation_unconfirmed: {
      color: token.colorWarning,
      label: t('agent.connectors.revocationUnconfirmed'),
    },
  };

  const { color, label } = config[status];

  return (
    <Tag style={{ margin: 0, color, borderColor: color }}>
      {label}
    </Tag>
  );
}

function ConnectorReadinessBadge({
  state,
}: {
  state: CapabilityReadinessState;
}) {
  const { t } = useTranslation('agent');
  if (state === CapabilityReadinessState.READY) {
    return <Tag color="success" style={{ margin: 0 }}>{t('agent.profile.enabled')}</Tag>;
  }
  if (state === CapabilityReadinessState.DEGRADED) {
    return <Tag color="warning" style={{ margin: 0 }}>{t('agent.profile.degradation.partial')}</Tag>;
  }
  if (
    state === CapabilityReadinessState.UNAVAILABLE
    || state === CapabilityReadinessState.BLOCKED
  ) {
    return <Tag color="error" style={{ margin: 0 }}>{t('agent.profile.degradation.unavailable')}</Tag>;
  }
  return <Tag style={{ margin: 0 }}>{t('agent.profile.unknown')}</Tag>;
}

function ConnectorRow({
  connector,
  bound,
  readiness,
  bindingAvailable,
  pending,
  onToggle,
  onConnect,
}: {
  connector: ConnectorInfo;
  bound: boolean;
  readiness?: CapabilityReadinessState;
  bindingAvailable: boolean;
  pending: boolean;
  onToggle: (connectorId: string, checked: boolean) => void;
  onConnect: (connectorId: string) => void;
}) {
  const { t } = useTranslation('agent');
  const { token } = theme.useToken();

  return (
    <Flexbox
      data-pt-agent-connector={connector.id}
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
      {bound && readiness !== undefined && (
        <ConnectorReadinessBadge state={readiness} />
      )}

      {connector.status !== 'connected' ? (
        <Button
          data-pt-agent-connector-connect={connector.id}
          loading={pending}
          size="small"
          onClick={() => onConnect(connector.id)}
        >
          {t('agent.connectors.connect')}
        </Button>
      ) : (
        <Flexbox horizontal align="center" gap={6}>
          <Switch
            data-pt-agent-connector-toggle={connector.id}
            checked={bound}
            disabled={pending || !bindingAvailable}
            loading={pending}
            size="small"
            onChange={(checked) => onToggle(connector.id, checked)}
          />
        </Flexbox>
      )}
    </Flexbox>
  );
}

export function AgentConnectorsPanel({ agentId, onNavigateToSettings }: AgentConnectorsPanelProps) {
  const { t } = useTranslation('agent');
  const { token } = theme.useToken();
  const { message } = App.useApp();
  const [pendingConnectorId, setPendingConnectorId] = useState<string | null>(null);

  const availableConnectors = useAgentConnectorStore((s) => s.availableConnectors);
  const resourceManifests = useAgentConnectorStore((s) => s.resourceManifests);
  const loading = useAgentConnectorStore((s) => s.loading);
  const connectConnector = useAgentConnectorStore((s) => s.connectConnector);
  const bindConnector = useAgentConnectorStore((s) => s.bindConnector);
  const unbindConnector = useAgentConnectorStore((s) => s.unbindConnector);
  const capabilitySelector = useMemo(
    () => createConnectorCapabilitySelector(agentId),
    [agentId],
  );
  const capabilityProjection = useAgentCapabilityStore(capabilitySelector);
  const connectorCapabilities = useMemo(
    () => new Map(availableConnectors.map((connector) => {
      const manifestKeys = new Set(
        resourceManifests
          .filter((resource) => resource.connectorId === connector.id)
          .flatMap((resource) => resource.toolManifests)
          .map((reference) =>
            `${reference.capabilityId}\u0000${reference.capabilityVersion}`),
      );
      const manifests = capabilityProjection.manifests.filter(
        (manifest) =>
          manifestKeys.has(`${manifest.capabilityId}\u0000${manifest.version}`)
          && !manifest.retiredAt,
      );
      const bindings = capabilityProjection.bindings.filter(
        (binding) =>
          binding.enabled
          && !binding.tombstonedAt
          && manifestKeys.has(`${binding.capabilityId}\u0000${binding.capabilityVersion}`),
      );
      return [connector.id, {
        manifests,
        bindings,
        readiness: bindings.length > 0
          ? connectorBindingReadiness(bindings, capabilityProjection.readiness)
          : undefined,
      }] as const;
    })),
    [availableConnectors, capabilityProjection, resourceManifests],
  );

  const runConnectorAction = useCallback(
    async (connectorId: string, action: () => Promise<void>) => {
      setPendingConnectorId(connectorId);
      try {
        await action();
      } catch {
        void message.error(t('agent.connectors.actionFailed'));
      } finally {
        setPendingConnectorId(null);
      }
    },
    [message, t],
  );

  const handleToggle = useCallback(
    (connectorId: string, checked: boolean) => {
      if (checked) {
        void runConnectorAction(
          connectorId,
          () => bindConnector(agentId, connectorId),
        );
      } else {
        void runConnectorAction(
          connectorId,
          () => unbindConnector(agentId, connectorId),
        );
      }
    },
    [agentId, bindConnector, runConnectorAction, unbindConnector],
  );

  const handleConnect = useCallback(
    (connectorId: string) => {
      void runConnectorAction(connectorId, () => connectConnector(connectorId));
    },
    [connectConnector, runConnectorAction],
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
    <Flexbox data-pt-agent-connectors gap={6} style={{ minHeight: 0, overflow: 'auto' }}>
      {availableConnectors.map((connector) => {
        const capability = connectorCapabilities.get(connector.id);
        return (
          <ConnectorRow
            key={connector.id}
            connector={connector}
            bound={(capability?.bindings.length ?? 0) > 0}
            readiness={capability?.readiness}
            bindingAvailable={(capability?.manifests.length ?? 0) > 0}
            pending={pendingConnectorId === connector.id}
            onToggle={handleToggle}
            onConnect={handleConnect}
          />
        );
      })}
    </Flexbox>
  );
}
