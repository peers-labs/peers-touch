import { createDesktopStore } from './createDesktopStore';
import { log } from '../utils/logger';
import { useOAuth2Store } from './oauth2';
import { useAgentStore } from './agent';
import {
  selectCapabilityManifestBySource,
  useAgentCapabilityStore,
} from './agentCapabilities';
import type { OAuth2ProviderSummary, OAuth2Connection } from '../services/desktop_api';
import {
  CapabilityApprovalPolicy,
  CapabilitySourceKind,
  type AgentCapabilityBinding,
  type CapabilityManifest,
} from '../gen/proto/domain/agent/capability_pb';

// ── Types ────────────────────────────────────────────────────────────

type ConnectorType = 'oauth' | 'api-key' | 'webhook';
type ConnectorStatus = 'connected' | 'disconnected' | 'expired';

export interface ConnectorInfo {
  id: string;
  name: string;
  type: ConnectorType;
  provider: string;
  status: ConnectorStatus;
  scopes?: string[];
  connectedAt?: string;
  iconUrl?: string;
  color?: string;
}

export interface AgentConnectorBinding {
  agentId: string;
  connectorId: string;
  bindingId: string;
  capabilityId: string;
  capabilityVersion: string;
  enabled: boolean;
}

function createMutationId(action: 'bind' | 'unbind'): string {
  return `connector-${action}:${globalThis.crypto.randomUUID()}`;
}

function findManifestBinding(
  bindings: readonly AgentCapabilityBinding[],
  manifest: CapabilityManifest,
): AgentCapabilityBinding | undefined {
  return bindings.find(
    (binding) =>
      binding.capabilityId === manifest.capabilityId
      && binding.capabilityVersion === manifest.version,
  );
}

function toConnectorBinding(
  agentId: string,
  manifest: CapabilityManifest,
  binding: AgentCapabilityBinding,
): AgentConnectorBinding {
  return {
    agentId,
    connectorId: manifest.sourceInstanceId,
    bindingId: binding.bindingId,
    capabilityId: binding.capabilityId,
    capabilityVersion: binding.capabilityVersion,
    enabled: binding.enabled,
  };
}

async function loadConnectorAuthority(
  agentId: string,
  connectorId: string,
): Promise<{
  manifest: CapabilityManifest;
  binding: AgentCapabilityBinding | undefined;
}> {
  const capabilityStore = useAgentCapabilityStore.getState();
  await Promise.all([
    capabilityStore.loadCatalog(),
    capabilityStore.loadAgent(agentId),
  ]);

  const state = useAgentCapabilityStore.getState();
  const manifest = selectCapabilityManifestBySource(
    state,
    CapabilitySourceKind.CONNECTOR,
    connectorId,
  );
  if (!manifest) {
    throw new Error('agent.connectorManifestMissing');
  }

  return {
    manifest,
    binding: findManifestBinding(state.bindingsByAgentId[agentId] ?? [], manifest),
  };
}

// ── Mapping helpers ──────────────────────────────────────────────────

function mapOAuth2ToConnector(
  provider: OAuth2ProviderSummary,
  connection: OAuth2Connection | undefined,
): ConnectorInfo {
  let status: ConnectorStatus = 'disconnected';
  if (connection) {
    status = connection.status === 'active' ? 'connected' : 'expired';
  }

  return {
    id: provider.id,
    name: provider.name,
    type: 'oauth',
    provider: provider.id,
    status,
    scopes: connection?.scopes,
    connectedAt: connection?.connected_at,
    iconUrl: provider.icon_url,
    color: provider.color,
  };
}

// ── Store ────────────────────────────────────────────────────────────

interface AgentConnectorState {
  availableConnectors: ConnectorInfo[];
  loading: boolean;

  loadConnectors: () => Promise<void>;
  connectConnector: (connectorId: string) => Promise<void>;
  bindConnector: (agentId: string, connectorId: string) => Promise<void>;
  unbindConnector: (agentId: string, connectorId: string) => Promise<void>;
  getBindingsForAgent: (agentId: string) => AgentConnectorBinding[];
  getAvailableForAgent: (agentId: string) => ConnectorInfo[];
  isConnectorBound: (agentId: string, connectorId: string) => boolean;
}

