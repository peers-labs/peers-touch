import { createDesktopStore } from './createDesktopStore';
import { toolService, type ToolInfo } from '../services/tool-service';
import { log } from '../utils/logger';
import { toStoreError, type RevalidationState } from './revalidation';

interface ToolState extends RevalidationState {
  tools: ToolInfo[];
  loadTools: () => Promise<void>;
}

export const useToolStore = createDesktopStore<ToolState>('tool', (set) => ({
  tools: [],
  loading: false,
  error: null,
  lastLoadedAt: null,
  pendingMutations: {},

  loadTools: async () => {
    set({ loading: true, error: null });
    try {
      const tools = await toolService.list();
      set({ tools, lastLoadedAt: Date.now() });
    } catch (error) {
      const message = toStoreError(error);
      log.error('tool', 'Failed to load tools', { error: message });
      set({ error: message });
    } finally {
      set({ loading: false });
    }
  },
}));
