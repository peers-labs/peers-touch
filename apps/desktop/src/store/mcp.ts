import {
  CapabilityOperationStatus,
  type CapabilityOperation,
} from '../gen/proto/domain/agent/capability_pb';
import {
  mcpService,
  type MCPServerItem,
  type MCPServerRecord,
} from '../services/mcp-service';
import { log } from '../utils/logger';
import { createDesktopStore } from './createDesktopStore';
import {
  beginMutation,
  endMutation,
  toStoreError,
  type RevalidationState,
} from './revalidation';

interface MCPState extends RevalidationState {
  servers: MCPServerItem[];
  operationsByServer: Record<string, CapabilityOperation>;
  loadServers: () => Promise<void>;
  reconcileOperations: () => Promise<void>;
  createServer: (data: Partial<MCPServerRecord>) => Promise<void>;
  updateServer: (name: string, data: Partial<MCPServerRecord>) => Promise<void>;
  toggleServer: (name: string, enabled: boolean) => Promise<void>;
  deleteServer: (name: string) => Promise<void>;
  testServer: (name: string) => Promise<void>;
  reconnectServer: (name: string) => Promise<void>;
  recoverCleanup: (name: string) => Promise<void>;
  cancelOperation: (name: string) => Promise<void>;
  retryOperation: (name: string) => Promise<void>;
  reset: () => void;
}

export function isMcpOperationActive(status: CapabilityOperationStatus): boolean {
  return [
    CapabilityOperationStatus.PENDING,
    CapabilityOperationStatus.DISPATCHED,
    CapabilityOperationStatus.RUNNING,
    CapabilityOperationStatus.DISCONNECTED,
    CapabilityOperationStatus.RECONNECTING,
    CapabilityOperationStatus.CANCELLING,
    CapabilityOperationStatus.SETTLING_CLEANUP,
  ].includes(status);
}

export function isMcpOperationRetryable(operation?: CapabilityOperation): boolean {
  if (!operation || operation.status === CapabilityOperationStatus.UNKNOWN_SIDE_EFFECT) {
    return false;
  }
  return Boolean(
    operation.error?.retryable
    || [
      CapabilityOperationStatus.CANCELLED,
      CapabilityOperationStatus.TIMED_OUT,
      CapabilityOperationStatus.FAILED,
    ].includes(operation.status),
  );
}

export const useMCPStore = createDesktopStore<MCPState>('mcp', (set, get) => {
  const mutate = async (
    name: string,
    action: () => Promise<unknown>,
  ): Promise<void> => {
    const mutationKey = `server:${name}`;
    set((state) => ({
      error: null,
      pendingMutations: beginMutation(state.pendingMutations, mutationKey),
    }));
    try {
      await action();
      const servers = await mcpService.list();
      set({ servers, lastLoadedAt: Date.now() });
    } catch (error) {
      const message = toStoreError(error);
      log.error('mcp', 'MCP Station mutation failed', { name, error: message });
      set({ error: message });
      throw error;
    } finally {
      set((state) => ({
        pendingMutations: endMutation(state.pendingMutations, mutationKey),
      }));
    }
  };

  const refresh = async (name: string): Promise<void> => {
    await mutate(name, () => mcpService.refresh(name));
  };

  return {
    servers: [],
    operationsByServer: {},
    loading: false,
    error: null,
    lastLoadedAt: null,
    pendingMutations: {},

    loadServers: async () => {
      set({ loading: true, error: null });
      try {
        set({
          servers: await mcpService.list(),
          operationsByServer: {},
          lastLoadedAt: Date.now(),
        });
      } catch (error) {
        const message = toStoreError(error);
        log.error('mcp', 'Failed to load Station MCP servers', { error: message });
        set({ error: message });
      } finally {
        set({ loading: false });
      }
    },

    reconcileOperations: async () => {
      await get().loadServers();
    },

    createServer: async (data) => {
      const name = data.name?.trim() || `mcp-${Date.now()}`;
      await mutate(name, () => mcpService.create({ ...data, name }));
    },

    updateServer: async (name, data) => {
      await mutate(name, () => mcpService.update(name, data));
    },

    toggleServer: async (name, enabled) => {
      await mutate(name, () => mcpService.toggle(name, enabled));
    },

    deleteServer: async (name) => {
      await mutate(name, () => mcpService.delete(name));
    },

    testServer: refresh,
    reconnectServer: refresh,
    recoverCleanup: refresh,
    retryOperation: refresh,
    cancelOperation: async () => {},

    reset: () => {
      set({
        servers: [],
        operationsByServer: {},
        loading: false,
        error: null,
        lastLoadedAt: null,
        pendingMutations: {},
      });
    },
  };
});
