import {
  CapabilityOperationStatus,
  type CapabilityOperation,
} from '../gen/proto/domain/agent/capability_pb';
import {
  mcpService,
  type McpLifecycleOperationKind,
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

const OPERATION_POLL_INTERVAL_MS = 500;
const operationPollTimers = new Map<string, ReturnType<typeof setTimeout>>();

function operationKey(serverName: string): string {
  return `operation:${serverName}`;
}

function lifecycleIdempotencyKey(
  serverName: string,
  operationKind: McpLifecycleOperationKind,
): string {
  const nonce = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}`;
  return `mcp:${serverName}:${operationKind}:${nonce}`;
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
  if (!operation) return false;
  if (operation.status === CapabilityOperationStatus.UNKNOWN_SIDE_EFFECT) return false;
  return Boolean(
    operation.error?.retryable
    || [
      CapabilityOperationStatus.CANCELLED,
      CapabilityOperationStatus.TIMED_OUT,
      CapabilityOperationStatus.FAILED,
    ].includes(operation.status),
  );
}

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

function clearOperationPoll(serverName: string): void {
  const timer = operationPollTimers.get(serverName);
  if (timer) clearTimeout(timer);
  operationPollTimers.delete(serverName);
}

function clearAllOperationPolls(): void {
  operationPollTimers.forEach((timer) => clearTimeout(timer));
  operationPollTimers.clear();
}

export const useMCPStore = createDesktopStore<MCPState>('mcp', (set, get) => {
  const scheduleOperationPoll = (serverName: string, operationId: string) => {
    clearOperationPoll(serverName);
    operationPollTimers.set(
      serverName,
      setTimeout(() => {
        void reconcileOneOperation(serverName, operationId);
      }, OPERATION_POLL_INTERVAL_MS),
    );
  };

  const trackOperation = (
    serverName: string,
    operation: CapabilityOperation,
  ) => {
    set((state) => ({
      operationsByServer: {
        ...state.operationsByServer,
        [serverName]: operation,
      },
    }));
    scheduleOperationPoll(serverName, operation.operationId);
  };

  const reconcileOneOperation = async (
    serverName: string,
    operationId: string,
  ): Promise<void> => {
    try {
      const operation = await mcpService.getOperation(operationId);
      set((state) => ({
        operationsByServer: {
          ...state.operationsByServer,
          [serverName]: operation,
        },
      }));
      if (isMcpOperationActive(operation.status)) {
        scheduleOperationPoll(serverName, operationId);
      } else {
        clearOperationPoll(serverName);
        const servers = await mcpService.list();
        set({ servers, lastLoadedAt: Date.now() });
      }
    } catch (error) {
      clearOperationPoll(serverName);
      const message = toStoreError(error);
      log.warn('mcp', 'Failed to reconcile MCP lifecycle operation', {
        serverName,
        operationId,
        error: message,
      });
      set({ error: message });
    }
  };

  const startOperation = async (
    serverName: string,
    operationKind: McpLifecycleOperationKind,
  ): Promise<void> => {
    const mutationKey = operationKey(serverName);
    set((state) => ({
      error: null,
      pendingMutations: beginMutation(state.pendingMutations, mutationKey),
    }));
    try {
      const operation = await mcpService.startLifecycle(
        serverName,
        operationKind,
        lifecycleIdempotencyKey(serverName, operationKind),
      );
      trackOperation(serverName, operation);
    } catch (error) {
      const message = toStoreError(error);
      log.error('mcp', 'Failed to start MCP lifecycle operation', {
        serverName,
        operationKind,
        error: message,
      });
      set({ error: message });
      throw error;
    } finally {
      set((state) => ({
        pendingMutations: endMutation(state.pendingMutations, mutationKey),
      }));
    }
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
        const servers = await mcpService.list();
        const operationEntries = await Promise.all(
          servers
            .filter((server) => Boolean(server.operationId))
            .map(async (server) => {
              try {
                const operation = await mcpService.getOperation(server.operationId!);
                return [server.name, operation] as const;
              } catch (error) {
                log.warn('mcp', 'Failed to restore MCP lifecycle operation', {
                  serverName: server.name,
                  operationId: server.operationId,
                  error: toStoreError(error),
                });
                return null;
              }
            }),
        );
        const operationsByServer = Object.fromEntries(
          operationEntries.filter(
            (entry): entry is readonly [string, CapabilityOperation] => entry !== null,
          ),
        );
        set({ servers, operationsByServer, lastLoadedAt: Date.now() });
        for (const [serverName, operation] of Object.entries(operationsByServer)) {
          if (isMcpOperationActive(operation.status)) {
            scheduleOperationPoll(serverName, operation.operationId);
          }
        }
      } catch (error) {
        const message = toStoreError(error);
        log.error('mcp', 'Failed to load MCP servers', { error: message });
        set({ error: message });
      } finally {
        set({ loading: false });
      }
    },

    reconcileOperations: async () => {
      await Promise.all(
        Object.entries(get().operationsByServer).map(([serverName, operation]) =>
          reconcileOneOperation(serverName, operation.operationId)),
      );
    },

    createServer: async (data: Partial<MCPServerRecord>) => {
      const name = data.name?.trim() || `mcp-${Date.now()}`;
      const operation = await mcpService.create({ ...data, name });
      await get().loadServers();
      trackOperation(name, operation);
    },

    updateServer: async (name: string, data: Partial<MCPServerRecord>) => {
      const operation = await mcpService.update(name, data);
      await get().loadServers();
      trackOperation(name, operation);
    },

    toggleServer: async (name: string, enabled: boolean) => {
      const operation = await mcpService.toggle(name, enabled);
      await get().loadServers();
      trackOperation(name, operation);
    },

    deleteServer: async (name: string) => {
      trackOperation(name, await mcpService.delete(name));
    },

    testServer: async (name: string) => {
      await startOperation(name, 'test');
    },

    reconnectServer: async (name: string) => {
      const operation = get().operationsByServer[name];
      if (operation?.status === CapabilityOperationStatus.DISCONNECTED) {
        const takenOver = await mcpService.takeOverOperation(operation);
        set((state) => ({
          operationsByServer: {
            ...state.operationsByServer,
            [name]: takenOver,
          },
        }));
        scheduleOperationPoll(name, takenOver.operationId);
        return;
      }
      await startOperation(name, 'reconnect');
    },

    recoverCleanup: async (name: string) => {
      const operation = get().operationsByServer[name];
      if (
        !operation
        || operation.status !== CapabilityOperationStatus.SETTLING_CLEANUP
      ) return;
      const takenOver = await mcpService.takeOverCleanup(operation);
      set((state) => ({
        operationsByServer: {
          ...state.operationsByServer,
          [name]: takenOver,
        },
      }));
      scheduleOperationPoll(name, takenOver.operationId);
    },

    cancelOperation: async (name: string) => {
      const operation = get().operationsByServer[name];
      if (!operation || !isMcpOperationActive(operation.status)) return;
      const cancelled = await mcpService.cancelOperation(operation);
      set((state) => ({
        operationsByServer: {
          ...state.operationsByServer,
          [name]: cancelled,
        },
      }));
      scheduleOperationPoll(name, operation.operationId);
    },

    retryOperation: async (name: string) => {
      const operation = get().operationsByServer[name];
      const server = get().servers.find((item) => item.name === name);
      if (!operation || !server || !isMcpOperationRetryable(operation)) return;
      await startOperation(
        name,
        (server.operationKind || operation.operationKind) as McpLifecycleOperationKind,
      );
    },

    reset: () => {
      clearAllOperationPolls();
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
