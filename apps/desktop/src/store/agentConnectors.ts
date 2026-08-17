import { createDesktopStore } from './createDesktopStore';
import { log } from '../utils/logger';
import { useOAuth2Store } from './oauth2';
import { useAgentStore } from './agent';
import { api, parseAgentChatConfig } from '../services/desktop_api';
import type {
  OAuth2ProviderSummary,
  OAuth2Connection,
  AgentConnectorConfigEntry,
} from '../services/desktop_api';

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
  enabledTools: string[];
}

// ── chatConfig persistence ───────────────────────────────────────────
// C7: connector mounts are per-agent config, durable through the same Station
// config_json channel used by mcpServers/skills/tools. There is no localStorage
// fallback — the agent store is the single source of truth for the mount relation.

function readAgentConnectorEntries(agentId: string): AgentConnectorConfigEntry[] {
  const agent = useAgentStore.getState().agents.find((a) => a.id === agentId);
  if (!agent) return [];
  return parseAgentChatConfig(agent).connectors ?? [];
}

function entriesToBindings(agentId: string, entries: AgentConnectorConfigEntry[]): AgentConnectorBinding[] {
  return entries.map((entry) => ({
    agentId,
    connectorId: entry.connectorId,
    enabledTools: entry.enabledTools ?? [],
  }));
}

async function persistAgentConnectorEntries(
  agentId: string,
  entries: AgentConnectorConfigEntry[],
): Promise<void> {
  const agentStore = useAgentStore.getState();
  const agent = agentStore.agents.find((a) => a.id === agentId);
  if (!agent) throw new Error(`agent ${agentId} not found`);
  await agentStore.updateAgentConfig(agent.name, { chatConfig: { connectors: entries } });
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
  syncConnectorTools: (agentId: string, connectorId: string) => Promise<void>;
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
      const entries = readAgentConnectorEntries(agentId);
      if (entries.some((e) => e.connectorId === connectorId)) return;
      const updated = [...entries, { connectorId, enabledTools: [] }];
      await persistAgentConnectorEntries(agentId, updated);
      log.info('agentConnectors', 'Bound connector to agent', { agentId, connectorId });
      // Sync the connector's tool set right after mount, mirroring Lobe's mount→syncTools.
      await get().syncConnectorTools(agentId, connectorId);
    },

    unbindConnector: async (agentId: string, connectorId: string) => {
      const entries = readAgentConnectorEntries(agentId);
      const updated = entries.filter((e) => e.connectorId !== connectorId);
      if (updated.length === entries.length) return;
      await persistAgentConnectorEntries(agentId, updated);
      log.info('agentConnectors', 'Unbound connector from agent', { agentId, connectorId });
    },

    // syncTools leg: pull the connector provider's declared resources (its callable
    // surface) and persist them as the mount's enabledTools. Reuses the existing
    // oauth2 provider detail; no separate tool-discovery backend.
    syncConnectorTools: async (agentId: string, connectorId: string) => {
      try {
        const detail = await api.oauth2GetProvider(connectorId);
        const tools = detail.resources ? Object.keys(detail.resources) : [];
        const entries = readAgentConnectorEntries(agentId);
        const updated = entries.map((e) =>
          e.connectorId === connectorId ? { ...e, enabledTools: tools } : e,
        );
        if (!updated.some((e) => e.connectorId === connectorId)) return;
        await persistAgentConnectorEntries(agentId, updated);
      } catch (error) {
        log.error('agentConnectors', 'Failed to sync connector tools', {
          agentId,
          connectorId,
          error: String(error),
        });
        throw error;
      }
    },

    getBindingsForAgent: (agentId: string) => {
      return entriesToBindings(agentId, readAgentConnectorEntries(agentId));
    },

    getAvailableForAgent: (_agentId: string) => {
      return get().availableConnectors;
    },

    isConnectorBound: (agentId: string, connectorId: string) => {
      return readAgentConnectorEntries(agentId).some((e) => e.connectorId === connectorId);
    },
  }),
);
