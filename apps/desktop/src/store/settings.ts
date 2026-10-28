import { createDesktopStore } from './createDesktopStore';
import { api, type AccountIdentity, type Agent } from '../services/desktop_api';
import { toolService, type ToolInfo } from '../services/tool-service';
import { log } from '../utils/logger';
import {
  DEFAULT_CHAT_SCREENSHOT_SHORTCUT,
  normalizeChatScreenshotShortcut,
} from '../utils/chatScreenshotShortcut';
import { beginMutation, endMutation, toStoreError, type RevalidationState } from './revalidation';
import {
  PERSONALIZATION_CHAT_SHORTCUT_KEY,
  PERSONALIZATION_SHOW_USABLE_PROVIDERS_KEY,
  readPersonalization,
  writePersonalization,
} from '../runtimes/personalization';

function registerChatScreenshotShortcut(shortcut: string): void {
  api.chatScreenshotShortcutRegister({ shortcut }).catch((error) => {
    log.warn('settings', 'Failed to register chat screenshot shortcut', error);
  });
}

interface SettingsState extends RevalidationState {
  agents: Agent[];
  tools: ToolInfo[];
  /**
   * Active account snapshot, refreshed by `runtimes/settingsRuntime.ts`
   * on bootstrap and when the session changes. The Security section reads
   * `has_pin` / `id` from here synchronously so the first click on
   * "Settings" never triggers an `accountGetActive` round-trip.
   */
  activeAccount: AccountIdentity | null;
  chatScreenshotShortcut: string;
  showUsableProvidersOnly: boolean;

  loadChatPreferences: () => Promise<void>;
  loadProviderPreferences: () => Promise<void>;
  loadAgents: () => Promise<void>;
  loadTools: () => Promise<void>;
  refreshActiveAccount: () => Promise<void>;
  setChatScreenshotShortcut: (shortcut: string) => void;
  setShowUsableOnly: (show: boolean) => Promise<void>;
  updateAgent: (name: string, data: Partial<Agent>) => Promise<void>;
  /** Restore identity-independent defaults after logout / actor switch. */
  resetPersonalization: () => void;
}

export const useSettingsStore = createDesktopStore<SettingsState>('settings', (set) => ({
  agents: [],
  tools: [],
  activeAccount: null,
  chatScreenshotShortcut: DEFAULT_CHAT_SCREENSHOT_SHORTCUT,
  showUsableProvidersOnly: true,
  loading: false,
  error: null,
  lastLoadedAt: null,
  pendingMutations: {},

  loadChatPreferences: async () => {
    try {
      const value = await readPersonalization<unknown>(
        PERSONALIZATION_CHAT_SHORTCUT_KEY,
      );
      const shortcut = normalizeChatScreenshotShortcut(value);
      set({ chatScreenshotShortcut: shortcut });
      registerChatScreenshotShortcut(shortcut);
    } catch (e) {
      log.warn('settings', 'Failed to load chat preferences', e);
      registerChatScreenshotShortcut(DEFAULT_CHAT_SCREENSHOT_SHORTCUT);
    }
  },

  loadProviderPreferences: async () => {
    try {
      const value = await readPersonalization<unknown>(
        PERSONALIZATION_SHOW_USABLE_PROVIDERS_KEY,
      );
      set({
        showUsableProvidersOnly: value !== false && value !== 'false',
      });
    } catch (error) {
      log.error('settings', 'Failed to load Provider display preference', { error: toStoreError(error) });
    }
  },

  loadAgents: async () => {
    set({ loading: true, error: null });
    try {
      const agents = await api.listAgents();
      set({ agents, lastLoadedAt: Date.now() });
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
      log.error('settings', 'Failed to refresh active account', { error: message });
      set({ error: message });
    }
  },

  setChatScreenshotShortcut: (shortcut) => {
    const normalized = normalizeChatScreenshotShortcut(shortcut);
    set({ chatScreenshotShortcut: normalized });
    void writePersonalization(PERSONALIZATION_CHAT_SHORTCUT_KEY, normalized)
      .then((persisted) => {
        if (!persisted) {
          log.warn('settings', 'Chat shortcut change held without an active identity');
        }
      })
      .catch((error) => {
        log.error('settings', 'Failed to persist chat screenshot shortcut', { error: toStoreError(error) });
      });
    registerChatScreenshotShortcut(normalized);
  },

  setShowUsableOnly: async (show) => {
    set({ showUsableProvidersOnly: show });
    try {
      const persisted = await writePersonalization(
        PERSONALIZATION_SHOW_USABLE_PROVIDERS_KEY,
        show,
      );
      if (!persisted) {
        log.warn('settings', 'Provider filter change held without an active identity');
      }
    } catch (error) {
      const message = toStoreError(error);
      log.error('settings', 'Failed to persist Provider display preference', { error: message });
      throw error;
    }
  },

  updateAgent: async (name, data) => {
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
      set({ error: message });
      throw e;
    } finally {
      set((state) => ({ pendingMutations: endMutation(state.pendingMutations, mutationKey) }));
    }
  },

  resetPersonalization: () => {
    set({
      chatScreenshotShortcut: DEFAULT_CHAT_SCREENSHOT_SHORTCUT,
      showUsableProvidersOnly: true,
    });
    registerChatScreenshotShortcut(DEFAULT_CHAT_SCREENSHOT_SHORTCUT);
  },
}));
