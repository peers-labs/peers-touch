import { create } from '@bufbuild/protobuf';
import { createDesktopStore } from './createDesktopStore';
import { api } from '../services/desktop_api';
import { log } from '../utils/logger';
import { useOAuth2Store } from './oauth2';
import { useAgentStore } from './agent';
import {
  useAgentCapabilityStore,
} from './agentCapabilities';
import type { OAuth2ProviderSummary, OAuth2Connection } from '../services/desktop_api';
import {
  CapabilityApprovalPolicy,
  CapabilitySourceKind,
  ConnectorResourceStatus,
  ListConnectorResourceManifestsRequestSchema,
  type AgentCapabilityBinding,
  type CapabilityManifest,
  type ConnectorResourceManifest,
} from '../gen/proto/domain/agent/capability_pb';

// ── Types ────────────────────────────────────────────────────────────

type ConnectorType = 'oauth' | 'api-key' | 'webhook';
type ConnectorStatus =
  | 'connected'
  | 'disconnected'
  | 'expired'
  | 'revoked'
  | 'revocation_unconfirmed';

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
  resourceId: string;
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
  connectorId: string,
  resourceId: string,
  binding: AgentCapabilityBinding,
): AgentConnectorBinding {
  return {
    agentId,
    connectorId,
    bindingId: binding.bindingId,
    capabilityId: binding.capabilityId,
    capabilityVersion: binding.capabilityVersion,
    resourceId,
    enabled: binding.enabled,
  };
}

async function loadConnectorAuthority(
  agentId: string,
  connectorId: string,
): Promise<Array<{
  resource: ConnectorResourceManifest;
  manifest: CapabilityManifest;
  binding: AgentCapabilityBinding | undefined;
}>> {
  const capabilityStore = useAgentCapabilityStore.getState();
  await Promise.all([
    capabilityStore.loadCatalog(),
    capabilityStore.loadAgent(agentId),
  ]);

  const state = useAgentCapabilityStore.getState();
  const resources = useAgentConnectorStore.getState().resourceManifests
    .filter(
      (resource) =>
        resource.connectorId === connectorId
        && resource.status === ConnectorResourceStatus.READY,
    );
  const result = resources.flatMap((resource) =>
    resource.toolManifests.flatMap((reference) => {
      const manifest = state.manifests.find(
        (candidate) =>
          candidate.sourceKind === CapabilitySourceKind.CONNECTOR
          && candidate.capabilityId === reference.capabilityId
          && candidate.version === reference.capabilityVersion,
      );
      if (!manifest) return [];
      return [{
        resource,
        manifest,
        binding: findManifestBinding(
          state.bindingsByAgentId[agentId] ?? [],
          manifest,
        ),
      }];
    }));
  if (result.length === 0) {
    throw new Error('agent.connectorManifestMissing');
  }
  return result;
}

// ── Mapping helpers ──────────────────────────────────────────────────

function mapOAuth2ToConnector(
  provider: OAuth2ProviderSummary,
  connection: OAuth2Connection | undefined,
): ConnectorInfo {
  let status: ConnectorStatus = 'disconnected';
  if (connection) {
    if (connection.status === 'active') status = 'connected';
    else if (connection.status === 'expired') status = 'expired';
    else if (connection.status === 'revoked') status = 'revoked';
    else if (connection.status === 'revocation_unconfirmed') {
      status = 'revocation_unconfirmed';
    }
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
  resourceManifests: ConnectorResourceManifest[];
  loading: boolean;

  loadConnectors: () => Promise<void>;
  connectConnector: (connectorId: string) => Promise<void>;
  bindConnector: (agentId: string, connectorId: string) => Promise<void>;
  unbindConnector: (agentId: string, connectorId: string) => Promise<void>;
  getBindingsForAgent: (agentId: string) => AgentConnectorBinding[];
  getAvailableForAgent: (agentId: string) => ConnectorInfo[];
  isConnectorBound: (agentId: string, connectorId: string) => boolean;
  reset: () => void;
}

let loadConnectorsPromise: Promise<void> | null = null;

export const useAgentConnectorStore = createDesktopStore<AgentConnectorState>(
  'agentConnectors',
  (set, get) => ({
    availableConnectors: [],
    resourceManifests: [],
    loading: false,

    loadConnectors: async () => {
      if (loadConnectorsPromise) return loadConnectorsPromise;

      loadConnectorsPromise = (async () => {
        set({ loading: true });
        try {
          // Leverage the existing OAuth2 store to discover connectors
          const oauth2 = useOAuth2Store.getState();
          await oauth2.loadAll();
          await api.syncOAuthConnectorManifests();
          await oauth2.loadConnections();
          const resourceManifests = await api.listConnectorResourceManifests(
            create(ListConnectorResourceManifestsRequestSchema, {}),
          );

          const { providers, connections } = useOAuth2Store.getState();
          const connectors: ConnectorInfo[] = providers
            .filter((p) => p.enabled)
            .map((provider) => {
              const connection = connections.find((c) => c.provider_id === provider.id);
              return mapOAuth2ToConnector(provider, connection);
            });

          set({ availableConnectors: connectors, resourceManifests });
        } catch (error) {
          log.error('agentConnectors', 'Failed to load connectors', { error: String(error) });
          throw error;
        } finally {
          set({ loading: false });
          loadConnectorsPromise = null;
        }
      })();

      return loadConnectorsPromise;
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

      const resources = await loadConnectorAuthority(agentId, connectorId);
      for (const { manifest, binding } of resources) {
        if (binding?.enabled) continue;
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
      }
      log.info('agentConnectors', 'Bound connector to agent', { agentId, connectorId });
    },

    unbindConnector: async (agentId: string, connectorId: string) => {
      const resources = await loadConnectorAuthority(agentId, connectorId);
      for (const { binding } of resources) {
        if (!binding) continue;
        await useAgentCapabilityStore.getState().deleteBinding({
          agentId,
          bindingId: binding.bindingId,
          expectedBindingRevision: binding.revision,
          idempotencyKey: createMutationId('unbind'),
          reason: 'connector_unbound',
        });
      }
      log.info('agentConnectors', 'Unbound connector from agent', { agentId, connectorId });
    },

    getBindingsForAgent: (agentId: string) => {
      const state = useAgentCapabilityStore.getState();
      const bindings = state.bindingsByAgentId[agentId] ?? [];
      return get().resourceManifests.flatMap((resource) =>
        resource.toolManifests.flatMap((reference) => {
          const manifest = state.manifests.find(
            (candidate) =>
              candidate.capabilityId === reference.capabilityId
              && candidate.version === reference.capabilityVersion,
          );
          if (!manifest) return [];
          const binding = findManifestBinding(bindings, manifest);
          return binding
            ? [toConnectorBinding(
                agentId,
                resource.connectorId,
                resource.resourceId,
                binding,
              )]
            : [];
        }));
    },

    getAvailableForAgent: (_agentId: string) => {
      return get().availableConnectors;
    },

    isConnectorBound: (agentId: string, connectorId: string) => {
      return get()
        .getBindingsForAgent(agentId)
        .some((binding) => binding.connectorId === connectorId && binding.enabled);
    },

    reset: () => {
      set({
        availableConnectors: [],
        resourceManifests: [],
        loading: false,
      });
    },
  }),
);
