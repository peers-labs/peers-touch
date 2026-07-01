import { create } from 'zustand';
import { api, type AccountIdentity, type Agent } from '../services/desktop_api';
import { toolService, type ToolInfo } from '../services/tool-service';
import { log } from '../utils/logger';
import {
  DEFAULT_CHAT_SCREENSHOT_SHORTCUT,
  normalizeChatScreenshotShortcut,
} from '../utils/chatScreenshotShortcut';
import { beginMutation, endMutation, toStoreError, type RevalidationState } from './revalidation';

const CHAT_SCREENSHOT_SHORTCUT_SETTING_KEY = 'settings.chat.screenshotShortcut';

function registerChatScreenshotShortcut(shortcut: string): void {
  api.chatScreenshotShortcutRegister({ shortcut }).catch((error) => {
    log.warn('settings', 'Failed to register chat screenshot shortcut', error);
  });
}

interface SettingsState extends RevalidationState {
  agents: Agent[];
  tools: ToolInfo[];
  currentAgent: string;
  /**
   * Active account snapshot, refreshed by `runtimes/settingsRuntime.ts`
   * on bootstrap and visibility events. The Security section reads
   * `has_pin` / `id` from here synchronously so the first click on
   * "Settings" never triggers an `accountGetActive` round-trip.
   */
  activeAccount: AccountIdentity | null;
  chatScreenshotShortcut: string;

  loadChatPreferences: () => Promise<void>;
  loadAgents: () => Promise<void>;
  loadTools: () => Promise<void>;
  refreshActiveAccount: () => Promise<void>;
  setChatScreenshotShortcut: (shortcut: string) => void;
  setCurrentAgent: (name: string) => void;
  setDefaultAgent: (id: string) => Promise<void>;
  updateAgent: (name: string, data: Partial<Agent>) => Promise<void>;
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  agents: [],
  tools: [],
  currentAgent: 'assistant',
  activeAccount: null,
  chatScreenshotShortcut: DEFAULT_CHAT_SCREENSHOT_SHORTCUT,
  loading: false,
  error: null,
  lastLoadedAt: null,
  pendingMutations: {},

  loadChatPreferences: async () => {
    try {
      const rustResult = await api.settingsGet({ key: CHAT_SCREENSHOT_SHORTCUT_SETTING_KEY });
      const value = rustResult.ok
        ? (rustResult.data as { value?: unknown } | undefined)?.value
        : undefined;
      const shortcut = normalizeChatScreenshotShortcut(value);
      set({ chatScreenshotShortcut: shortcut });
      registerChatScreenshotShortcut(shortcut);
    } catch (e) {
      log.warn('settings', 'Failed to load chat preferences', e);
      registerChatScreenshotShortcut(DEFAULT_CHAT_SCREENSHOT_SHORTCUT);
    }
  },

  loadAgents: async () => {
    set({ loading: true, error: null });
    try {
      const agents = await api.listAgents();
      set({ agents, lastLoadedAt: Date.now() });
      const rustResult = await api.settingsGet({ key: 'settings.currentAgent' });
      if (rustResult.ok) {
        const value = (rustResult.data as { value?: string } | undefined)?.value;
        if (value) {
          set({ currentAgent: value });
        }
      }
    } catch (e) {
      const message = toStoreError(e);
      log.error('settings', 'Failed to load agents', { error: message });
      set({ error: message });
    } finally {
      set({ loading: false });
    }
  },

  loadTools: async () => {
    set({ loading: true, error: null });
    try {
      const tools = await toolService.list();
      set({ tools, lastLoadedAt: Date.now() });
    } catch (e) {
      const message = toStoreError(e);
      log.error('settings', 'Failed to load tools', { error: message });
      set({ error: message });
    } finally {
      set({ loading: false });
    }
  },

  refreshActiveAccount: async () => {
    try {
      const active = await api.accountGetActive();
      set({ activeAccount: active ?? null });
    } catch (e) {
      const message = toStoreError(e);
      log.warn('settings', 'Failed to refresh active account', { error: message });
      set({ error: message });
    }
  },

  setCurrentAgent: (name: string) => {
    set({ currentAgent: name });
    api.settingsSet({ key: 'settings.currentAgent', value: name }).catch((error) => {
      const message = toStoreError(error);
      log.error('settings', 'Failed to persist current agent', { name, error: message });
      set({ error: message });
    });
  },

  setDefaultAgent: async (id: string) => {
    const previousAgents = get().agents;
    const target = previousAgents.find((agent) => agent.id === id);
    if (!target) return;
    const mutationKey = `agent-default:${id}`;
    set((state) => ({
      agents: state.agents.map((agent) => ({
        ...agent,
        isDefault: agent.id === id,
      })),
      error: null,
      pendingMutations: beginMutation(state.pendingMutations, mutationKey),
    }));
    try {
      const result = await api.setDefaultAgent(id);
      set((state) => ({
        agents: state.agents.map((agent) => ({
          ...agent,
          isDefault: agent.name === result.defaultAgent,
        })),
        currentAgent: result.defaultAgent,
        lastLoadedAt: Date.now(),
      }));
    } catch (e) {
      const message = toStoreError(e);
      log.error('settings', 'Failed to persist default agent', { id, error: message });
      set({ agents: previousAgents, error: message });
      throw e;
    } finally {
      set((state) => ({ pendingMutations: endMutation(state.pendingMutations, mutationKey) }));
    }
  },

  setChatScreenshotShortcut: (shortcut: string) => {
    const normalized = normalizeChatScreenshotShortcut(shortcut);
    set({ chatScreenshotShortcut: normalized });
    api.settingsSet({ key: CHAT_SCREENSHOT_SHORTCUT_SETTING_KEY, value: normalized }).catch((error) => {
      const message = toStoreError(error);
      log.warn('settings', 'Failed to persist chat screenshot shortcut', { error: message });
      set({ error: message });
    });
    registerChatScreenshotShortcut(normalized);
  },

  updateAgent: async (name: string, data: Partial<Agent>) => {
    const previousAgents = get().agents;
    const mutationKey = `agent:${name}`;
    set((state) => ({
      agents: state.agents.map((agent) => (agent.name === name ? { ...agent, ...data } : agent)),
      error: null,
      pendingMutations: beginMutation(state.pendingMutations, mutationKey),
    }));
    try {
      const agents = await api.listAgents();
      const agent = agents.find((a) => a.name === name);
      if (agent) {
        await api.updateAgent(agent.id, data);
      }
      const updated = await api.listAgents();
      set({ agents: updated, lastLoadedAt: Date.now() });
    } catch (e) {
      const message = toStoreError(e);
      log.error('settings', 'Failed to update agent', { name, error: message });
      set({ agents: previousAgents, error: message });
      throw e;
    } finally {
      set((state) => ({ pendingMutations: endMutation(state.pendingMutations, mutationKey) }));
    }
  },
}));