export const useAgentConnectorStore = createDesktopStore<AgentConnectorState>(
  'agentConnectors',
  (set, get) => ({
    availableConnectors: [],
    loading: false,

    loadConnectors: async () => {
      set({ loading: true });
      try {
        // Leverage the existing OAuth2 store to discover connectors
        const oauth2 = useOAuth2Store.getState();
        await oauth2.loadAll();

        const { providers, connections } = useOAuth2Store.getState();
        const connectors: ConnectorInfo[] = providers
          .filter((p) => p.enabled)
          .map((provider) => {
            const connection = connections.find((c) => c.provider_id === provider.id);
            return mapOAuth2ToConnector(provider, connection);
          });

        set({ availableConnectors: connectors });
      } catch (error) {
        log.error('agentConnectors', 'Failed to load connectors', { error: String(error) });
        throw error;
      } finally {
        set({ loading: false });
      }
    },

    // OAuth leg: reuse the complete existing OAuth2 loopback flow to establish
    // the provider connection. This does not mount to any agent; it only makes the
    // connector "connected" so it becomes eligible to bind.
    connectConnector: async (connectorId: string) => {
      try {
        await useOAuth2Store.getState().startAuth(connectorId);
        await get().loadConnectors();
      } catch (error) {
        log.error('agentConnectors', 'Failed to connect OAuth connector', {
          connectorId,
          error: String(error),
        });
        throw error;
      }
    },

    bindConnector: async (agentId: string, connectorId: string) => {
      const agent = useAgentStore.getState().agents.find((item) => item.id === agentId);
      if (!agent) throw new Error('agent.connectorAgentMissing');

      const { manifest, binding } = await loadConnectorAuthority(agentId, connectorId);
      if (binding?.enabled) return;
      const approvalPolicy = binding?.approvalPolicy ?? manifest.defaultApprovalPolicy;
      if (approvalPolicy === CapabilityApprovalPolicy.UNSPECIFIED) {
        throw new Error('agent.connectorApprovalPolicyMissing');
      }

      await useAgentCapabilityStore.getState().upsertBinding({
        bindingId: binding?.bindingId,
        agentId,
        capabilityId: manifest.capabilityId,
        capabilityVersion: manifest.version,
        enabled: true,
        approvalPolicy,
        expectedAgentVersion: agent.version,
        expectedBindingRevision: binding?.revision ?? 0n,
        idempotencyKey: createMutationId('bind'),
      });
      log.info('agentConnectors', 'Bound connector to agent', { agentId, connectorId });
    },

    unbindConnector: async (agentId: string, connectorId: string) => {
      const { binding } = await loadConnectorAuthority(agentId, connectorId);
      if (!binding) return;

      await useAgentCapabilityStore.getState().deleteBinding({
        agentId,
        bindingId: binding.bindingId,
        expectedBindingRevision: binding.revision,
        idempotencyKey: createMutationId('unbind'),
        reason: 'connector_unbound',
      });
      log.info('agentConnectors', 'Unbound connector from agent', { agentId, connectorId });
    },

    getBindingsForAgent: (agentId: string) => {
      const state = useAgentCapabilityStore.getState();
      const bindings = state.bindingsByAgentId[agentId] ?? [];
      return state.manifests
        .filter(
          (manifest) =>
            manifest.sourceKind === CapabilitySourceKind.CONNECTOR
            && Boolean(manifest.sourceInstanceId),
        )
        .flatMap((manifest) => {
          const binding = findManifestBinding(bindings, manifest);
          return binding ? [toConnectorBinding(agentId, manifest, binding)] : [];
        });
    },

    getAvailableForAgent: (_agentId: string) => {
      return get().availableConnectors;
    },

    isConnectorBound: (agentId: string, connectorId: string) => {
      return get()
        .getBindingsForAgent(agentId)
        .some((binding) => binding.connectorId === connectorId && binding.enabled);
    },
  }),
);
