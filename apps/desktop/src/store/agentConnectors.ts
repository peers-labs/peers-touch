import { createDesktopStore } from './createDesktopStore';
import { log } from '../utils/logger';
import { useOAuth2Store } from './oauth2';
import type { OAuth2ProviderSummary, OAuth2Connection } from '../services/desktop_api';

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

// ── localStorage persistence ─────────────────────────────────────────

const BINDINGS_STORAGE_KEY = 'peers-agent-connector-bindings';

function loadBindingsFromStorage(): AgentConnectorBinding[] {
  try {
    const raw = localStorage.getItem(BINDINGS_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as AgentConnectorBinding[];
  } catch {
    return [];
  }
}

function saveBindingsToStorage(bindings: AgentConnectorBinding[]): void {
  try {
    localStorage.setItem(BINDINGS_STORAGE_KEY, JSON.stringify(bindings));
  } catch {
    log.error('agentConnectors', 'Failed to persist connector bindings to localStorage');
  }
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
  bindings: AgentConnectorBinding[];
  loading: boolean;

  loadConnectors: () => Promise<void>;
  bindConnector: (agentId: string, connectorId: string) => void;
  unbindConnector: (agentId: string, connectorId: string) => void;
  getBindingsForAgent: (agentId: string) => AgentConnectorBinding[];
  getAvailableForAgent: (agentId: string) => ConnectorInfo[];
  isConnectorBound: (agentId: string, connectorId: string) => boolean;
}

export const useAgentConnectorStore = createDesktopStore<AgentConnectorState>(
  'agentConnectors',
  (set, get) => ({
    availableConnectors: [],
    bindings: loadBindingsFromStorage(),
    loading: false,

    loadConnectors: async () => {
      set({ loading: true });

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

      set({ availableConnectors: connectors, loading: false });
    },

    bindConnector: (agentId: string, connectorId: string) => {
      const { bindings } = get();
      const exists = bindings.some(
        (b) => b.agentId === agentId && b.connectorId === connectorId,
      );
      if (exists) return;

      const newBinding: AgentConnectorBinding = {
        agentId,
        connectorId,
        enabledTools: [],
      };
      const updated = [...bindings, newBinding];
      set({ bindings: updated });
      saveBindingsToStorage(updated);
      log.info('agentConnectors', 'Bound connector to agent', { agentId, connectorId });
    },

    unbindConnector: (agentId: string, connectorId: string) => {
      const { bindings } = get();
      const updated = bindings.filter(
        (b) => !(b.agentId === agentId && b.connectorId === connectorId),
      );
      set({ bindings: updated });
      saveBindingsToStorage(updated);
      log.info('agentConnectors', 'Unbound connector from agent', { agentId, connectorId });
    },

    getBindingsForAgent: (agentId: string) => {
      return get().bindings.filter((b) => b.agentId === agentId);
    },

    getAvailableForAgent: (_agentId: string) => {
      return get().availableConnectors;
    },

    isConnectorBound: (agentId: string, connectorId: string) => {
      return get().bindings.some(
        (b) => b.agentId === agentId && b.connectorId === connectorId,
      );
    },
  }),
);
