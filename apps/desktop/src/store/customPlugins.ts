// Custom Plugins store — localStorage-persisted CRUD for user-defined
// JSON Schema endpoint plugins (P3-M3).

import { createDesktopStore } from './createDesktopStore';
import { log } from '../utils/logger';

// ── Types ──

export type AuthType = 'none' | 'bearer' | 'api-key';
export type HttpMethod = 'GET' | 'POST';

export interface CustomPlugin {
  id: string;
  name: string;
  description: string;
  endpoint: string;
  method: HttpMethod;
  authType: AuthType;
  /** Stored in localStorage only — never committed to version control. */
  authValue: string;
  inputSchema: string;
  outputSchema: string;
  enabled: boolean;
  createdAt: number;
}

export interface TestResult {
  success: boolean;
  statusCode?: number;
  body?: string;
  error?: string;
  durationMs: number;
}

interface CustomPluginsState {
  plugins: CustomPlugin[];
  testing: Record<string, boolean>;
  testResults: Record<string, TestResult>;

  loadPlugins: () => void;
  createPlugin: (data: Omit<CustomPlugin, 'id' | 'createdAt'>) => void;
  updatePlugin: (id: string, data: Partial<Omit<CustomPlugin, 'id' | 'createdAt'>>) => void;
  deletePlugin: (id: string) => void;
  toggleEnabled: (id: string) => void;
  testPlugin: (id: string, sampleInput: string) => Promise<TestResult>;
}

// ── Persistence helpers ──

const STORAGE_KEY = 'peers-ai-custom-plugins';

function persistPlugins(plugins: CustomPlugin[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(plugins));
  } catch {
    log.error('customPlugins', 'Failed to persist plugins to localStorage');
  }
}

function loadFromStorage(): CustomPlugin[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as CustomPlugin[];
  } catch {
    log.error('customPlugins', 'Failed to load plugins from localStorage');
    return [];
  }
}

function generateId(): string {
  return `cp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// ── Store ──

export const useCustomPluginsStore = createDesktopStore<CustomPluginsState>(
  'customPlugins',
  (set, get) => ({
    plugins: [],
    testing: {},
    testResults: {},

    loadPlugins: () => {
      const plugins = loadFromStorage();
      set({ plugins });
    },

    createPlugin: (data) => {
      const plugin: CustomPlugin = {
        ...data,
        id: generateId(),
        createdAt: Date.now(),
      };
      const next = [...get().plugins, plugin];
      set({ plugins: next });
      persistPlugins(next);
      log.info('customPlugins', 'Plugin created', { id: plugin.id, name: plugin.name });
    },

    updatePlugin: (id, data) => {
      const next = get().plugins.map((p) => (p.id === id ? { ...p, ...data } : p));
      set({ plugins: next });
      persistPlugins(next);
      log.info('customPlugins', 'Plugin updated', { id });
    },

    deletePlugin: (id) => {
      const next = get().plugins.filter((p) => p.id !== id);
      const testResults = { ...get().testResults };
      delete testResults[id];
      set({ plugins: next, testResults });
      persistPlugins(next);
      log.info('customPlugins', 'Plugin deleted', { id });
    },

    toggleEnabled: (id) => {
      const plugin = get().plugins.find((p) => p.id === id);
      if (!plugin) return;
      const next = get().plugins.map((p) => (p.id === id ? { ...p, enabled: !p.enabled } : p));
      set({ plugins: next });
      persistPlugins(next);
    },

    testPlugin: async (id, sampleInput) => {
      const plugin = get().plugins.find((p) => p.id === id);
      if (!plugin) {
        const result: TestResult = { success: false, error: 'Plugin not found', durationMs: 0 };
        return result;
      }

      set({ testing: { ...get().testing, [id]: true } });
      const start = performance.now();

      try {
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };

        if (plugin.authType === 'bearer' && plugin.authValue) {
          headers['Authorization'] = `Bearer ${plugin.authValue}`;
        } else if (plugin.authType === 'api-key' && plugin.authValue) {
          headers['X-API-Key'] = plugin.authValue;
        }

        const fetchOptions: RequestInit = {
          method: plugin.method,
          headers,
        };

        if (plugin.method === 'POST') {
          fetchOptions.body = sampleInput;
        }

        const response = await fetch(plugin.endpoint, fetchOptions);
        const body = await response.text();
        const durationMs = Math.round(performance.now() - start);

        const result: TestResult = {
          success: response.ok,
          statusCode: response.status,
          body,
          durationMs,
        };

        set({
          testing: { ...get().testing, [id]: false },
          testResults: { ...get().testResults, [id]: result },
        });

        return result;
      } catch (err) {
        const durationMs = Math.round(performance.now() - start);
        const errorMessage = err instanceof Error ? err.message : 'Unknown error';
        const result: TestResult = {
          success: false,
          error: errorMessage,
          durationMs,
        };

        set({
          testing: { ...get().testing, [id]: false },
          testResults: { ...get().testResults, [id]: result },
        });

        log.error('customPlugins', 'Plugin test failed', { id, error: errorMessage });
        return result;
      }
    },
  }),
);
