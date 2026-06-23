import { create } from 'zustand';
import { mcpService, type MCPServerItem, type MCPServerRecord } from '../services/mcp-service';
import { log } from '../utils/logger';
import { beginMutation, endMutation, toStoreError, type RevalidationState } from './revalidation';

interface MCPState extends RevalidationState {
  servers: MCPServerItem[];
  loadServers: () => Promise<void>;
  createServer: (data: Partial<MCPServerRecord>) => Promise<void>;
  toggleServer: (name: string, enabled: boolean) => Promise<void>;
  deleteServer: (name: string) => Promise<void>;
}

export const useMCPStore = create<MCPState>((set, get) => ({
  servers: [],
  loading: false,
  error: null,
  lastLoadedAt: null,
  pendingMutations: {},

  loadServers: async () => {
    set({ loading: true, error: null });
    try {
      const servers = await mcpService.list();
      set({ servers, lastLoadedAt: Date.now() });
    } catch (error) {
      const message = toStoreError(error);
      log.error('mcp', 'Failed to load MCP servers', { error: message });
      set({ error: message });
    } finally {
      set({ loading: false });
    }
  },

  createServer: async (data: Partial<MCPServerRecord>) => {
    const name = data.name?.trim() || `mcp-${Date.now()}`;
    const optimistic: MCPServerItem = {
      name,
      title: data.title || name,
      description: data.description || name,
      type: data.type || 'stdio',
      source: 'local',
      enabled: data.enabled ?? true,
      metaAvatar: '',
      metaTags: [],
      toolCount: 0,
      status: 'unknown',
    };
    const previous = get().servers;
    const mutationKey = `create:${name}`;
    set((state) => ({
      servers: [...state.servers.filter((server) => server.name !== name), optimistic],
      error: null,
      pendingMutations: beginMutation(state.pendingMutations, mutationKey),
    }));
    try {
      const result = await mcpService.create(data);
      if (result.ok) await get().loadServers();
    } catch (error) {
      const message = toStoreError(error);
      log.error('mcp', 'Failed to create MCP server', { name, error: message });
      set({ servers: previous, error: message });
      throw error;
    } finally {
      set((state) => ({ pendingMutations: endMutation(state.pendingMutations, mutationKey) }));
    }
  },

  toggleServer: async (name: string, enabled: boolean) => {
    const previous = get().servers;
    const mutationKey = `toggle:${name}`;
    set((state) => ({
      servers: state.servers.map((server) => (server.name === name ? { ...server, enabled } : server)),
      error: null,
      pendingMutations: beginMutation(state.pendingMutations, mutationKey),
    }));
    try {
      await mcpService.toggle(name, enabled);
      await get().loadServers();
    } catch (error) {
      const message = toStoreError(error);
      log.error('mcp', 'Failed to toggle MCP server', { name, enabled, error: message });
      set({ servers: previous, error: message });
      throw error;
    } finally {
      set((state) => ({ pendingMutations: endMutation(state.pendingMutations, mutationKey) }));
    }
  },

  deleteServer: async (name: string) => {
    const previous = get().servers;
    const mutationKey = `delete:${name}`;
    set((state) => ({
      servers: state.servers.filter((server) => server.name !== name),
      error: null,
      pendingMutations: beginMutation(state.pendingMutations, mutationKey),
    }));
    try {
      await mcpService.delete(name);
      await get().loadServers();
    } catch (error) {
      const message = toStoreError(error);
      log.error('mcp', 'Failed to delete MCP server', { name, error: message });
      set({ servers: previous, error: message });
      throw error;
    } finally {
      set((state) => ({ pendingMutations: endMutation(state.pendingMutations, mutationKey) }));
    }
  },
}));
